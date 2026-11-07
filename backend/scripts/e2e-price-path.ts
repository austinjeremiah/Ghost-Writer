// Live end-to-end check of the price-cover payout path on Sui Testnet, using the real on-chain Pyth price.
// The server wallet buys a small policy whose trigger is ABOVE today's SUI price, so the price is already
// "below the trigger": report_breach → wait confirm delay → confirm_breach pays out.
// Usage: pnpm e2e:price
import { randomBytes } from 'node:crypto';
import { Transaction } from '@mysten/sui/transactions';
import { env, FEED_BY_ASSET } from '../src/config.js';
import { execServer, idsOfType, serverAddress, tatum, testnet } from '../src/chain/clients.js';
import { readPolicy, readPool } from '../src/chain/objects.js';
import { assertFresh, latestSpots } from '../src/chain/pyth.js';
import { confirmBreach, reportBreach } from '../src/chain/ghostwriterTx.js';
import { signQuote, type QuoteTerms } from '../src/chain/quoteMessage.js';
import { sleep } from '../src/util/sleep.js';

const step = (s: string) => console.log(`\n▶ ${s}`);
const feed = FEED_BY_ASSET.SUI;
const pool0 = await readPool();

step('read on-chain SUI/USD');
const spot = (await latestSpots([feed])).get(feed)!;
assertFresh(spot, pool0.maxPriceAgeS);
console.log(`spot $${spot.spotUsd.toFixed(4)}, ${Math.round((Date.now() - spot.publishMs) / 1000)} s old`);

step('sign a quote (trigger 5% above spot) and buy it as the server wallet');
const now = Date.now();
const q: QuoteTerms = {
  poolId: env.GHOSTWRITER_POOL_ID, buyer: serverAddress, kind: 0, feedIdHex: feed,
  strikeE8: (spot.priceE8 * 105n) / 100n, obligationId: '0x0',
  payout: 5_000_000n, premium: 100_000n, // 5 gUSD cover for 0.10 gUSD
  startMs: now - 10_000, endMs: now + 3_600_000, quoteIdHex: randomBytes(16).toString('hex'), expiresMs: now + 120_000,
};
const sig = signQuote(q, env.QUOTE_SIGNING_KEY_HEX);
const gusdPackage = env.COIN_TYPE.split('::')[0];
const tx = new Transaction();
const pay = tx.moveCall({ target: `${gusdPackage}::gusd::mint`, arguments: [tx.object(env.GUSD_FAUCET_ID), tx.pure.u64(q.premium)] });
const b = (hex: string) => Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
tx.moveCall({
  target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::buy`,
  typeArguments: [env.COIN_TYPE],
  arguments: [
    tx.object(env.GHOSTWRITER_POOL_ID), tx.pure.u8(q.kind), tx.pure.vector('u8', b(q.feedIdHex)), tx.pure.u64(q.strikeE8),
    tx.pure.address(q.obligationId), tx.pure.u64(q.payout), tx.pure.u64(q.premium), tx.pure.u64(q.startMs), tx.pure.u64(q.endMs),
    tx.pure.vector('u8', b(q.quoteIdHex)), tx.pure.u64(q.expiresMs), tx.pure.vector('u8', b(sig)), pay, tx.object.clock(),
  ],
});
const bought = await execServer(tx, 'buy');
const policyId = idsOfType(bought.objectTypes, '::ghostwriter::Policy<')[0];
console.log('buy', bought.digest, 'policy', policyId);
const pool1 = await readPool();
console.log(`pool locked ${pool1.locked} (was ${pool0.locked}), premiums ${pool1.premiumsCollected}`);

step('report_breach with the on-chain price object');
const rep = await reportBreach(policyId, feed);
const p1 = await readPolicy(policyId);
console.log('report', rep.digest, 'breachStartedMs', p1.breachStartedMs);

const waitMs = p1.breachStartedMs + pool1.confirmDelayMs - Date.now() + 5_000;
step(`wait ${Math.round(waitMs / 1000)} s for the confirm delay`);
await sleep(Math.max(0, waitMs));

step('confirm_breach → payout');
const before = (await tatum(() => testnet.getBalance({ owner: serverAddress, coinType: env.COIN_TYPE }))).balance.balance;
const conf = await confirmBreach(policyId, feed);
const p2 = await readPolicy(policyId);
const after = (await tatum(() => testnet.getBalance({ owner: serverAddress, coinType: env.COIN_TYPE }))).balance.balance;
const pool2 = await readPool();
console.log('confirm', conf.digest, 'policy status', p2.status, '(1 = paid)');
console.log(`holder gUSD ${before} → ${after} (+${BigInt(after) - BigInt(before)})`);
console.log(`pool locked ${pool2.locked}, payouts made ${pool2.payoutsMade}`);
if (p2.status !== 1 || BigInt(after) - BigInt(before) !== q.payout) { console.error('\n✘ payout path FAILED'); process.exit(1); }
console.log('\n✔ price-cover payout path works end-to-end on testnet');
