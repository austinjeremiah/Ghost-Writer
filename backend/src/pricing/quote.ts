// Pricing. Every number here is deterministic; memory moves the multiplier, never the maths.
//
//   premium = payout × P(touch) × (1 + loading) × clamp(cases × rules × borrower)
//
// The three factors are the product's point: cases are back-tested and live outcomes recalled from
// Walrus, rules are what the underwriter learned, borrower is their own verified history. Each one
// that moves the price is cited by blob id so the buyer can read the memory that charged them.
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { db } from '../db.js';
import { env, C, ENABLED_ASSETS, FEED_BY_ASSET, type Asset } from '../config.js';
import { AppError } from '../errors.js';
import { decide, type Decision } from '../underwriting/decide.js';
import { latestSpots, assertFresh } from '../chain/pyth.js';
import { pool } from '../chain/poolCache.js';
import { signQuote, type QuoteTerms } from '../chain/quoteMessage.js';
import { listObligations } from '../chain/suilend.js';
import { annualVol } from './vol.js';
import { firstPassageProb, clamp } from './math.js';
import { volBucket, moneyBucket, durBucket } from './buckets.js';
import { similarCases, type CaseHit } from '../memory/cases.js';
import { matchRule } from '../memory/rules.js';
import { getBorrower, verifyHistory, scoreFrom, localScore } from '../memory/records.js';
import { explainQuote } from './explain.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export const quotePubHex = bytesToHex(ed25519.getPublicKey(hexToBytes(env.QUOTE_SIGNING_KEY_HEX)));

const Addr = z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a));

export const QuoteInput = z.object({
  buyer: Addr,
  kind: z.enum(['price', 'liquidation']),
  asset: z.string().refine((a): a is Asset => ENABLED_ASSETS.includes(a as Asset), `asset must be one of ${ENABLED_ASSETS.join(', ')}`),
  triggerPriceUsd: z.number().positive(),
  payoutUsdc: z.number().min(1).max(1000),
  durationDays: z.number().int().min(1).max(30),
  obligationId: Addr.optional(),
}).refine((v) => v.kind === 'price' || !!v.obligationId, {
  message: 'obligationId is required for liquidation cover',
  path: ['obligationId'],
});
export type QuoteInputT = z.infer<typeof QuoteInput>;

export type Citation = {
  namespace: string; blobId: string; kind: 'case' | 'rule' | 'record'; summary: string; distance?: number;
};

/**
 * Case factor: how often cover like this actually paid, versus what the model predicts.
 *
 * The backtest counts true barrier touches (intraday lows), so comparing its rate with the model's
 * probability is like-for-like and may legitimately pull the price either way. It is Laplace-
 * smoothed, weighted by sample size, and clamped so one thin bucket cannot dominate.
 *
 * Only an EXACT bucket match may set a base rate: a neighbouring bucket's hit rate is a different
 * number, not a noisy version of this one.
 */
function caseFactor(hits: CaseHit[], p: number): { f: number; cites: Citation[] } {
  const cites: Citation[] = [];
  let f = 1;

  const bt = hits
    .filter((h) => h.exact && h.rec.source === 'backtest' && (h.rec.n ?? 0) > 0)
    .sort((a, b) => (b.rec.n ?? 0) - (a.rec.n ?? 0))[0];
  if (bt) {
    const n = bt.rec.n!;
    const k = bt.rec.hits ?? 0;
    const observed = (k + 1) / (n + 2);
    const ratio = observed / Math.max(p, 1e-4);
    const w = Math.min(n, 50) / 50;
    const g = clamp(ratio, 0.7, 1.8) ** w;
    f *= g;
    cites.push({
      namespace: C.NS.cases, blobId: bt.blobId, kind: 'case', distance: bt.distance,
      summary: `backtest ${bt.rec.asset} ${bt.rec.moneyBucket}% ${bt.rec.durBucket}: ${k}/${n} touched (${(observed * 100).toFixed(1)}%) → ×${g.toFixed(2)}`,
    });
  }

  // Live outcomes compound on top: each real payout in this bucket is evidence the model is light.
  // Here the neighbourhood counts — a payout one bucket away is still a warning.
  const live = hits.filter((h) => h.rec.source === 'live');
  const payouts = live.filter((h) => h.rec.outcome === 'payout');
  const near = live.filter((h) => h.rec.outcome === 'near_miss');
  f *= Math.min(3, 1.15 ** payouts.length * 1.05 ** near.length);
  for (const h of [...payouts, ...near].slice(0, 5)) {
    cites.push({
      namespace: C.NS.cases, blobId: h.blobId, kind: 'case', distance: h.distance,
      summary: `${h.rec.outcome} on ${h.rec.policyId?.slice(0, 10) ?? 'a policy'} (${h.rec.moneyBucket}% below)`,
    });
  }
  return { f, cites };
}

