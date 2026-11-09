// Watches Suilend on Sui MAINNET for liquidations of obligations we cover, and settles them on
// Testnet through the Nautilus enclave — no claim form, no human.
//
// Discovery has two modes, chosen at startup:
//
//   stream  — Tatum's event RPCs (SubscribeEvents / ListEvents). Exact, but not available on every
//             Tatum plan; ours answers "gRPC method not allowed".
//   polling — read each covered obligation's `previousTransaction` from Mainnet. Any change gives a
//             candidate digest, and the ENCLAVE decides whether it was a liquidation. That judgement
//             must not be ours to make, so handing it candidates costs nothing in trust.
//
// A change that the enclave refuses is still useful: if the borrower had been warned, it is evidence
// they reacted, which is written to their own memory and makes their next quote cheaper.
import { db, kvGet, kvSet } from '../db.js';
import { env, C } from '../config.js';
import {
  streamLiquidations, recentLiquidations, obligationPreviousTx, eventRpcAllowed,
  mainnetCheckpoint, type LiquidationEvent,
} from '../chain/suilend.js';
import { attestLiquidation, enclaveReady } from '../enclave/client.js';
import { settleLiquidation } from '../chain/ghostwriterTx.js';
import { invalidatePool } from '../chain/poolCache.js';
import { setPolicyStatus, getPolicyRow, type PolicyRow } from '../policies/sync.js';
import { recordResponse } from '../policies/learning.js';
import { emit } from '../bus.js';
import { workerState } from '../state.js';
import { sleep } from '../util/sleep.js';
import { log } from '../log.js';

const WATERMARK_KEY = 'liquidationWatcher.checkpoint';
const seenTx = (obligationId: string) => `liquidationWatcher.lastTx.${obligationId.toLowerCase()}`;

const liveLiquidationPolicies = (): PolicyRow[] =>
  db.prepare(`SELECT * FROM policies WHERE kind = 1 AND status IN ('active','breach')`).all() as PolicyRow[];

const coveredPolicyFor = (obligationId: string): PolicyRow | undefined =>
  db.prepare(
    `SELECT * FROM policies WHERE kind = 1 AND status IN ('active','breach') AND lower(obligation_id) = lower(?) ORDER BY end_ms DESC LIMIT 1`,
  ).get(obligationId) as PolicyRow | undefined;

/** Attest a liquidation in the enclave, then settle the policy on Testnet. */
export async function settleFromLiquidation(policy: PolicyRow, txDigest: string): Promise<string> {
  const att = await attestLiquidation(txDigest, policy.obligation_id);

  // The contract requires the signed timestamp to fall inside the cover window; say so clearly here
  // rather than letting it surface as abort 9.
  if (att.timestampMs < policy.start_ms || att.timestampMs > policy.end_ms) {
    throw Object.assign(new Error('that liquidation happened outside the cover window'), {
      detail: { timestampMs: att.timestampMs, startMs: policy.start_ms, endMs: policy.end_ms },
    });
  }

  const r = await settleLiquidation({
    policyId: policy.id,
    txDigest: att.txDigest,
    repayAmount: att.repayAmount,
    withdrawAmount: att.withdrawAmount,
    timestampMs: att.timestampMs,
    signatureHex: att.signatureHex,
  });
  setPolicyStatus(policy.id, 'paid', { settleDigest: r.digest, settlePath: 'liquidation' });
  invalidatePool();
  emit('policy.paid', {
    policyId: policy.id, holder: policy.holder, payout: policy.payout, path: 'liquidation', digest: r.digest,
  });
  log.info('policy paid on attested liquidation', { policyId: policy.id, digest: r.digest, evidence: txDigest });
  return r.digest;
}

