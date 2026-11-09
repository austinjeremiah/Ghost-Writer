// Policy mirror. The chain is the truth; this keeps a readable copy for listing, watchers and
// learning, and it only ever writes what it has verified on-chain.
import { db } from '../db.js';
import { C, env, ASSET_BY_FEED, type Asset } from '../config.js';
import { AppError } from '../errors.js';
import { testnet, txObjectTypes, idsOfType } from '../chain/clients.js';
import { readPolicy, type PolicyState } from '../chain/objects.js';
import { invalidatePool } from '../chain/poolCache.js';
import { getQuote, markQuoteUsed } from '../pricing/quote.js';
import { appendRecord, anchorPending, getBorrower } from '../memory/records.js';
import { enqueueMemory } from '../memory/queue.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export type PolicyStatus = 'active' | 'breach' | 'paid' | 'expired';
export type PolicyRow = {
  id: string; quote_id: string; holder: string; kind: number; asset: string; feed_id: string;
  strike_e8: string; obligation_id: string; payout: string; premium: string; start_ms: number; end_ms: number;
  status: PolicyStatus; breach_started_ms: number; buy_digest: string | null; settle_digest: string | null;
  settle_path: string | null; near_miss: number; warned_at: number | null; responded: number;
  hedge_status: string; hedge_detail: string | null; learned: number; created_at: number; updated_at: number;
};

export type PolicyDTO = {
  policyId: string; quoteId: string; holder: string; kind: 'price' | 'liquidation'; asset: Asset;
  feedId: string; strikeE8: string; obligationId: string; payout: string; premium: string;
  startMs: number; endMs: number; status: PolicyStatus; breachStartedMs: number;
  buyDigest: string | null; settleDigest: string | null; settlePath: 'price' | 'liquidation' | null;
  nearMiss: boolean; hedge: { status: string; detail?: string };
};

export const getPolicyRow = (id: string): PolicyRow | undefined =>
  db.prepare('SELECT * FROM policies WHERE id = ?').get(id) as PolicyRow | undefined;

export function toDTO(r: PolicyRow): PolicyDTO {
  return {
    policyId: r.id, quoteId: r.quote_id, holder: r.holder,
    kind: r.kind === 0 ? 'price' : 'liquidation', asset: r.asset as Asset,
    feedId: r.feed_id, strikeE8: r.strike_e8, obligationId: r.obligation_id,
    payout: r.payout, premium: r.premium, startMs: r.start_ms, endMs: r.end_ms,
    status: r.status, breachStartedMs: r.breach_started_ms,
    buyDigest: r.buy_digest, settleDigest: r.settle_digest,
    settlePath: (r.settle_path as 'price' | 'liquidation' | null) ?? null,
    nearMiss: r.near_miss === 1,
    hedge: { status: r.hedge_status, ...(r.hedge_detail ? { detail: r.hedge_detail } : {}) },
  };
}

export function getPolicy(id: string): PolicyDTO | null {
  const r = getPolicyRow(id);
  return r ? toDTO(r) : null;
}

