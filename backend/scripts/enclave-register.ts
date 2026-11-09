// Stage G of docs/P7_ENCLAVE_RUNBOOK.md, in one command.
//
// Why this exists instead of nautilus/register_enclave.sh: `update_pcrs` requires the
// `Cap<GHOSTWRITER>`, which is owned by the backend's server address
// (0xdd6389cc38a64526d84e6189ef8904cf8e83f4721b08f65fe96b8579b46e6f2b) — not by either address in
// the local Sui CLI keystore. Rather than import a production key into the CLI, we sign with the
// key the backend already holds.
//
// Order matters: update_pcrs bumps config.version, and the contract rejects any Enclave whose
// config_version is behind (abort 18, EStaleEnclave). So PCRs first, registration second — this
// script enforces that by doing both.
//
// Usage, from the EC2 instance:
//     nitro-cli describe-eif --eif-path out/nitro.eif > eif.json
// then on your laptop:
//     pnpm enclave:register --url http://<ip>:3000 --eif eif.json
// or with PCRs pasted directly:
//     pnpm enclave:register --url http://<ip>:3000 --pcr0 <hex> --pcr1 <hex> --pcr2 <hex>
import { readFileSync } from 'node:fs';
import { Transaction } from '@mysten/sui/transactions';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../src/config.js';
import { execServer, idsOfType, serverAddress } from '../src/chain/clients.js';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const url = (arg('url') ?? env.ENCLAVE_URL).replace(/\/$/, '');
if (!url) throw new Error('pass --url http://<ec2-ip>:3000 (or set ENCLAVE_URL)');

const ENCLAVE_PACKAGE_ID = process.env.ENCLAVE_PACKAGE_ID;
const CAP_ID = process.env.ENCLAVE_CAP_ID;
const CONFIG_ID = env.ENCLAVE_CONFIG_OBJECT_ID;
if (!ENCLAVE_PACKAGE_ID || !CAP_ID || !CONFIG_ID) {
  throw new Error('need ENCLAVE_PACKAGE_ID, ENCLAVE_CAP_ID and ENCLAVE_CONFIG_OBJECT_ID in .env');
}
const OTW = `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::GHOSTWRITER`;

// PCRs are 48-byte SHA-384 measurements; nitro-cli prints them as hex, sometimes 0x-prefixed.
const clean = (s: string, label: string) => {
  const h = s.trim().replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{96}$/.test(h)) throw new Error(`${label} must be 48 bytes of hex (96 chars), got ${h.length}`);
  return h;
};

let pcrs: [string, string, string];
const eifPath = arg('eif');
if (eifPath) {
  // `nitro-cli describe-eif` output: { "Measurements": { "PCR0": "...", "PCR1": "...", ... } }
  const m = JSON.parse(readFileSync(eifPath, 'utf8')).Measurements ?? {};
  pcrs = [clean(m.PCR0 ?? '', 'PCR0'), clean(m.PCR1 ?? '', 'PCR1'), clean(m.PCR2 ?? '', 'PCR2')];
} else {
  const [p0, p1, p2] = [arg('pcr0'), arg('pcr1'), arg('pcr2')];
  if (!p0 || !p1 || !p2) throw new Error('pass --eif <describe-eif.json> or all three of --pcr0 --pcr1 --pcr2');
  pcrs = [clean(p0, 'PCR0'), clean(p1, 'PCR1'), clean(p2, 'PCR2')];
}

const bytes = (hex: string) => Array.from(hexToBytes(hex));
const step = (s: string) => console.log(`\n▶ ${s}`);

console.log(`enclave url   ${url}`);
console.log(`signing as    ${serverAddress}  (must own the Cap)`);
console.log(`PCR0          ${pcrs[0]}`);
console.log(`PCR1          ${pcrs[1]}`);
console.log(`PCR2          ${pcrs[2]}`);

// 1. Pin the measurements the contract will accept. Must precede registration.
step('update_pcrs');
{
  const tx = new Transaction();
  tx.moveCall({
    target: `${ENCLAVE_PACKAGE_ID}::enclave::update_pcrs`,
    typeArguments: [OTW],
    arguments: [tx.object(CONFIG_ID), tx.object(CAP_ID), tx.pure.vector('u8', bytes(pcrs[0])), tx.pure.vector('u8', bytes(pcrs[1])), tx.pure.vector('u8', bytes(pcrs[2]))],
  });
  const { digest } = await execServer(tx, 'update_pcrs');
  console.log(`✔ PCRs pinned, config.version bumped  (tx ${digest})`);
}

// 2. The enclave's own attestation document. It carries the ephemeral public key the contract will
//    trust, and the PCRs that must match what we just pinned.
step(`GET ${url}/get_attestation`);
const res = await fetch(`${url}/get_attestation`);
if (!res.ok) throw new Error(`get_attestation returned ${res.status}; is expose_enclave.sh running?`);
const attestationHex = ((await res.json()) as { attestation: string }).attestation?.replace(/^0x/, '');
if (!attestationHex) throw new Error('attestation field empty');
console.log(`✔ attestation ${attestationHex.length / 2} bytes`);

// 3. Verify the document on-chain and create the shared Enclave object the contract trusts.
step('register_enclave');
{
  const tx = new Transaction();
  const [doc] = tx.moveCall({
    target: '0x2::nitro_attestation::load_nitro_attestation',
    arguments: [tx.pure.vector('u8', bytes(attestationHex)), tx.object.clock()],
  });
  tx.moveCall({
    target: `${ENCLAVE_PACKAGE_ID}::enclave::register_enclave`,
    typeArguments: [OTW],
    arguments: [tx.object(CONFIG_ID), doc],
  });
  const { digest, objectTypes } = await execServer(tx, 'register_enclave');
  const [enclaveId] = idsOfType(objectTypes, '::enclave::Enclave<');
  if (!enclaveId) throw new Error(`registered (tx ${digest}) but no Enclave object found in effects`);
  console.log(`✔ registered  (tx ${digest})`);
  console.log(`\nPut these two lines in backend/.env, then restart the backend:\n`);
  console.log(`ENCLAVE_OBJECT_ID=${enclaveId}`);
  console.log(`ENCLAVE_URL=${url}`);
  console.log(`\nThen: curl -s localhost:8787/v1/enclave/health`);
  console.log('Remember: the enclave key is regenerated on every start, so re-run this after any');
  console.log('restart or reboot of the instance.');
}