/** A confirmed liquidation event (stream mode). */
async function onLiquidationEvent(e: LiquidationEvent): Promise<void> {
  const policy = coveredPolicyFor(e.obligationId);
  emit('liquidation.seen', { obligationId: e.obligationId, txDigest: e.txDigest, matchedPolicyId: policy?.id ?? null });
  if (!policy) return;
  if (!enclaveReady()) {
    log.warn('liquidation matched a policy but the enclave is not configured', { policyId: policy.id, txDigest: e.txDigest });
    return;
  }
  try {
    await settleFromLiquidation(policy, e.txDigest);
  } catch (err) {
    log.error('automatic liquidation settlement failed', {
      policyId: policy.id, txDigest: e.txDigest, message: (err as Error).message,
    });
  }
}

/**
 * A covered obligation changed (polling mode). Ask the enclave; a refusal means it was not a
 * liquidation, and counts as the borrower acting on their position instead.
 */
async function onObligationChanged(policy: PolicyRow, txDigest: string): Promise<void> {
  emit('liquidation.seen', { obligationId: policy.obligation_id, txDigest, matchedPolicyId: policy.id });

  if (!enclaveReady()) {
    log.warn('covered obligation changed but the enclave is not configured', { policyId: policy.id, txDigest });
    return;
  }
  try {
    await settleFromLiquidation(policy, txDigest);
  } catch (err) {
    const message = (err as Error).message;
    // "no LiquidateEvent for this obligation" is the expected, healthy case for a deposit or repay.
    log.info('obligation change was not a liquidation', { policyId: policy.id, txDigest, reason: message.slice(0, 140) });
    if (policy.warned_at && Date.now() - policy.warned_at <= C.RESPONSE_WINDOW_MS) {
      recordResponse(policy.id, policy.holder, [txDigest]);
    }
  }
}

async function pollObligations(): Promise<void> {
  for (const policy of liveLiquidationPolicies()) {
    const current = await obligationPreviousTx(policy.obligation_id);
    if (!current) continue;
    const key = seenTx(policy.obligation_id);
    const last = kvGet(key);
    if (last === null) {
      // First sight: record the baseline, do not treat existing history as new activity.
      kvSet(key, current.digest);
      continue;
    }
    if (last === current.digest) continue;
    kvSet(key, current.digest);
    await onObligationChanged(policy, current.digest);
  }
}

async function catchUpEvents(): Promise<void> {
  const stored = kvGet(WATERMARK_KEY);
  const from = stored ? BigInt(stored) : await mainnetCheckpoint();
  try {
    const missed = await recentLiquidations(from);
    for (const e of missed) await onLiquidationEvent(e);
    if (missed.length > 0) log.info('caught up on Suilend liquidations', { count: missed.length });
  } catch (e) {
    log.warn('liquidation catch-up failed', { message: (e as Error).message });
  }
  kvSet(WATERMARK_KEY, String(await mainnetCheckpoint().catch(() => from)));
}

export function startLiquidationWatcher(): void {
  void (async () => {
    const canStream = await eventRpcAllowed();

    if (!canStream) {
      workerState.liquidationWatcher = 'polling';
      log.info('suilend watcher polling covered obligations (Tatum plan does not allow the event RPCs)', {
        everyMs: env.LIQ_POLL_MS,
      });
      for (;;) {
        try {
          await pollObligations();
        } catch (e) {
          log.warn('obligation poll failed', { message: (e as Error).message });
        }
        await sleep(env.LIQ_POLL_MS);
      }
    }

    await catchUpEvents();
    for (let attempt = 0; ; attempt++) {
      try {
        workerState.liquidationWatcher = 'stream';
        log.info('suilend liquidation stream open (Tatum gRPC, Mainnet)');
        await streamLiquidations(onLiquidationEvent);
        attempt = 0;
        log.warn('suilend liquidation stream ended; reconnecting');
      } catch (e) {
        workerState.liquidationWatcher = 'reconnecting';
        log.warn('suilend liquidation stream failed', { message: (e as Error).message });
      }
      await sleep(Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5)));
      await catchUpEvents();
    }
  })();
}

export { coveredPolicyFor, getPolicyRow };
