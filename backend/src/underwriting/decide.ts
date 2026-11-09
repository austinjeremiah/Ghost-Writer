// The underwriting decision: whether to take this risk at all.
//
// Pricing answers "how much". This answers "should we, and on what terms" — the judgement a human
// underwriter makes before quoting. It is the difference between a parametric escrow and an
// underwriter: this one can refuse your money and say why.
//
// Architecture: judgement inside a mandate.
//   - The MANDATE is code (`guard` below): hard limits on capital and concentration that no
//     amount of model output can cross. The model cannot make the pool insolvent.
//   - The JUDGEMENT is the model, reasoning over recalled memory, its own past decisions, the
//     borrower's record and the live book. Inside the mandate it may still decline or counter.
//
// Every decision is written back to Walrus Memory, so tomorrow's decision recalls today's. That
// loop is the point: the book's appetite is learned, not configured.
import { C, env } from '../config.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { pool } from '../chain/poolCache.js';
import { complete } from '../pricing/explain.js';
import { underwriter, recall } from '../memory/client.js';
import { enqueueMemory } from '../memory/queue.js';
/** Structurally the same as pricing/quote.ts's Citation; declared here to avoid a cycle, since
 *  quote.ts imports this module. */
export type Citation = {
  namespace: string; blobId: string; kind: 'case' | 'rule' | 'record'; summary: string; distance?: number;
};

/** Fraction of free capital this pool will put behind any single policy. */
const MAX_SINGLE_SHARE = 0.25;
/** Fraction of free capital this pool will hold in one asset+moneyness bucket. */
const MAX_BUCKET_SHARE = 0.4;
/** Above this loss ratio the book is losing money and should be shrinking, not growing. */
const STRESSED_LOSS_RATIO = 1.5;

export type Verdict = 'accept' | 'counter' | 'decline';

export type CounterOffer = {
  /** Terms to re-request. Only the fields that change are set. */
  payoutUsdc?: number;
  triggerPriceUsd?: number;
  durationDays?: number;
  label: string;
};

export type Exposure = {
  freeUsd: number;
  /** Payout already committed in this asset + moneyness bucket. */
  bucketExposureUsd: number;
  /** This request as a share of free capital. */
  requestShare: number;
  /** Bucket exposure including this request, as a share of free capital. */
  bucketShareAfter: number;
  lossRatio: number;
  activePolicies: number;
};

export type Decision = {
  verdict: Verdict;
  reason: string;
  /** 'mandate' when code forced it, 'llm' when the model judged, 'rules' when the model was unavailable. */
  source: 'mandate' | 'llm' | 'rules';
  exposure: Exposure;
  counters: CounterOffer[];
  /** Past decisions the agent recalled while deciding. */
  citations: Citation[];
};

export type DecisionInput = {
  buyer: string;
  asset: string;
  payoutUsdc: number;
  triggerPriceUsd: number;
  durationDays: number;
  spotUsd: number;
  /** Buckets already computed by the pricer, so both agree on the key. */
  buckets: { asset: string; volBucket: string; moneyBucket: string; durBucket: string };
  /** The memory-derived multiplier the pricer arrived at, for context. */
  multiplier: number;
  probability: number;
  /** Borrower score, when they are registered. */
  borrower: { verified: boolean; payouts: number; responses: number } | null;
};

const DECIDE_SYSTEM = `You are the underwriting agent for a small parametric cover pool. Decide whether to take a risk.

You receive: the request, the pool's live exposure, memories of similar past cases, your own past decisions, and the borrower's record.

Reply with JSON only, no prose, no markdown fences:
{"verdict":"accept"|"counter"|"decline","reason":"<=40 words, plain English, cite a memory id or an exposure number"}

Guidance:
- accept when the pool has room and nothing in memory argues against it.
- counter when the risk is sound but the size or terms are wrong for this book.
- decline when memory or concentration says this is a bad risk at any size.
- Concentration matters: holding much of the book in one bucket is worse than the same amount spread out.
- A high hit rate in recalled cases is a reason for caution, not refusal, unless exposure is already heavy.
- Never invent numbers. Amounts are in the currency named in the facts.`;

