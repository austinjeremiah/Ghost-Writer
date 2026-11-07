// Usage: pnpm pool:fund <amount in gUSD, e.g. 500>
// Mints gUSD from the shared faucet (max 1,000 per mint call) and deposits it into the pool, in one tx.
import { Transaction } from '@mysten/sui/transactions';
import { env } from '../src/config.js';
import { execServer } from '../src/chain/clients.js';
import { readPool } from '../src/chain/objects.js';

const MAX_PER_MINT = 1_000n * 10n ** BigInt(env.COIN_DECIMALS);
const amount = BigInt(Math.round(Number(process.argv[2] ?? '0') * 10 ** env.COIN_DECIMALS));
if (amount <= 0n) throw new Error('give an amount, e.g. pnpm pool:fund 500');
if (!env.GHOSTWRITER_POOL_ID) throw new Error('GHOSTWRITER_POOL_ID is empty: run pnpm pool:create first');
if (!env.GUSD_FAUCET_ID) throw new Error('GUSD_FAUCET_ID is empty (see backend/move/DEPLOYMENTS.md)');

const gusdPackage = env.COIN_TYPE.split('::')[0];
const tx = new Transaction();
const coins = [];
for (let left = amount; left > 0n; left -= MAX_PER_MINT) {
  const part = left > MAX_PER_MINT ? MAX_PER_MINT : left;
  coins.push(tx.moveCall({ target: `${gusdPackage}::gusd::mint`, arguments: [tx.object(env.GUSD_FAUCET_ID), tx.pure.u64(part)] }));
}
const [first, ...rest] = coins;
if (rest.length) tx.mergeCoins(first, rest);
tx.moveCall({
  target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::deposit`,
  typeArguments: [env.COIN_TYPE],
  arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), first],
});
const r = await execServer(tx, 'deposit');
const pool = await readPool();
console.log('funded', amount.toString(), 'digest', r.digest);
console.log('pool vault', pool.vault.toString(), 'locked', pool.locked.toString(), 'free', pool.free.toString());
