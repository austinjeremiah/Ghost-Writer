'use client';
import { Activity, Coins, Network } from 'lucide-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useAddress, useConfig, useMarket } from '@/hooks/queries';
import { useDusdc } from '@/hooks/useDusdc';
import { fromBase, usd } from '@/lib/format';
import { LiveDot } from './LiveDot';

export function TopBar() {
  const { data: cfg } = useConfig();
  const { data: market } = useMarket();
  const address = useAddress();
  const { data: balance } = useDusdc();
  const sui = market?.assets.find((a) => a.asset === 'SUI');

  return (
    <header className="gw-topbar">
      <span className="pill" title="Policies and money live on Sui Testnet">
        <Network size={14} /> Policies: {cfg ? cap(cfg.network.policies) : 'Testnet'}
      </span>
      <span className="pill" title="Walrus Memory lives on Sui Mainnet">
        <Network size={14} /> Memory: {cfg ? cap(cfg.network.memory) : 'Mainnet'}
      </span>
      <LiveDot />
      <span className="spacer" />
      <span className="pill" title="SUI price from Pyth">
        <Activity size={14} /> SUI {sui ? usd(sui.spotUsd, 3) : '—'}
      </span>
      {address && (
        <span className="pill" title="Your gUSD on Sui Testnet">
          <Coins size={14} /> {balance !== undefined ? fromBase(balance) : '—'} gUSD
        </span>
      )}
      <ConnectButton />
    </header>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
