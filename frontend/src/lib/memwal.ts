// lib/memwal.ts
'use client';
import { createAccount, addDelegateKey, removeDelegateKey, type CreateAccountOpts } from '@mysten-incubation/memwal/account';
import { dAppKit } from './dapp-kit';
import type { Config } from './types';

type WalletSigner = NonNullable<CreateAccountOpts['walletSigner']>;

/** A memwal WalletSigner that always signs on Sui MAINNET with the connected wallet. */
function mainnetSigner(address: string): WalletSigner {
  return {
    address,
    signAndExecuteTransaction: async ({ transaction }) => {
      const r = await dAppKit.signAndExecuteTransaction({ transaction, network: 'mainnet' });
      return r.$kind === 'Transaction'
        ? { $kind: 'Transaction' as const, Transaction: { digest: r.Transaction.digest } }
        : { $kind: 'FailedTransaction' as const, FailedTransaction: { digest: r.FailedTransaction.digest } };
    },
    signPersonalMessage: async ({ message }) => ({ signature: (await dAppKit.signPersonalMessage({ message })).signature }),
  };
}

const base = (cfg: Config, address: string) => ({
  packageId: cfg.memwal.packageId,
  registryId: cfg.memwal.registryId,
  walletSigner: mainnetSigner(address),
  suiClient: dAppKit.getClient('mainnet'),
  suiNetwork: 'mainnet' as const,
});

export async function createMemoryAccount(cfg: Config, address: string) {
  const r = await createAccount(base(cfg, address));
  return r; // r.accountId may be '' if the SDK could not read it from effects → UI asks the user to paste it (see 6.2)
}

export async function addGhostwriterKey(cfg: Config, address: string, accountId: string) {
  return addDelegateKey({
    ...base(cfg, address), accountId,
    publicKey: cfg.memwal.borrowerDelegatePublicKeyHex,
    label: cfg.memwal.borrowerDelegateLabel,
  });
}

export async function revokeGhostwriterKey(cfg: Config, address: string, accountId: string) {
  return removeDelegateKey({ ...base(cfg, address), accountId, publicKey: cfg.memwal.borrowerDelegatePublicKeyHex });
}

/** Remember the account id per wallet so a reload mid-onboarding does not lose it. Browser-only convenience. */
const KEY = (a: string) => `ghostwriter:memwalAccount:${a}`;
export const savedAccountId = {
  get: (a: string) => { try { return localStorage.getItem(KEY(a)); } catch { return null; } },
  set: (a: string, id: string) => { try { localStorage.setItem(KEY(a), id); } catch { /* private mode */ } },
};