export function listPolicies(filter: { holder?: string; status?: PolicyStatus }): PolicyDTO[] {
  const where: string[] = [];
  const args: Array<string> = [];
  if (filter.holder) { where.push('holder = ?'); args.push(filter.holder); }
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM policies ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 200`;
  return (db.prepare(sql).all(...args) as PolicyRow[]).map(toDTO);
}

export const activePolicies = (): PolicyRow[] =>
  db.prepare(`SELECT * FROM policies WHERE status IN ('active', 'breach') ORDER BY end_ms ASC`).all() as PolicyRow[];

const statusFrom = (p: PolicyState): PolicyStatus =>
  p.status === 1 ? 'paid' : p.status === 2 ? 'expired' : p.breachStartedMs > 0 ? 'breach' : 'active';

/** Inserts or refreshes the mirror row from an on-chain Policy. */
export function upsertPolicy(p: PolicyState, opts: { quoteId?: string; buyDigest?: string } = {}): PolicyRow {
  const existing = getPolicyRow(p.id);
  const now = Date.now();
  const asset = ASSET_BY_FEED[p.feedId] ?? 'SUI';
  const quoteId = opts.quoteId ?? existing?.quote_id ?? p.quoteId;
  db.prepare(
    `INSERT INTO policies(id, quote_id, holder, kind, asset, feed_id, strike_e8, obligation_id, payout, premium,
       start_ms, end_ms, status, breach_started_ms, buy_digest, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, breach_started_ms = excluded.breach_started_ms,
       buy_digest = COALESCE(policies.buy_digest, excluded.buy_digest), updated_at = excluded.updated_at`,
  ).run(
    p.id, quoteId, p.holder, p.kind, asset, p.feedId, p.strikeE8.toString(), p.obligationId,
    p.payout.toString(), p.premium.toString(), p.startMs, p.endMs, statusFrom(p), p.breachStartedMs,
    opts.buyDigest ?? null, existing?.created_at ?? now, now,
  );
  return getPolicyRow(p.id)!;
}

export function setPolicyStatus(
  id: string,
  status: PolicyStatus,
  extra: { breachStartedMs?: number; settleDigest?: string; settlePath?: 'price' | 'liquidation'; nearMiss?: boolean } = {},
): void {
  const sets = ['status = ?', 'updated_at = ?'];
  const args: Array<string | number> = [status, Date.now()];
  if (extra.breachStartedMs !== undefined) { sets.push('breach_started_ms = ?'); args.push(extra.breachStartedMs); }
  if (extra.settleDigest) { sets.push('settle_digest = ?'); args.push(extra.settleDigest); }
  if (extra.settlePath) { sets.push('settle_path = ?'); args.push(extra.settlePath); }
  if (extra.nearMiss !== undefined) { sets.push('near_miss = ?'); args.push(extra.nearMiss ? 1 : 0); }
  db.prepare(`UPDATE policies SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  invalidatePool();
}

/**
 * Called right after a buy transaction succeeds (by the frontend, or by the x402 settler).
 * Finds the Policy object the transaction created and checks it against the quote it claims.
 */
export async function confirmFromDigest(digest: string, quoteId: string): Promise<PolicyDTO> {
  const types = await txObjectTypes(testnet, digest);
  const [policyId] = idsOfType(types, '::ghostwriter::Policy<');
  if (!policyId) throw new AppError('NOT_FOUND', 'that transaction created no Ghostwriter policy', { digest });

  const p = await readPolicy(policyId);
  const quote = getQuote(quoteId);
  if (!quote) throw new AppError('NOT_FOUND', 'unknown quote', { quoteId });
  if (p.quoteId !== quoteId) {
    throw new AppError('CONFLICT', 'that policy was bought with a different quote', { policyQuoteId: p.quoteId, quoteId });
  }
  if (p.holder !== quote.buyer) {
    throw new AppError('CONFLICT', 'policy holder does not match the quoted buyer', { holder: p.holder });
  }

  const fresh = getPolicyRow(policyId) === undefined;
  const row = upsertPolicy(p, { quoteId, buyDigest: digest });
  markQuoteUsed(quoteId);
  invalidatePool();

  if (fresh) {
    // The buyer's own memory (only if they registered an account) plus the underwriter's book.
    if (getBorrower(p.holder)) {
      appendRecord(p.holder, 'policy_bought', {
        policyId, kind: row.kind === 0 ? 'price' : 'liquidation', asset: row.asset,
        strikeE8: row.strike_e8, payout: row.payout, premium: row.premium, endMs: row.end_ms,
      }, [digest]);
      void anchorPending(p.holder);
    }
    enqueueMemory({
      account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies,
      purpose: `policy:${policyId}:bought`,
      text: `policy bought ${row.asset} ${C.PREFIX.policy}${JSON.stringify({
        policyId, status: 'active', kind: row.kind, asset: row.asset, strikeE8: row.strike_e8,
        payout: row.payout, premium: row.premium, startMs: row.start_ms, endMs: row.end_ms, digest,
      })}`,
    });
    emit('policy.bought', toDTO(row));
    log.info('policy confirmed', { policyId, holder: p.holder.slice(0, 10) + '…', payout: row.payout });
  }
  return toDTO(row);
}

/** Re-reads every live policy from chain at startup, so a restart cannot lose state. */
export async function resyncPolicies(): Promise<number> {
  const rows = activePolicies();
  let changed = 0;
  for (const r of rows) {
    try {
      const p = await readPolicy(r.id);
      const next = statusFrom(p);
      if (next !== r.status || p.breachStartedMs !== r.breach_started_ms) {
        upsertPolicy(p);
        changed++;
      }
    } catch (e) {
      log.warn('policy resync failed', { policyId: r.id, message: (e as Error).message });
    }
  }
  if (changed) log.info('policies resynced from chain', { changed, of: rows.length });
  return changed;
}
