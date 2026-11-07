// Generates the backend's own keys and writes them straight into backend/.env.
// Secrets are never printed; only public keys are. Keys already present in .env are left untouched,
// so re-running is safe (it never rotates a key the pool or borrowers already depend on).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { generateDelegateKey } from '@mysten-incubation/memwal/account';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const has = (name: string) => new RegExp(`^${name}\\s*=\\s*\\S`, 'm').test(text);
const get = (name: string) => new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm').exec(text)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';

const added: string[] = [];
function put(name: string, value: string) {
  if (has(name)) return;
  text += `${text.endsWith('\n') || text === '' ? '' : '\n'}${name}=${value}\n`;
  added.push(name);
}

put('ADMIN_TOKEN', randomBytes(24).toString('hex'));
put('QUOTE_SIGNING_KEY_HEX', randomBytes(32).toString('hex'));
put('RECORD_SIGNING_KEY_HEX', randomBytes(32).toString('hex'));
if (!has('MEMWAL_BORROWER_DELEGATE_KEY')) {
  const delegate = await generateDelegateKey();
  put('MEMWAL_BORROWER_DELEGATE_KEY', delegate.privateKey);
}
fs.writeFileSync(envPath, text);

const pub = (hex: string) => bytesToHex(ed25519.getPublicKey(hexToBytes(hex)));
console.log(added.length ? `Added to .env: ${added.join(', ')}` : 'All keys already present in .env; nothing changed.');
console.log('Public values (safe to share):');
console.log(`  quote pubkey hex:  ${pub(get('QUOTE_SIGNING_KEY_HEX'))}`);
console.log(`  record pubkey hex: ${pub(get('RECORD_SIGNING_KEY_HEX'))}`);
console.log(`  borrower delegate pubkey hex: ${pub(get('MEMWAL_BORROWER_DELEGATE_KEY').replace(/^0x/, ''))}`);