export type QuoteDTO = ReturnType<typeof toDTO>;

function toDTO(x: {
  terms: QuoteTerms; asset: Asset; signatureHex: string; spotUsd: number; vol: number; probability: number;
  base: bigint; mult: number; factors: { cases: number; rules: number; borrower: number };
  citations: Citation[]; explanation: { text: string; source: 'llm' | 'fallback' }; obligationVerified: boolean | null;
  decision: Decision;
}) {
  const q = x.terms;
  return {
    quoteId: q.quoteIdHex,
    buyer: q.buyer,
    kind: (q.kind === 0 ? 'price' : 'liquidation') as 'price' | 'liquidation',
    kindU8: q.kind,
    asset: x.asset,
    feedId: q.feedIdHex,
    strikeE8: q.strikeE8.toString(),
    obligationId: q.obligationId,
    obligationVerified: x.obligationVerified,
    payout: q.payout.toString(),
    premium: q.premium.toString(),
    startMs: q.startMs,
    endMs: q.endMs,
    expiresMs: q.expiresMs,
    signatureHex: x.signatureHex,
    /** Why the underwriter agreed to take this risk, and the exposure it weighed. */
    underwriting: {
      verdict: x.decision.verdict,
      reason: x.decision.reason,
      source: x.decision.source,
      exposure: x.decision.exposure,
    },
    pricing: {
      spotUsd: x.spotUsd,
      volAnnual: Number(x.vol.toFixed(4)),
      probability: Number(x.probability.toFixed(6)),
      basePremium: x.base.toString(),
      multiplier: Number(x.mult.toFixed(4)),
      factors: x.factors,
    },
    citations: x.citations,
    explanation: x.explanation.text,
    explanationSource: x.explanation.source,
    moveCall: {
      target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::buy`,
      typeArguments: [env.COIN_TYPE] as [string],
      argOrder: [
        'pool', 'kind', 'feedId', 'strikeE8', 'obligationId', 'payout', 'premium',
        'startMs', 'endMs', 'quoteId', 'expiresMs', 'signature', 'payment', 'clock',
      ] as const,
    },
  };
}

export async function makeQuote(input: QuoteInputT): Promise<QuoteDTO> {
  const feedId = FEED_BY_ASSET[input.asset];

  // Liquidation cover is only meaningful on a position the buyer actually holds: without this check
  // anyone could insure a stranger's obligation that is visibly about to be liquidated.
  let obligationVerified: boolean | null = null;
  if (input.kind === 'liquidation') {
    if (!getBorrower(input.buyer)) {
      throw new AppError('NOT_FOUND', 'register your Walrus Memory account before buying liquidation cover');
    }
    if (env.SUILEND_OBLIGATION_CAP_TYPE) {
      const owned = await listObligations(input.buyer);
      obligationVerified = owned.some((o) => normalizeSuiAddress(o.obligationId) === input.obligationId);
      if (!obligationVerified) {
        throw new AppError('BAD_REQUEST', 'that Suilend obligation is not held by this address', { obligationId: input.obligationId });
      }
    } else {
      // Unverifiable rather than verified: the quote says so, and it is visible in the DTO.
      obligationVerified = null;
      log.warn('obligation ownership unverified (SUILEND_OBLIGATION_CAP_TYPE unset)', { buyer: input.buyer.slice(0, 10) + '…' });
    }
  }

  const spot = (await latestSpots([feedId])).get(feedId);
  if (!spot) throw new AppError('UPSTREAM_TATUM', 'no on-chain price for this feed', { feedId });
  assertFresh(spot, env.MAX_PRICE_AGE_S);
  if (input.triggerPriceUsd >= spot.spotUsd) {
    throw new AppError('BAD_REQUEST', `trigger must be below spot ($${spot.spotUsd.toFixed(4)})`);
  }

  const vol = await annualVol(input.asset);
  const T = input.durationDays / 365;
  const p = firstPassageProb(spot.spotUsd, input.triggerPriceUsd, vol, T);
  const payout = BigInt(Math.round(input.payoutUsdc * 10 ** env.COIN_DECIMALS));
  const base = BigInt(Math.round(Number(payout) * p * (1 + C.LOADING)));

  const buckets = {
    asset: input.asset,
    volBucket: volBucket(vol),
    moneyBucket: moneyBucket(spot.spotUsd, input.triggerPriceUsd),
    durBucket: durBucket(input.durationDays),
  };

  // A relayer hiccup must never stop a quote: each memory factor falls back to neutral and says so.
  const citations: Citation[] = [];
  let fCases = 1;
  try {
    const cf = caseFactor(await similarCases(buckets), p);
    fCases = cf.f;
    citations.push(...cf.cites);
  } catch (e) {
    log.warn('case recall failed; neutral case factor', { message: (e as Error).message });
  }

  let fRules = 1;
  const rule = matchRule(buckets.asset, buckets.volBucket, buckets.moneyBucket);
  if (rule) {
    fRules = rule.multiplier;
    if (rule.blobId) {
      citations.push({
        namespace: C.NS.rules, blobId: rule.blobId, kind: 'rule',
        summary: `${rule.status} rule ×${rule.multiplier.toFixed(2)}: ${rule.lesson}`,
      });
    }
  }

  let fBorrower = 1;
  if (getBorrower(input.buyer)) {
    try {
      const h = await verifyHistory(input.buyer);
      fBorrower = scoreFrom(h.records, h.verification.valid).discountFactor;
      for (const r of h.records.slice(-3)) {
        if (r.blobId) {
          citations.push({
            namespace: C.NS.history, blobId: r.blobId, kind: 'record',
            summary: `your record #${r.seq}: ${r.kind}`,
          });
        }
      }
    } catch (e) {
      fBorrower = localScore(input.buyer).discountFactor;
      log.warn('history verify failed; using local score', { message: (e as Error).message });
    }
  }

  const mult = clamp(fCases * fRules * fBorrower, C.MULT_MIN, C.MULT_MAX);
  let premium = BigInt(Math.round(Number(base) * mult));
  if (premium < C.MIN_PREMIUM) premium = C.MIN_PREMIUM;
  if (premium >= payout) {
    throw new AppError('BAD_REQUEST', 'cover is too likely to pay out at this trigger; choose a lower trigger or a shorter duration');
  }

  // ---- underwriting decision -------------------------------------------------------------
  // Pricing has answered "how much". Now the agent decides whether this book should take it at
  // all, reasoning over its live exposure, the cases just recalled, and its own past verdicts.
  // A refusal is returned to the caller rather than thrown: the UI shows the reason and the
  // counter-offers, which is the point of having an underwriter rather than a formula.
  const decision = await decide(
    {
      buyer: input.buyer, asset: input.asset, payoutUsdc: input.payoutUsdc,
      triggerPriceUsd: input.triggerPriceUsd, durationDays: input.durationDays,
      spotUsd: spot.spotUsd, buckets, multiplier: mult, probability: p,
      borrower: getBorrower(input.buyer)
        ? { verified: true, payouts: 0, responses: 0 }
        : null,
    },
    citations,
  );
  if (decision.verdict !== 'accept') {
    throw new AppError('UNDERWRITING_DECLINED', decision.reason, {
      verdict: decision.verdict,
      counters: decision.counters,
      exposure: decision.exposure,
      citations: decision.citations,
    });
  }

  // Refuse rather than issue a quote whose buy would abort for capacity (abort 6).
  const p0 = await pool();
  if (p0.paused) throw new AppError('CONFLICT', 'the underwriter is paused');
  if (p0.free + premium < payout) {
    throw new AppError('CONFLICT', 'not enough free capacity in the pool for this payout', {
      freeBaseUnits: p0.free.toString(), payoutBaseUnits: payout.toString(),
    });
  }

  const now = Date.now();
  const terms: QuoteTerms = {
    poolId: normalizeSuiAddress(env.GHOSTWRITER_POOL_ID),
    buyer: input.buyer,
    kind: input.kind === 'price' ? 0 : 1,
    feedIdHex: feedId,
    strikeE8: BigInt(Math.round(input.triggerPriceUsd * 1e8)),
    obligationId: input.kind === 'liquidation' ? input.obligationId! : C.ZERO_ADDRESS,
    payout,
    premium,
    startMs: now,
    endMs: now + input.durationDays * 86_400_000,
    quoteIdHex: randomBytes(16).toString('hex'),
    expiresMs: now + C.QUOTE_TTL_MS,
  };
  const signatureHex = signQuote(terms, env.QUOTE_SIGNING_KEY_HEX);

  const factors = {
    cases: Number(fCases.toFixed(4)),
    rules: Number(fRules.toFixed(4)),
    borrower: Number(fBorrower.toFixed(4)),
  };
  const explanation = await explainQuote({
    asset: input.asset, spotUsd: spot.spotUsd, triggerUsd: input.triggerPriceUsd, days: input.durationDays,
    volAnnual: Number(vol.toFixed(4)), probability: Number(p.toFixed(4)),
    // The key names are what the model reads for the unit: `payoutUsdc` made it write "USDC",
    // which is the wrong coin — the pool settles in gUSD.
    currency: 'gUSD', payout: input.payoutUsdc,
    // Rounded, or the model repeats all six decimals back at the reader.
    premium: Number((Number(premium) / 10 ** env.COIN_DECIMALS).toFixed(2)), multiplier: Number(mult.toFixed(3)), factors,
    memories: citations.map((c) => ({ id: c.blobId.slice(0, 8), kind: c.kind, summary: c.summary })),
  });

  const dto = toDTO({
    terms, asset: input.asset, signatureHex, spotUsd: spot.spotUsd, vol, probability: p,
    base, mult, factors, citations, explanation, obligationVerified, decision,
  });

  db.prepare(
    `INSERT INTO quotes(id, buyer, kind, asset, feed_id, strike_e8, obligation_id, payout, premium,
       start_ms, end_ms, expires_ms, signature, dto, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
  ).run(
    terms.quoteIdHex, terms.buyer, terms.kind, input.asset, feedId, terms.strikeE8.toString(), terms.obligationId,
    payout.toString(), premium.toString(), terms.startMs, terms.endMs, terms.expiresMs, signatureHex,
    JSON.stringify(dto), now,
  );
  emit('quote.issued', {
    quoteId: terms.quoteIdHex, buyer: terms.buyer, premium: premium.toString(), multiplier: dto.pricing.multiplier,
  });
  return dto;
}

export type QuoteStatus = 'issued' | 'used' | 'expired';

export function getQuote(id: string): (QuoteDTO & { status: QuoteStatus }) | null {
  const r = db.prepare('SELECT dto, status, expires_ms FROM quotes WHERE id = ?').get(id) as
    { dto: string; status: string; expires_ms: number } | undefined;
  if (!r) return null;
  const status: QuoteStatus = r.status === 'issued' && Date.now() > r.expires_ms ? 'expired' : (r.status as QuoteStatus);
  return { ...(JSON.parse(r.dto) as QuoteDTO), status };
}

export const markQuoteUsed = (id: string) =>
  db.prepare(`UPDATE quotes SET status = 'used' WHERE id = ?`).run(id);