/** Payout already committed in the same asset + moneyness bucket, in whole coins. */
function bucketExposureUsd(asset: string, moneyBucketKey: string, spotUsd: number): number {
  const rows = db.prepare(
    `SELECT strike_e8, payout FROM policies WHERE status IN ('active','breach') AND asset = ?`,
  ).all(asset) as Array<{ strike_e8: string; payout: string }>;
  let total = 0;
  for (const r of rows) {
    const strike = Number(r.strike_e8) / 1e8;
    // Same bucketing the pricer uses, recomputed against today's spot.
    const d = Math.round((1 - strike / spotUsd) * 1e6) / 1e6;
    const key = d < 0.05 ? '0-5' : d < 0.1 ? '5-10' : d < 0.15 ? '10-15' : d < 0.25 ? '15-25' : '25+';
    if (key === moneyBucketKey) total += Number(r.payout) / 10 ** env.COIN_DECIMALS;
  }
  return total;
}

/**
 * The mandate. Returns a forced verdict when a hard limit is crossed, otherwise null and the model
 * decides. These limits are deliberately in code: a memory is untrusted input, and no sentence a
 * model produces should be able to oversell the pool's capital.
 */
function guard(input: DecisionInput, e: Exposure, paused: boolean): { verdict: Verdict; reason: string } | null {
  if (paused) {
    return { verdict: 'decline', reason: 'The pool is paused, so no new cover is being written.' };
  }
  if (input.payoutUsdc > e.freeUsd) {
    return {
      verdict: 'decline',
      reason: `The pool has ${e.freeUsd.toFixed(2)} ${'gUSD'} free and cannot cover a ${input.payoutUsdc} payout.`,
    };
  }
  if (e.requestShare > MAX_SINGLE_SHARE) {
    return {
      verdict: 'counter',
      reason: `A single policy is capped at ${(MAX_SINGLE_SHARE * 100).toFixed(0)}% of free capital, which is ${(e.freeUsd * MAX_SINGLE_SHARE).toFixed(2)} gUSD here.`,
    };
  }
  if (e.bucketShareAfter > MAX_BUCKET_SHARE) {
    return {
      verdict: 'counter',
      reason: `This would put ${(e.bucketShareAfter * 100).toFixed(0)}% of the book in the ${input.buckets.moneyBucket}% bucket; the cap is ${(MAX_BUCKET_SHARE * 100).toFixed(0)}%.`,
    };
  }
  return null;
}

/** Terms this book would say yes to, derived from the limits that were crossed. */
function counterOffers(input: DecisionInput, e: Exposure): CounterOffer[] {
  const out: CounterOffer[] = [];
  const bySingle = e.freeUsd * MAX_SINGLE_SHARE;
  const byBucket = Math.max(0, e.freeUsd * MAX_BUCKET_SHARE - e.bucketExposureUsd);
  const maxPayout = Math.floor(Math.min(bySingle, byBucket) * 100) / 100;
  if (maxPayout >= 1 && maxPayout < input.payoutUsdc) {
    out.push({ payoutUsdc: maxPayout, label: `${maxPayout} gUSD payout instead` });
  }
  // A deeper trigger is a different bucket, so it does not add to the crowded one.
  const deeper = Math.round(input.spotUsd * 0.8 * 1e6) / 1e6;
  if (deeper < input.triggerPriceUsd) {
    out.push({ triggerPriceUsd: deeper, label: `same size, trigger at $${deeper.toFixed(4)}` });
  }
  return out;
}

const DECISION_PREFIX = 'GHOSTWRITER_DECISION_V1 ';

/** Past decisions for this bucket, so the agent is consistent with itself. */
async function pastDecisions(buckets: DecisionInput['buckets']): Promise<{ cites: Citation[]; text: string[] }> {
  const query = `underwriting decision ${buckets.asset} ${buckets.moneyBucket}% below spot ${buckets.durBucket} ${buckets.volBucket} vol`;
  try {
    const hits = await recall(underwriter, C.NS.decisions, query, 10);
    return {
      cites: hits.slice(0, 2).map((h) => ({
        namespace: C.NS.decisions, blobId: h.blobId, kind: 'rule' as const,
        summary: h.text.replace(DECISION_PREFIX, '').slice(0, 120), distance: h.distance,
      })),
      text: hits.slice(0, 5).map((h) => h.text.replace(DECISION_PREFIX, '').slice(0, 200)),
    };
  } catch (err) {
    log.warn('decision recall failed; deciding without precedent', { message: (err as Error).message });
    return { cites: [], text: [] };
  }
}

