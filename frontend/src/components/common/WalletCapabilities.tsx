'use client';
// Shows what the connected wallet account actually advertises.
//
// Onboarding signs two Sui MAINNET transactions. dApp Kit asks the account for the
// `sui:signAndExecuteTransaction` feature scoped to `sui:mainnet`; if the account does not offer it,
// dApp Kit silently falls back to the deprecated `signAndExecuteTransactionBlock`, which some
// wallets (Slush's Google/zkLogin accounts among them) reject with an empty error. That failure is
// impossible to read from the UI, so this panel states the capability outright.
import { useCurrentAccount } from '@mysten/dapp-kit-react';

const MODERN = 'sui:signAndExecuteTransaction';
const LEGACY = 'sui:signAndExecuteTransactionBlock';
const MAINNET = 'sui:mainnet';

export function WalletCapabilities() {
  const account = useCurrentAccount();
  if (!account) return null;

  const chains = [...account.chains];
  const features = [...account.features];
  const hasMainnet = chains.includes(MAINNET);
  const hasModern = features.includes(MODERN);
  const canSign = hasMainnet && hasModern;

  return (
    <div className={`note ${canSign ? '' : 'note--warn'}`} style={{ display: 'block' }}>
      <strong>{canSign ? 'This wallet can sign on Mainnet.' : 'This wallet may not be able to sign on Mainnet.'}</strong>
      <dl className="small" style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
        <dt>Mainnet chain</dt>
        <dd style={{ margin: 0 }}>{hasMainnet ? 'yes' : 'no — switch Slush to Mainnet, then reconnect'}</dd>
        <dt>Signing method</dt>
        <dd style={{ margin: 0 }}>
          {hasModern ? 'modern' : features.includes(LEGACY) ? 'deprecated only — this is what fails' : 'none offered'}
        </dd>
        <dt>Chains</dt>
        <dd style={{ margin: 0 }}>{chains.join(', ') || '—'}</dd>
        <dt>Features</dt>
        <dd style={{ margin: 0, wordBreak: 'break-all' }}>{features.join(', ') || '—'}</dd>
      </dl>
      {!canSign && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          Slush&apos;s Google (zkLogin) accounts offer only the deprecated method. A seed-phrase
          account in the same wallet offers the modern one — create one, send it a little Mainnet
          SUI, and onboard with that.
        </p>
      )}
    </div>
  );
}
