// Registers a LOCALLY RUNNING enclave app's signing key on Testnet, without a Nitro attestation.
//
// ⚠️  This is the weaker of the two registration paths, and it exists only because Nitro Enclaves
// need an instance type an AWS Free Plan account cannot launch. It proves the Cap holder vouches for
// the key; it does NOT prove the key lives in a TEE. The real path is `pnpm enclave:register`, which
// accepts a key only when AWS's attestation document says it came from an enclave whose measurements
// match the registered PCRs.
//
// If you demo with this, say so out loud. Everything downstream is genuine — the enclave really
// reads Mainnet, really refuses false claims, and the contract really verifies the signature — but
// the hardware link is missing and claiming otherwise would be the one dishonest part.
//
// Requires the `enclave` package to have been upgraded to add `register_enclave_by_cap`:
//     cd backend/move/enclave && sui move build --dump-bytecode-as-base64 | tail -1 > /tmp/eb.json
//     pnpm enclave:upgrade /tmp/eb.json
//
// Then, with the app running (PORT=3010 API_KEY=unused cargo run …):
//     pnpm enclave:register-local --url http://localhost:3010
import { Transaction } from '@mysten/sui/transactions';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../src/config.js';
import { execServer, idsOfType, serverAddress } from '../src/chain/clients.js';

const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const url = (arg('url') ?? env.ENCLAVE_URL ?? '').replace(/\/$/, '');
if (!url) throw new Error('pass --url http://localhost:3010 (or set ENCLAVE_URL)');

const ENCLAVE_PACKAGE_ID = process.env.ENCLAVE_PACKAGE_ID;
const CAP_ID = process.env.ENCLAVE_CAP_ID;
const CONFIG_ID = env.ENCLAVE_CONFIG_OBJECT_ID;
if (!ENCLAVE_PACKAGE_ID || !CAP_ID || !CONFIG_ID) {
  throw new Error('need ENCLAVE_PACKAGE_ID, ENCLAVE_CAP_ID and ENCLAVE_CONFIG_OBJECT_ID in .env');
}
const OTW = `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::GHOSTWRITER`;

console.warn('\n⚠️  Registering an UNATTESTED key. This is the local demo path, not the TEE path.\n');

// `health_check` also returns `pk`; `/public_key` is the explicit endpoint for this.
const res = await fetch(`${url}/public_key`);
if (!res.ok) throw new Error(`${url}/public_key returned ${res.status}; is the enclave app running?`);
const pkHex = ((await res.json()) as { publicKey: string }).publicKey?.replace(/^0x/, '');
if (!pkHex || !/^[0-9a-f]{64}$/.test(pkHex)) throw new Error(`bad public key: ${pkHex}`);

console.log(`enclave url  ${url}`);
console.log(`public key   ${pkHex}`);
console.log(`signing as   ${serverAddress}  (must own the Cap)`);

const tx = new Transaction();
tx.moveCall({
  target: `${ENCLAVE_PACKAGE_ID}::enclave::register_enclave_by_cap`,
  typeArguments: [OTW],
  arguments: [tx.object(CONFIG_ID), tx.object(CAP_ID), tx.pure.vector('u8', Array.from(hexToBytes(pkHex)))],
});
const { digest, objectTypes } = await execServer(tx, 'register_enclave_by_cap');
const [enclaveId] = idsOfType(objectTypes, '::enclave::Enclave<');
if (!enclaveId) throw new Error(`registered (tx ${digest}) but no Enclave object in effects`);

console.log(`\n✔ registered  (tx ${digest})`);
console.log(`\nPut these in backend/.env, then restart the backend:\n`);
console.log(`ENCLAVE_OBJECT_ID=${enclaveId}`);
console.log(`ENCLAVE_URL=${url}`);
console.log(`
The app regenerates its key on every start, so re-run this after restarting it.
Note the enclave only attests liquidations whose on-chain timestamp falls inside the policy window,
so a policy bought now cannot settle a liquidation that already happened.`);
