'use client';
// The landing. Rendered full-bleed — AppShell leaves '/' outside the sidebar chrome.
//
// This replaces the scraped template's hero, which advertised a different product
// ("We're just sending forms / and that's all"). The dot-grid treatment and the cream/royal
// palette are kept; the words are ours.
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { ArrowRight, Brain, CircleCheck, Database, ShieldPlus } from 'lucide-react';
import { DotPattern } from '@/components/ui/dot-pattern';
import { useAddress, useMarket, useProof } from '@/hooks/queries';
import { usd } from '@/lib/format';
import Logo from '@/components/icons/logo';

const POINTS = [
  { Icon: Brain, title: 'It remembers', body: 'Every quote cites the past cases on Walrus Memory that moved its price.' },
  { Icon: CircleCheck, title: 'No claim to file', body: 'A Pyth price check or a TEE-verified liquidation pays you automatically.' },
  { Icon: Database, title: 'The memory is yours', body: 'Your record lives in your own Walrus account. Revoke us any time.' },
];

export default function LandingPage() {
  const address = useAddress();
  const router = useRouter();
  const market = useMarket();
  const proof = useProof();
  const sui = market.data?.assets.find((a) => a.asset === 'SUI');

  // Connecting from the landing moves you into the app. Every page stays reachable by URL, so a
  // wallet that misbehaves never leaves you with nothing to show.
  useEffect(() => { if (address) router.push('/home'); }, [address, router]);

  return (
    <main className="gw-landing">
      <DotPattern width={32} height={32} cr={1.4} className="gw-landing__dots" />

      <header className="gw-landing__bar">
        <Link href="/" className="gw-brand" aria-label="Ghostwriter"><Logo /></Link>
        <nav className="gw-landing__nav">
          <Link href="/underwriter">Underwriter</Link>
          <Link href="/proof">Proof</Link>
          <ConnectButton />
        </nav>
      </header>

      <section className="gw-landing__hero">
        <h1 className="gw-landing__title">
          Liquidation cover priced by an underwriter that <em>remembers.</em>
        </h1>
        <p className="gw-landing__sub">
          Ghostwriter pays you automatically if SUI falls below your trigger, or if your Suilend
          position is liquidated. Its prices learn from every past outcome, stored on Walrus Memory.
        </p>

        <div className="gw-landing__cta">
          <Link className="gw-btn gw-btn--primary" href="/cover">
            <ShieldPlus size={18} /> Get cover
          </Link>
          <Link className="gw-btn" href="/home">
            See it live <ArrowRight size={16} />
          </Link>
        </div>

        {/* Live figures, so the first thing a visitor sees is real rather than claimed. */}
        <dl className="gw-landing__stats">
          <div><dt>SUI now</dt><dd>{sui ? usd(sui.spotUsd) : '—'}</dd></div>
          <div><dt>Memories on Mainnet</dt><dd>{proof.data?.mainnetMemories ?? '—'}</dd></div>
          <div><dt>Policies settle on</dt><dd>Sui Testnet</dd></div>
        </dl>
      </section>

      <section className="gw-landing__points">
        {POINTS.map(({ Icon, title, body }) => (
          <article key={title}>
            <Icon size={20} />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
