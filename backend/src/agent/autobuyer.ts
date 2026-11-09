// A buying agent you instruct in English.
//
// The scene this exists for: a person writes "cover my SUI if it drops 15% over 3 days, don't pay
// more than 4 gUSD", and a program with its own wallet turns that into a mandate, asks for a
// price, checks the premium against its own limit, signs, pays, and comes back insured. No form,
// no human approving the purchase.
//
// Two halves, deliberately separated:
//   parseBrief  — the model turns prose into a mandate. It chooses numbers, nothing else.
//   runMandate  — plain code does the x402 purchase. The model never touches a signature.
//
// The agent is a different party from the underwriter and from the person: its own keypair, its
// own gas, its own gUSD. If it paid from the visitor's wallet the demo would prove nothing.
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { toBase64 } from '@mysten/sui/utils';
import { env, FEED_BY_ASSET } from '../config.js';
import { testnet, tatum } from '../chain/clients.js';
import { latestSpots } from '../chain/pyth.js';
import { complete } from '../pricing/explain.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';

export type Mandate = {
  asset: 'SUI';
  /** Trigger as a fraction of spot, e.g. 0.85 for "if it drops 15%". */
  triggerPct: number;
  payoutUsdc: number;
  durationDays: number;
  /** The agent will not pay more than this. Its whole authority in one number. */
  maxPremiumUsdc: number;
};

export type Step = {
  title: string;
  detail?: string;
  /** Shown as code when present: the actual request, header or digest. */
  data?: string;
  ok: boolean;
};

export type AgentRun = {
  brief: string;
  mandate: Mandate;
  mandateSource: 'llm' | 'fallback';
  steps: Step[];
  outcome: 'insured' | 'declined' | 'failed';
  policyId: string | null;
  buyDigest: string | null;
  premiumUsdc: number | null;
};

const BRIEF_SYSTEM = `You turn a person's instruction into an insurance mandate for a buying agent.

Reply with JSON only, no prose, no markdown fences:
{"triggerPct":<0.5-0.995>,"payoutUsdc":<1-1000>,"durationDays":<1-30>,"maxPremiumUsdc":<0.1-1000>}

- triggerPct is the trigger as a fraction of today's price. "drops 15%" -> 0.85. "falls below 10%" -> 0.90.
- If the instruction gives an absolute trigger price, still return a fraction using the spot price provided.
- payoutUsdc is how much cover they want. Default 5 if unstated.
- durationDays defaults to 7 if unstated.
- maxPremiumUsdc is the most the agent may pay. If unstated, use 20% of payoutUsdc.
- Only the numbers. Never explain.`;

const DEFAULTS: Mandate = { asset: 'SUI', triggerPct: 0.85, payoutUsdc: 5, durationDays: 7, maxPremiumUsdc: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export async function parseBrief(brief: string, spotUsd: number): Promise<{ mandate: Mandate; source: 'llm' | 'fallback' }> {
  const raw = await complete(BRIEF_SYSTEM, { instruction: brief, spotUsd, currency: 'gUSD' }, 300);
  const m = raw && /\{[\s\S]*\}/.exec(raw);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as Record<string, unknown>;
      const num = (k: string, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d);
      return {
        source: 'llm',
        mandate: {
          asset: 'SUI',
          triggerPct: clamp(num('triggerPct', DEFAULTS.triggerPct), 0.5, 0.995),
          payoutUsdc: clamp(num('payoutUsdc', DEFAULTS.payoutUsdc), 1, 1000),
          durationDays: Math.round(clamp(num('durationDays', DEFAULTS.durationDays), 1, 30)),
          maxPremiumUsdc: clamp(num('maxPremiumUsdc', DEFAULTS.maxPremiumUsdc), 0.1, 1000),
        },
      };
    } catch {
      /* fall through */
    }
  }
  log.warn('brief parse failed; using defaults', { brief: brief.slice(0, 80) });
  return { mandate: DEFAULTS, source: 'fallback' };
}

const bytesOf = (hex: string) => Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

type Quote = {
  quoteId: string; kindU8: 0 | 1; feedId: string; strikeE8: string; obligationId: string;
  payout: string; premium: string; startMs: number; endMs: number; expiresMs: number; signatureHex: string;
  pricing: { multiplier: number; probability: number };
  citations: Array<{ blobId: string; kind: string; summary: string }>;
  moveCall: { target: string; typeArguments: [string]; argOrder: readonly string[] };
};

