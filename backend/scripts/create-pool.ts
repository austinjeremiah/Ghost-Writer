// Usage: pnpm pool:create [confirmDelayMs=120000]
// Creates the shared Pool<COIN_TYPE> and records GHOSTWRITER_POOL_ID in .env.
import { Transaction } from '@mysten/sui/transactions';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../src/config.js';
import { execServer, idsOfType } from '../src/chain/clients.js';
import { setEnvVar } from './env-file.js';

if (env.GHOSTWRITER_POOL_ID && !process.argv.includes('--force')) {
  console.log(`A pool is already set: GHOSTWRITER_POOL_ID=${env.GHOSTWRITER_POOL_ID}. Pass --force to create another.`);
  process.exit(0);
}

const confirmDelayMs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 120000);
const quotePub = ed25519.getPublicKey(hexToBytes(env.QUOTE_SIGNING_KEY_HEX));
const tx = new Transaction();
tx.moveCall({
  target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::create_pool`,
  typeArguments: [env.COIN_TYPE],
  arguments: [
    tx.object(env.GHOSTWRITER_ADMIN_CAP_ID),
    tx.pure.vector('u8', Array.from(quotePub)),
    tx.pure.u64(confirmDelayMs),
    tx.pure.u64(200),                 // max_conf_bps = 2%
    tx.pure.u64(env.MAX_PRICE_AGE_S), // must exceed the on-chain Pyth push gap (~126 s on Testnet)
  ],
});
const r = await execServer(tx, 'create_pool');
const poolId = idsOfType(r.objectTypes, '::ghostwriter::Pool<')[0];
if (!poolId) throw new Error(`create_pool: no Pool in effects (digest ${r.digest})`);
setEnvVar('GHOSTWRITER_POOL_ID', poolId);
console.log('digest', r.digest);
console.log(`GHOSTWRITER_POOL_ID=${poolId} (written to .env)`);
console.log(`confirm delay ${confirmDelayMs} ms, max price age ${env.MAX_PRICE_AGE_S} s`);
