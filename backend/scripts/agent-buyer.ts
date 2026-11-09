// An autonomous agent buying liquidation cover over HTTP 402, with no human in the loop.
//
// It asks for cover, gets a 402 with signed quote terms, decides whether the premium is acceptable,
// builds and signs the purchase transaction, and hands that signed transaction back as the x402
// payment payload. Paying and getting insured are therefore one atomic on-chain step.
//
// Usage: AGENT_PRIVATE_KEY=suiprivkey1… [MAX_PREMIUM_GUSD=2] [TRIGGER_PCT=0.92] pnpm agent
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { toBase64 } from '@mysten/sui/utils';
import { env, FEED_BY_ASSET } from '../src/config.js';
import { testnet, tatum } from '../src/chain/clients.js';
import { latestSpots } from '../src/chain/pyth.js';

const BASE = env.PUBLIC_BASE_URL;
const MAX_PREMIUM = Number(process.env.MAX_PREMIUM_GUSD ?? '2');
const TRIGGER_PCT = Number(process.env.TRIGGER_PCT ?? '0.92');
const PAYOUT = Number(process.env.PAYOUT_GUSD ?? '5');
const DAYS = Number(process.env.DAYS ?? '7');

const key = process.env.AGENT_PRIVATE_KEY;
if (!key) throw new Error('set AGENT_PRIVATE_KEY (a Testnet suiprivkey1… with SUI for gas)');
const agent = Ed25519Keypair.fromSecretKey(key);
const address = agent.toSuiAddress();
const step = (s: string) => console.log(`\n▶ ${s}`);

step(`agent wallet ${address}`);
const { balance } = await tatum(() => testnet.getBalance({ owner: address }));
console.log(`gas ${Number(balance.balance) / 1e9} SUI`);
if (Number(balance.balance) === 0) throw new Error('agent has no SUI for gas: run `sui client faucet` for this address');

// ---- 1. ask for cover, expect 402 ----
const spot = (await latestSpots([FEED_BY_ASSET.SUI])).get(FEED_BY_ASSET.SUI)!;
const want = {
  buyer: address,
  kind: 'price' as const,
  asset: 'SUI' as const,
  triggerPriceUsd: Number((spot.spotUsd * TRIGGER_PCT).toFixed(4)),
  payoutUsdc: PAYOUT,
  durationDays: DAYS,
};
step(`POST /v1/agent/cover (no payment) — SUI below $${want.triggerPriceUsd} for ${DAYS}d, payout ${PAYOUT} gUSD`);
const r402 = await fetch(`${BASE}/v1/agent/cover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(want),
});
const offer = await r402.json() as {
  x402Version: number;
  accepts: Array<{ network: string; amount: string; asset: string; payTo: string; extra: { quote: Quote } }>;
};
if (r402.status !== 402) throw new Error(`expected 402, got ${r402.status}: ${JSON.stringify(offer)}`);
const accepted = offer.accepts[0];
console.log(`402 Payment Required — x402Version ${offer.x402Version}, network ${accepted.network}`);

type Quote = {
  quoteId: string; kind: string; kindU8: 0 | 1; feedId: string; strikeE8: string; obligationId: string;
  payout: string; premium: string; startMs: number; endMs: number; expiresMs: number; signatureHex: string;
  pricing: { multiplier: number; probability: number }; citations: Array<{ blobId: string; kind: string; summary: string }>;
  explanation: string;
  moveCall: { target: string; typeArguments: [string]; argOrder: readonly string[] };
};
const q = accepted.extra.quote;
const premium = Number(q.premium) / 10 ** env.COIN_DECIMALS;
console.log(`premium ${premium} gUSD for ${Number(q.payout) / 10 ** env.COIN_DECIMALS} gUSD cover`);
console.log(`model probability ${(q.pricing.probability * 100).toFixed(1)}%, memory multiplier ×${q.pricing.multiplier}`);
for (const c of q.citations) console.log(`  cites ${c.kind} ${c.blobId.slice(0, 12)}… ${c.summary}`);

// ---- 2. the agent's own policy decision ----
if (premium > MAX_PREMIUM) {
  console.log(`\n✘ premium ${premium} gUSD exceeds MAX_PREMIUM_GUSD=${MAX_PREMIUM}; the agent declines.`);
  process.exit(0);
}
step(`premium within budget (${MAX_PREMIUM} gUSD): paying`);

// ---- 3. build and sign the purchase transaction (this IS the payment) ----
const bytesOf = (hex: string) => Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
const gusdPackage = env.COIN_TYPE.split('::')[0];
const tx = new Transaction();
tx.setSender(address);
// The agent funds its own premium from the public gUSD faucet.
const payment = tx.moveCall({
  target: `${gusdPackage}::gusd::mint`,
  arguments: [tx.object(env.GUSD_FAUCET_ID), tx.pure.u64(BigInt(q.premium))],
});
tx.moveCall({
  target: q.moveCall.target,
  typeArguments: q.moveCall.typeArguments,
  arguments: [
    tx.object(env.GHOSTWRITER_POOL_ID),
    tx.pure.u8(q.kindU8),
    tx.pure.vector('u8', bytesOf(q.feedId)),
    tx.pure.u64(BigInt(q.strikeE8)),
    tx.pure.address(q.obligationId),
    tx.pure.u64(BigInt(q.payout)),
    tx.pure.u64(BigInt(q.premium)),
    tx.pure.u64(q.startMs),
    tx.pure.u64(q.endMs),
    tx.pure.vector('u8', bytesOf(q.quoteId)),
    tx.pure.u64(q.expiresMs),
    tx.pure.vector('u8', bytesOf(q.signatureHex)),
    payment,
    tx.object.clock(),
  ],
});
const txBytes = await tx.build({ client: testnet });
const { signature } = await agent.signTransaction(txBytes);

const paymentPayload = {
  x402Version: 2,
  resource: { url: `${BASE}/v1/agent/cover` },
  accepted: {
    scheme: 'exact', network: accepted.network, amount: accepted.amount,
    asset: accepted.asset, payTo: accepted.payTo, maxTimeoutSeconds: 120, extra: {},
  },
  payload: { signature, transaction: toBase64(txBytes) },
};

// ---- 4. pay ----
step('POST /v1/agent/cover with PAYMENT-SIGNATURE');
const paid = await fetch(`${BASE}/v1/agent/cover`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'payment-signature': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
  },
  body: JSON.stringify(want),
});
const body = await paid.json();
console.log(`status ${paid.status}`);
const receipt = paid.headers.get('payment-response');
if (receipt) console.log('PAYMENT-RESPONSE', JSON.parse(Buffer.from(receipt, 'base64').toString('utf8')));
console.log(JSON.stringify(body, null, 1));

if (paid.status === 200) {
  const p = body as { policyId: string; status: string; payout: string };
  console.log(`\n✔ insured without a human: policy ${p.policyId} is ${p.status}`);
  console.log(`  https://suiscan.xyz/testnet/object/${p.policyId}`);
}
