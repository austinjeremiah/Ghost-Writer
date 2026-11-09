// Upgrades the vendored `enclave` package on Testnet, in place.
//
// Why a script rather than `sui client upgrade`: the UpgradeCap is owned by the backend's server
// address (0xdd6389cc…), which is not in the local Sui CLI keystore, and importing a production key
// into the CLI leaves it on disk. This signs with the key the backend already holds in memory.
//
// Because the package keeps its original id, `Enclave<GHOSTWRITER>` keeps its type identity — the
// ghostwriter package, the Pool and every existing policy are untouched by this.
//
// Prepare the bytecode first, from backend/move/enclave:
//     sui move build --dump-bytecode-as-base64 | tail -1 > /tmp/enclave-build.json
// Then:
//     pnpm enclave:upgrade /tmp/enclave-build.json
import { readFileSync } from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { execServer, serverAddress } from '../src/chain/clients.js';

const buildPath = process.argv[2];
if (!buildPath) throw new Error('usage: pnpm enclave:upgrade <dump-bytecode-as-base64 json>');

const PACKAGE_ID = process.env.ENCLAVE_PACKAGE_ID;
const UPGRADE_CAP = process.env.ENCLAVE_UPGRADE_CAP_ID ?? '0x140e5822134873eb8041c8ebb893e1a19c3309185c4175ae4645351b98516073';
if (!PACKAGE_ID) throw new Error('ENCLAVE_PACKAGE_ID missing from .env');

const { modules, dependencies, digest } = JSON.parse(readFileSync(buildPath, 'utf8')) as {
  modules: string[];
  dependencies: string[];
  digest: number[];
};

console.log(`package      ${PACKAGE_ID}`);
console.log(`upgrade cap  ${UPGRADE_CAP}`);
console.log(`signing as   ${serverAddress}  (must own the cap)`);
console.log(`modules      ${modules.length}, dependencies ${dependencies.length}`);

const COMPATIBLE = 0; // 0x2::package::COMPATIBLE_POLICY — additive changes only.

const tx = new Transaction();
// authorize → upgrade → commit must happen in one transaction; the ticket is not storable.
const ticket = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [
    tx.object(UPGRADE_CAP),
    tx.pure.u8(COMPATIBLE),
    tx.pure(bcs.vector(bcs.u8()).serialize(digest)),
  ],
});
const receipt = tx.upgrade({ modules, dependencies, package: PACKAGE_ID, ticket });
tx.moveCall({ target: '0x2::package::commit_upgrade', arguments: [tx.object(UPGRADE_CAP), receipt] });

const { digest: txDigest, objectTypes } = await execServer(tx, 'upgrade_enclave');
console.log(`\n✔ upgraded  (tx ${txDigest})`);
console.log(JSON.stringify(objectTypes, null, 1));
console.log(`
The original package id is unchanged, so nothing else needs republishing. Record the new version in
backend/move/enclave/Published.toml if you keep that in sync.`);
