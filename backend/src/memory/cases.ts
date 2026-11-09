// Cases: what happened to cover like this before. Backtest aggregates seed the book; live payouts and
// near-misses are appended as they happen. Recall is semantic, so a case written for one bucket is
// found by the next similar quote.
import { C, env, type Asset } from '../config.js';
import { enqueueMemory } from './queue.js';
import { underwriter, recall } from './client.js';
import type { VolBucket, MoneyBucket, DurBucket } from '../pricing/buckets.js';

export type CaseOutcome = 'payout' | 'near_miss' | 'expired' | 'backtest';
export type CaseRec = {
  v: 1;
  asset: Asset;
  volBucket: VolBucket;
  moneyBucket: MoneyBucket;
  durBucket: DurBucket;
  outcome: CaseOutcome;
  source: 'live' | 'backtest';
  /** Backtest only: windows sampled and how many touched the barrier. */
  n?: number;
  hits?: number;
  policyId?: string;
  note?: string;
  at: number;
};
export type CaseKey = Pick<CaseRec, 'asset' | 'volBucket' | 'moneyBucket' | 'durBucket'>;

export const caseQuery = (c: CaseKey) =>
  `liquidation cover case asset=${c.asset} vol=${c.volBucket} distance=${c.moneyBucket}% duration=${c.durBucket}`;

/** Text leads with the semantic query words, then the machine-readable JSON after a version prefix. */
export const caseText = (c: CaseRec) => `${caseQuery(c)} outcome=${c.outcome} ${C.PREFIX.case}${JSON.stringify(c)}`;

export function parseCase(text: string): CaseRec | null {
  const i = text.indexOf(C.PREFIX.case);
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i + C.PREFIX.case.length)) as CaseRec;
  } catch {
    return null;
  }
}

export const enqueueCase = (c: CaseRec, purpose: string): number =>
  enqueueMemory({
    account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
    namespace: C.NS.cases, text: caseText(c), purpose,
  });

export type CaseHit = { rec: CaseRec; blobId: string; distance: number; exact: boolean };

export const sameBucket = (a: CaseKey, b: CaseKey) =>
  a.asset === b.asset && a.volBucket === b.volBucket && a.moneyBucket === b.moneyBucket && a.durBucket === b.durBucket;

/**
 * Cases worth pricing this quote on.
 *
 * Recall finds candidates, but the JSON inside each memory decides what a case is ABOUT — embeddings
 * put "distance=0-5 duration=8-30d" within 0.15 of "distance=5-10 duration=4-7d", and those two have
 * wildly different hit rates. So `exact` is computed from the parsed buckets, and the caller uses it
 * for anything rate-like. The limit is the relayer's maximum because the namespace is small and the
 * right bucket must be in the candidate set.
 */
export async function similarCases(q: CaseKey): Promise<CaseHit[]> {
  const hits = await recall(underwriter, C.NS.cases, caseQuery(q), 100);
  const out: CaseHit[] = [];
  for (const h of hits) {
    const rec = parseCase(h.text);
    if (!rec || rec.asset !== q.asset) continue;
    const exact = sameBucket(rec, q);
    // Non-exact cases are only kept as neighbourhood evidence, and only if semantically close.
    if (exact || h.distance < C.CASE_MAX_DISTANCE) {
      out.push({ rec, blobId: h.blobId, distance: h.distance, exact });
    }
  }
  return out;
}