export async function runMandate(brief: string, mandate: Mandate, source: 'llm' | 'fallback'): Promise<AgentRun> {
  const steps: Step[] = [];
  const out: AgentRun = {
    brief, mandate, mandateSource: source, steps,
    outcome: 'failed', policyId: null, buyDigest: null, premiumUsdc: null,
  };

  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new AppError('INTERNAL', 'AGENT_PRIVATE_KEY is not set, so there is no agent to act');
  const agent = Ed25519Keypair.fromSecretKey(key);
  const address = agent.toSuiAddress();

  const { balance } = await tatum(() => testnet.getBalance({ owner: address }));
  const gas = Number(balance.balance) / 1e9;
  steps.push({
    ok: gas > 0, title: 'The agent checks its own wallet',
    detail: `${gas.toFixed(3)} SUI for gas. It pays for itself; it never touches your wallet.`,
    data: address,
  });
  if (gas === 0) { out.outcome = 'failed'; return out; }

  const spot = (await latestSpots([FEED_BY_ASSET.SUI])).get(FEED_BY_ASSET.SUI)!;
  const want = {
    buyer: address, kind: 'price' as const, asset: 'SUI' as const,
    triggerPriceUsd: Number((spot.spotUsd * mandate.triggerPct).toFixed(4)),
    payoutUsdc: mandate.payoutUsdc, durationDays: mandate.durationDays,
  };
  steps.push({
    ok: true, title: 'It turns your words into terms',
    detail: `Cover ${want.payoutUsdc} gUSD if SUI falls below $${want.triggerPriceUsd} within ${want.durationDays} days. It will not pay more than ${mandate.maxPremiumUsdc} gUSD.`,
    data: JSON.stringify(want),
  });

  // 1 — ask, and expect to be charged.
  const base = env.PUBLIC_BASE_URL;
  const r402 = await fetch(`${base}/v1/agent/cover`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(want),
  });
  const offer = (await r402.json()) as { x402Version: number; accepts: Array<{ network: string; amount: string; asset: string; payTo: string; extra: { quote: Quote } }>; error?: { message?: string } };
  if (r402.status !== 402) {
    steps.push({ ok: false, title: `Asked for cover, got HTTP ${r402.status}`, detail: offer?.error?.message ?? 'expected a 402 payment request' });
    return out;
  }
  const accepted = offer.accepts[0];
  const q = accepted.extra.quote;
  const premium = Number(q.premium) / 10 ** env.COIN_DECIMALS;
  out.premiumUsdc = premium;
  steps.push({
    ok: true, title: 'The underwriter answers 402 Payment Required',
    detail: `${premium} gUSD for ${Number(q.payout) / 10 ** env.COIN_DECIMALS} gUSD of cover. Memory multiplier ×${q.pricing.multiplier}.`,
    data: `x402 v${offer.x402Version} · ${accepted.network} · pay ${accepted.amount} to ${accepted.payTo.slice(0, 10)}…`,
  });
  if (q.citations?.length) {
    steps.push({
      ok: true, title: 'The price cites the memories behind it',
      detail: q.citations.map((c) => `${c.blobId.slice(0, 8)} — ${c.summary}`).join('\n'),
    });
  }

  // 2 — the agent's own call. This is the only judgement it makes, and it is its whole authority.
  if (premium > mandate.maxPremiumUsdc) {
    steps.push({
      ok: false, title: 'The agent declines',
      detail: `${premium} gUSD is over its ${mandate.maxPremiumUsdc} gUSD limit, so it walks away without paying.`,
    });
    out.outcome = 'declined';
    return out;
  }
  steps.push({
    ok: true, title: 'Within its limit, so it decides to buy',
    detail: `${premium} gUSD is under the ${mandate.maxPremiumUsdc} gUSD it was allowed to spend.`,
  });

  // 3 — the payment *is* the purchase: one signed transaction that mints the premium and buys.
  const gusdPackage = env.COIN_TYPE.split('::')[0];
  const tx = new Transaction();
  tx.setSender(address);
  const payment = tx.moveCall({
    target: `${gusdPackage}::gusd::mint`,
    arguments: [tx.object(env.GUSD_FAUCET_ID), tx.pure.u64(BigInt(q.premium))],
  });
  tx.moveCall({
    target: q.moveCall.target,
    typeArguments: q.moveCall.typeArguments,
    arguments: [
      tx.object(env.GHOSTWRITER_POOL_ID), tx.pure.u8(q.kindU8), tx.pure.vector('u8', bytesOf(q.feedId)),
      tx.pure.u64(BigInt(q.strikeE8)), tx.pure.address(q.obligationId), tx.pure.u64(BigInt(q.payout)),
      tx.pure.u64(BigInt(q.premium)), tx.pure.u64(q.startMs), tx.pure.u64(q.endMs),
      tx.pure.vector('u8', bytesOf(q.quoteId)), tx.pure.u64(q.expiresMs),
      tx.pure.vector('u8', bytesOf(q.signatureHex)), payment, tx.object.clock(),
    ],
  });
  const txBytes = await tx.build({ client: testnet });
  const { signature } = await agent.signTransaction(txBytes);
  steps.push({
    ok: true, title: 'It signs the purchase itself',
    detail: 'In x402 the payment is the purchase: one transaction mints the premium and buys the policy, so paying and being covered cannot come apart.',
  });

  const paymentPayload = {
    x402Version: 2,
    resource: { url: `${base}/v1/agent/cover` },
    accepted: { scheme: 'exact', network: accepted.network, amount: accepted.amount, asset: accepted.asset, payTo: accepted.payTo, maxTimeoutSeconds: 120, extra: {} },
    payload: { signature, transaction: toBase64(txBytes) },
  };
  const paid = await fetch(`${base}/v1/agent/cover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'payment-signature': Buffer.from(JSON.stringify(paymentPayload)).toString('base64') },
    body: JSON.stringify(want),
  });
  const body = (await paid.json()) as { policyId?: string; status?: string; buyDigest?: string; error?: { message?: string } };
  if (paid.status !== 200 || !body.policyId) {
    steps.push({ ok: false, title: `Payment rejected (HTTP ${paid.status})`, detail: body?.error?.message ?? 'the underwriter did not accept the payment' });
    return out;
  }
  out.policyId = body.policyId;
  out.buyDigest = body.buyDigest ?? null;
  out.outcome = 'insured';
  steps.push({
    ok: true, title: 'Insured, with no human in the loop',
    detail: `Policy ${body.policyId.slice(0, 12)}… is ${body.status}. The holder is the agent's own address.`,
    data: body.buyDigest ?? undefined,
  });
  return out;
}

export async function runBrief(brief: string): Promise<AgentRun> {
  const spot = (await latestSpots([FEED_BY_ASSET.SUI])).get(FEED_BY_ASSET.SUI)!;
  const { mandate, source } = await parseBrief(brief, spot.spotUsd);
  return runMandate(brief, mandate, source);
}