export async function decide(input: DecisionInput, caseCites: Citation[]): Promise<Decision> {
  const p = await pool();
  const freeUsd = Number(p.free) / 10 ** env.COIN_DECIMALS;
  const bucketExp = bucketExposureUsd(input.asset, input.buckets.moneyBucket, input.spotUsd);
  const exposure: Exposure = {
    freeUsd,
    bucketExposureUsd: bucketExp,
    requestShare: freeUsd > 0 ? input.payoutUsdc / freeUsd : 1,
    bucketShareAfter: freeUsd > 0 ? (bucketExp + input.payoutUsdc) / freeUsd : 1,
    lossRatio: p.premiumsCollected > 0n ? Number(p.payoutsMade) / Number(p.premiumsCollected) : 0,
    activePolicies: (db.prepare(`SELECT COUNT(*) AS n FROM policies WHERE status IN ('active','breach')`).get() as { n: number }).n,
  };

  const forced = guard(input, exposure, p.paused);
  const precedent = await pastDecisions(input.buckets);
  const citations = [...precedent.cites];

  let decision: Decision;
  if (forced) {
    // The mandate decided. The model is not consulted: no sentence may soften a hard limit.
    decision = {
      verdict: forced.verdict, reason: forced.reason, source: 'mandate',
      exposure, counters: forced.verdict === 'counter' ? counterOffers(input, exposure) : [], citations,
    };
  } else {
    const facts = {
      currency: 'gUSD',
      request: { asset: input.asset, payout: input.payoutUsdc, triggerUsd: input.triggerPriceUsd, days: input.durationDays, spotUsd: input.spotUsd },
      pricing: { probability: input.probability, memoryMultiplier: input.multiplier },
      bucket: input.buckets,
      exposure: {
        freeCapital: Number(freeUsd.toFixed(2)),
        alreadyInThisBucket: Number(bucketExp.toFixed(2)),
        thisRequestShareOfFree: Number(exposure.requestShare.toFixed(3)),
        bucketShareAfter: Number(exposure.bucketShareAfter.toFixed(3)),
        lossRatio: Number(exposure.lossRatio.toFixed(2)),
        activePolicies: exposure.activePolicies,
        stressed: exposure.lossRatio > STRESSED_LOSS_RATIO,
      },
      recalledCases: caseCites.map((c) => ({ id: c.blobId.slice(0, 8), summary: c.summary })),
      pastDecisions: precedent.text,
      borrower: input.borrower,
    };
    const raw = await complete(DECIDE_SYSTEM, facts, 400);
    const parsed = parseVerdict(raw);
    if (parsed) {
      decision = {
        verdict: parsed.verdict, reason: parsed.reason, source: 'llm',
        exposure, counters: parsed.verdict === 'counter' ? counterOffers(input, exposure) : [], citations,
      };
    } else {
      // Model unavailable or unparseable: inside the mandate, the safe default is to take the risk
      // we already priced. Declining on an infrastructure failure would be worse than accepting.
      decision = {
        verdict: 'accept', source: 'rules', exposure, counters: [], citations,
        reason: `Within limits: ${input.payoutUsdc} gUSD is ${(exposure.requestShare * 100).toFixed(0)}% of free capital and the ${input.buckets.moneyBucket}% bucket stays under the cap.`,
      };
    }
  }

  writeDecision(input, decision);
  return decision;
}

/** The model is asked for JSON; accept it with or without fences, and never trust the shape. */
function parseVerdict(raw: string | null): { verdict: Verdict; reason: string } | null {
  if (!raw) return null;
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown };
    const v = String(o.verdict ?? '').toLowerCase();
    if (v !== 'accept' && v !== 'counter' && v !== 'decline') return null;
    const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim().slice(0, 300) : null;
    if (!reason) return null;
    return { verdict: v as Verdict, reason };
  } catch {
    return null;
  }
}

/** Write the decision to Walrus so the next one can recall it. Queued, so it never blocks a quote. */
function writeDecision(input: DecisionInput, d: Decision) {
  enqueueMemory({
    account: 'underwriter',
    accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
    namespace: C.NS.decisions,
    purpose: `decision:${input.buyer.slice(0, 10)}:${Date.now()}`,
    text: `${DECISION_PREFIX}${JSON.stringify({
      verdict: d.verdict, reason: d.reason, source: d.source,
      asset: input.asset, moneyBucket: input.buckets.moneyBucket, durBucket: input.buckets.durBucket,
      volBucket: input.buckets.volBucket, payout: input.payoutUsdc, multiplier: input.multiplier,
      freeCapital: Number(d.exposure.freeUsd.toFixed(2)),
      bucketShareAfter: Number(d.exposure.bucketShareAfter.toFixed(3)),
      at: Date.now(),
    })}`,
  });
}
