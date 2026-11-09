// Suilend reads on Sui MAINNET through Tatum gRPC.
//
// Two jobs: find the obligations a borrower controls (so liquidation cover can only be bought on a
// position they actually hold), and watch Suilend's lending_market events so a liquidation of a
// covered obligation is noticed without anyone filing a claim.
import { env } from '../config.js';
import { mainnet, tatumMain } from './clients.js';
import { log } from '../log.js';

export type Obligation = { obligationId: string; raw: unknown };

type JsonObj = Record<string, unknown>;
const field = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as JsonObj)[k] : undefined), o);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    return 0n;
  }
};

/**
 * Obligations a borrower controls, via the `ObligationOwnerCap<P>` objects they own.
 * `SUILEND_OBLIGATION_CAP_TYPE` needs the concrete `P` from the live LendingMarket; until it is set
 * this returns [] and callers say so rather than guessing.
 */
export async function listObligations(owner: string): Promise<Obligation[]> {
  if (!env.SUILEND_OBLIGATION_CAP_TYPE) return [];
  try {
    const r = await tatumMain(
      () => mainnet.core.listOwnedObjects({ owner, type: env.SUILEND_OBLIGATION_CAP_TYPE, limit: 50 }),
      'suilend obligations',
    );
    const out: Obligation[] = [];
    for (const o of r.objects ?? []) {
      const json = o.json as JsonObj | undefined;
      const id = str(json?.obligation_id) ?? str(json?.obligationId);
      if (id) out.push({ obligationId: id, raw: json });
    }
    return out;
  } catch (e) {
    log.warn('suilend obligation lookup failed', { message: (e as Error).message });
    return [];
  }
}

export type LiquidationEvent = {
  obligationId: string;
  txDigest: string;
  repayAmount: bigint;
  withdrawAmount: bigint;
  checkpoint: bigint | null;
};

/** Field names confirmed against suilend's `lending_market` docs; `pnpm peek:suilend` re-checks them live. */
export function decodeLiquidation(eventJson: unknown, txDigest: string, checkpoint: bigint | null): LiquidationEvent | null {
  const obligationId = str(field(eventJson, 'obligation_id'));
  if (!obligationId) return null;
  return {
    obligationId,
    txDigest,
    repayAmount: big(field(eventJson, 'repay_amount')),
    withdrawAmount: big(field(eventJson, 'withdraw_amount')),
    checkpoint,
  };
}

const liquidateFilter = {
  terms: [{
    literals: [{
      negated: false,
      predicate: { oneofKind: 'eventType' as const, eventType: { eventType: env.SUILEND_LIQUIDATE_EVENT_TYPE } },
    }],
  }],
};

/**
 * Live stream of Suilend liquidations on Mainnet (Tatum gRPC). Yields until the stream ends, so the
 * caller decides whether to reconnect.
 */
export async function streamLiquidations(onEvent: (e: LiquidationEvent) => void | Promise<void>): Promise<void> {
  const call = mainnet.subscriptionService.subscribeEvents({
    filter: liquidateFilter,
    readMask: { paths: ['event.json', 'event.transaction_digest', 'event.checkpoint', 'event.event_type'] },
  });
  for await (const msg of call.responses) {
    const ev = msg.event;
    if (!ev) continue;
    const decoded = decodeLiquidation(ev.json, ev.transactionDigest ?? '', ev.checkpoint ?? null);
    if (decoded?.txDigest) await onEvent(decoded);
  }
}

/** Catch-up read over a checkpoint range, for whatever the stream missed while we were down. */
export async function recentLiquidations(startCheckpoint: bigint, limit = 200): Promise<LiquidationEvent[]> {
  const out: LiquidationEvent[] = [];
  const call = mainnet.ledgerService.listEvents({
    filter: liquidateFilter,
    startCheckpoint,
    readMask: { paths: ['event.json', 'event.transaction_digest', 'event.checkpoint', 'event.event_type'] },
  });
  for await (const msg of call.responses) {
    const ev = msg.event;
    if (!ev) continue;
    const decoded = decodeLiquidation(ev.json, ev.transactionDigest ?? '', ev.checkpoint ?? null);
    if (decoded?.txDigest) out.push(decoded);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Borrower reactions to a warning: a Deposit or Repay on the covered obligation. Evidence that earns
 * a discount on the next quote, read from Mainnet so it cannot be claimed without having happened.
 */
export async function obligationActivity(obligationId: string, startCheckpoint: bigint): Promise<string[]> {
  const digests: string[] = [];
  for (const name of ['DepositEvent', 'RepayEvent']) {
    try {
      const call = mainnet.ledgerService.listEvents({
        filter: {
          terms: [{
            literals: [{
              negated: false,
              predicate: { oneofKind: 'eventType' as const, eventType: { eventType: `${env.SUILEND_EVENT_MODULE}::${name}` } },
            }],
          }],
        },
        startCheckpoint,
        readMask: { paths: ['event.json', 'event.transaction_digest'] },
      });
      for await (const msg of call.responses) {
        const ev = msg.event;
        if (!ev) continue;
        if (str(field(ev.json, 'obligation_id')) === obligationId && ev.transactionDigest) {
          digests.push(ev.transactionDigest);
        }
        if (digests.length >= 10) break;
      }
    } catch (e) {
      log.warn('suilend activity read failed', { event: name, message: (e as Error).message });
    }
  }
  return digests;
}

/** Mainnet checkpoint height now, used as the watcher's starting watermark. */
export async function mainnetCheckpoint(): Promise<bigint> {
  const info = await tatumMain(() => mainnet.ledgerService.getServiceInfo({}).response, 'mainnet serviceInfo');
  return info.checkpointHeight ?? 0n;
}

/**
 * The transaction that last touched an object, read from Mainnet.
 *
 * This is how liquidations are discovered on a Tatum plan that does not allow the event RPCs
 * (`ListEvents` / `SubscribeEvents` answer "gRPC method not allowed"). Any change to a covered
 * obligation gives us a candidate digest; the enclave then decides whether it was a liquidation,
 * which is the only judgement that matters and the one we must not make ourselves.
 */
export async function obligationPreviousTx(obligationId: string): Promise<{ digest: string; version: string } | null> {
  try {
    const r = await tatumMain(
      () => mainnet.ledgerService.getObject({
        objectId: obligationId,
        readMask: { paths: ['object_id', 'version', 'previous_transaction'] },
      }).response,
      'obligation previousTx',
    );
    const o = r.object;
    if (!o?.previousTransaction) return null;
    return { digest: o.previousTransaction, version: String(o.version ?? '0') };
  } catch (e) {
    log.warn('obligation read failed', { obligationId: obligationId.slice(0, 12) + '…', message: (e as Error).message });
    return null;
  }
}

/** True when this Tatum plan allows the event RPCs; checked once at startup. */
export async function eventRpcAllowed(): Promise<boolean> {
  try {
    const call = mainnet.ledgerService.listEvents({
      filter: liquidateFilter,
      startCheckpoint: await mainnetCheckpoint(),
      readMask: { paths: ['event.transaction_digest'] },
    });
    for await (const _ of call.responses) break;
    return true;
  } catch {
    return false;
  }
}
