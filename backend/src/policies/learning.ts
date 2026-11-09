// The learning loop: an outcome becomes a memory, and that memory changes the next quote.
//
// A payout writes a live case AND creates or raises a rule for that bucket, so the same cover costs
// more next time and the quote cites the blob that made it dearer. A long run of quiet expiries decays
// the rule back down, so the book does not ratchet upwards for ever.
import { db } from '../db.js';
import { env, C, type Asset } from '../config.js';
import { bus, type BusEvent } from '../bus.js';
import { enqueueCase } from '../memory/cases.js';
import { matchRule, saveRule, ruleId, type Rule } from '../memory/rules.js';
import { writeLesson } from '../pricing/explain.js';
import { appendRecord, anchorPending, getBorrower } from '../memory/records.js';
import { enqueueMemory } from '../memory/queue.js';
import { volBucket, moneyBucket, durBucket } from '../pricing/buckets.js';
import { getPolicyRow } from './sync.js';
import { log } from '../log.js';

const QUIET_RUN_BEFORE_DECAY = 5;
const RULE_START = 1.25;
const RULE_STEP = 1.1;
const RULE_CAP = 2.0;

/**
 * Re-derives the pricing buckets for a settled policy. The quote it was bought with holds the spot
 * and vol as they were at purchase, which is what the bucket must reflect — not today's market.
 */
function bucketsFor(policyId: string) {
  const p = getPolicyRow(policyId);
  if (!p) return null;
  const q = db.prepare('SELECT dto FROM quotes WHERE id = ?').get(p.quote_id) as { dto: string } | undefined;
  const strikeUsd = Number(BigInt(p.strike_e8)) / 1e8;
  let spotUsd: number;
  let volAnnual: number;
  if (q) {
    const pricing = (JSON.parse(q.dto) as { pricing: { spotUsd: number; volAnnual: number } }).pricing;
    spotUsd = pricing.spotUsd;
    volAnnual = pricing.volAnnual;
  } else {
    // Policy discovered on-chain without a local quote: assume it was struck ~10% below spot.
    spotUsd = strikeUsd / 0.9;
    volAnnual = 0.8;
  }
  const days = Math.max(1, Math.round((p.end_ms - p.start_ms) / 86_400_000));
  return {
    p,
    asset: p.asset as Asset,
    volBucket: volBucket(volAnnual),
    moneyBucket: moneyBucket(spotUsd, strikeUsd),
    durBucket: durBucket(days),
  };
}

const markLearned = (policyId: string) => db.prepare('UPDATE policies SET learned = 1 WHERE id = ?').run(policyId);

async function onPaid(policyId: string, path: string, digest: string): Promise<void> {
  const b = bucketsFor(policyId);
  if (!b || b.p.learned) return;
  markLearned(policyId);

  enqueueCase({
    v: 1, asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, durBucket: b.durBucket,
    outcome: 'payout', source: 'live', policyId, note: `paid via ${path}`, at: Date.now(),
  }, `case:${policyId}`);

  const existing = matchRule(b.asset, b.volBucket, b.moneyBucket);
  const lesson = await writeLesson({
    asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, path,
    payoutBaseUnits: b.p.payout, premiumBaseUnits: b.p.premium,
  });
  const rule: Rule = existing
    ? {
        ...existing,
        multiplier: Math.min(RULE_CAP, Number((existing.multiplier * RULE_STEP).toFixed(4))),
        status: 'active', lesson, payouts: existing.payouts + 1, quietExpiries: 0, updatedAt: Date.now(),
      }
    : {
        ruleId: ruleId(b.asset, b.volBucket, b.moneyBucket), asset: b.asset,
        volBucket: b.volBucket, moneyBucket: b.moneyBucket, multiplier: RULE_START,
        status: 'trial', lesson, payouts: 1, quietExpiries: 0, blobId: null, updatedAt: Date.now(),
      };
  saveRule(rule);
  log.info('rule learned from payout', { ruleId: rule.ruleId, multiplier: rule.multiplier, status: rule.status });

  if (getBorrower(b.p.holder)) {
    appendRecord(b.p.holder, 'payout', { policyId, payout: b.p.payout, path }, digest ? [digest] : []);
    void anchorPending(b.p.holder);
  }
  enqueueMemory({
    account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies,
    purpose: `policy:${policyId}:paid`,
    text: `policy paid ${b.asset} ${C.PREFIX.policy}${JSON.stringify({
      policyId, status: 'paid', path, payout: b.p.payout, premium: b.p.premium, digest,
    })}`,
  });
}

async function onExpired(policyId: string, digest: string): Promise<void> {
  const b = bucketsFor(policyId);
  if (!b || b.p.learned) return;
  markLearned(policyId);

  const nearMiss = b.p.near_miss === 1;
  if (nearMiss) {
    enqueueCase({
      v: 1, asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, durBucket: b.durBucket,
      outcome: 'near_miss', source: 'live', policyId, note: 'came within 3% of the trigger', at: Date.now(),
    }, `case:${policyId}`);
  }

  const r = matchRule(b.asset, b.volBucket, b.moneyBucket);
  if (r) {
    const quiet = r.quietExpiries + 1;
    let multiplier = r.multiplier;
    let status = r.status;
    if (quiet >= QUIET_RUN_BEFORE_DECAY) {
      multiplier = Number((r.multiplier * 0.9).toFixed(4));
      if (multiplier <= 1.05) status = 'retired';
    }
    saveRule({ ...r, multiplier, status, quietExpiries: quiet >= QUIET_RUN_BEFORE_DECAY ? 0 : quiet, updatedAt: Date.now() });
  }

  if (getBorrower(b.p.holder)) {
    appendRecord(b.p.holder, 'expired', { policyId, nearMiss }, digest ? [digest] : []);
    void anchorPending(b.p.holder);
  }
  enqueueMemory({
    account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies,
    purpose: `policy:${policyId}:expired`,
    text: `policy expired ${b.asset} ${C.PREFIX.policy}${JSON.stringify({ policyId, status: 'expired', nearMiss, digest })}`,
  });
}

/**
 * A borrower who reacts to a warning (deposits or repays on Suilend) gets a cheaper next quote.
 * Called by the liquidation watcher in P7 when it sees their Mainnet Deposit/Repay event.
 */
export function recordResponse(policyId: string, borrower: string, evidence: string[]): void {
  const row = getPolicyRow(policyId);
  if (!row || row.responded === 1 || !row.warned_at) return;
  if (Date.now() - row.warned_at > C.RESPONSE_WINDOW_MS) return;
  db.prepare('UPDATE policies SET responded = 1 WHERE id = ?').run(policyId);
  if (getBorrower(borrower)) {
    appendRecord(borrower, 'response', { policyId, withinMs: Date.now() - row.warned_at }, evidence);
    void anchorPending(borrower);
  }
}

export function startLearning(): void {
  bus.on('event', (ev: BusEvent) => {
    const d = ev.payload as { policyId?: string; path?: string; digest?: string } | undefined;
    if (!d?.policyId) return;
    if (ev.type === 'policy.paid') {
      void onPaid(d.policyId, d.path ?? 'price', d.digest ?? '').catch((e) => log.error('learning onPaid', { message: (e as Error).message }));
    }
    if (ev.type === 'policy.expired') {
      void onExpired(d.policyId, d.digest ?? '').catch((e) => log.error('learning onExpired', { message: (e as Error).message }));
    }
  });
  log.info('learning loop listening');
}
