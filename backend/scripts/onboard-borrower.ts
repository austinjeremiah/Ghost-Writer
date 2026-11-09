// Onboards a borrower end to end, headlessly, on Sui MAINNET — the same two on-chain calls the
// frontend's onboarding page makes with a browser wallet:
//
//   1. account::create_account      — the borrower's own MemWalAccount
//   2. account::add_delegate_key    — authorising OUR delegate public key to write to it
//   3. PUT /v1/borrowers/:address   — the backend verifies both against the chain, then anchors
//
// The borrower owns the account; we only ever hold a delegate key they can revoke.
//
// Usage: BORROWER_SUI_PRIVATE_KEY=suiprivkey1… pnpm onboard:borrower
//
// That key is a MAINNET key and signs real transactions, so use a throwaway wallet funded with a
// little SUI (~0.3), not a wallet holding anything you care about.
import { createAccount, addDelegateKey } from '@mysten-incubation/memwal/account';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env } from '../src/config.js';
import { borrowerDelegatePubHex } from '../src/memory/client.js';
import { readMemWalAccount } from '../src/chain/memwalAccount.js';

const key = process.env.BORROWER_SUI_PRIVATE_KEY;
if (!key) throw new Error('set BORROWER_SUI_PRIVATE_KEY (a Mainnet suiprivkey1… with ~0.3 SUI)');

const address = Ed25519Keypair.fromSecretKey(key).toSuiAddress();
const common = {
  packageId: env.MEMWAL_PACKAGE_ID,
  registryId: env.MEMWAL_REGISTRY_ID,
  suiPrivateKey: key,
  suiNetwork: 'mainnet' as const,
};
const step = (s: string) => console.log(`\n▶ ${s}`);

step(`borrower wallet ${address}`);
console.log(`delegate key to authorise: ${borrowerDelegatePubHex}`);

// 1. The borrower's own account. One per address, enforced by the contract.
step('create_account on Mainnet');
let accountId: string;
try {
  const created = await createAccount(common);
  accountId = created.accountId;
  console.log(`✔ account ${accountId}  (tx ${created.digest})`);
} catch (e) {
  const message = (e as Error).message;
  if (!/already|exists|one account/i.test(message)) throw e;
  console.log('… this wallet already has an account; continuing with it');
  accountId = process.env.BORROWER_ACCOUNT_ID
    ?? (() => { throw new Error('account exists but is unknown here: pass BORROWER_ACCOUNT_ID=0x…'); })();
}

// 2. Authorise our delegate key to write to it.
step('add_delegate_key (Ghostwriter underwriter)');
const existing = await readMemWalAccount(accountId);
if (existing.delegatePubHexes.includes(borrowerDelegatePubHex)) {
  console.log('✔ already authorised; nothing to do');
} else {
  const added = await addDelegateKey({ ...common, accountId, publicKey: borrowerDelegatePubHex, label: 'Ghostwriter underwriter' });
  console.log(`✔ authorised  (tx ${added.digest}, delegate address ${added.suiAddress})`);
}

// 3. Register with the backend, which re-checks owner and delegate against Mainnet itself.
step(`PUT ${env.PUBLIC_BASE_URL}/v1/borrowers/${address}`);
// The relayer caches delegate lookups for ~30 s, so a fresh key can need one retry.
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(`${env.PUBLIC_BASE_URL}/v1/borrowers/${address}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memwalAccountId: accountId }),
  });
  const body = await res.json();
  if (res.ok) {
    console.log('✔ registered:', JSON.stringify(body, null, 1));
    console.log(`\nNext: watch the write land, then read the history back.
  curl -sN ${env.PUBLIC_BASE_URL}/v1/events | grep -E 'memory|ledger'
  curl -s ${env.PUBLIC_BASE_URL}/v1/borrowers/${address}/history | python3 -m json.tool`);
    break;
  }
  const reason = (body as { error?: { details?: { reason?: string }; message?: string } }).error;
  console.log(`attempt ${attempt}: ${res.status} ${reason?.message ?? ''} ${reason?.details?.reason ?? ''}`);
  if (attempt === 3 || reason?.details?.reason !== 'DELEGATE_NOT_REGISTERED') break;
  await new Promise((r) => setTimeout(r, 15_000));
}
