'use client';
import Link from 'next/link';
import { Activity, Brain, CircleCheck, Database, KeyRound, ShieldCheck, ShieldPlus, Wallet } from 'lucide-react';
import { BlobLink, ErrorState } from '@/components/common';
import { userMessage } from '@/lib/errors';
import { usd } from '@/lib/format';
import { useBook, useMarket, useProof } from '@/hooks/queries';
import { useBorrower } from '@/hooks/useBorrower';

const STEPS = [
  { Icon: ShieldPlus, title: 'Ask for cover', body: 'Pick a trigger, a payout and a length.' },
  { Icon: Brain, title: 'See why it costs that', body: 'The price shows which past cases, rules and records changed it.' },
  { Icon: Wallet, title: 'Buy in one transaction', body: 'Your wallet pays the premium into the vault on Sui Testnet.' },
  { Icon: CircleCheck, title: 'Get paid without a claim', body: 'A Pyth price check or a Nautilus-verified liquidation triggers the payout.' },
];

export default function HomePage() {
  const proof = useProof();
  const book = useBook();
  const market = useMarket();
  const { status } = useBorrower();
  const sui = market.data?.assets.find((a) => a.asset === 'SUI');

  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="stack" style={{ paddingTop: 12 }}>
        <h1 className="page-title" style={{ fontSize: 'clamp(34px, 5vw, 60px)', maxWidth: 900 }}>
          Liquidation cover priced by an underwriter that <em>remembers.</em>
        </h1>
        <p className="page-sub" style={{ fontSize: 17 }}>
          Ghostwriter pays you automatically if SUI or BTC falls below your trigger, or if your Suilend position is liquidated.
          Its prices learn from every past outcome, stored on Walrus Memory.
        </p>
        <div className="row">
          <Link className="btn" href="/cover"><ShieldPlus size={16} /> Get cover</Link>
          {status === 'registered'
            ? <Link className="btn btn--ghost" href="/memory"><Brain size={16} /> My memory</Link>
            : <Link className="btn btn--ghost" href="/onboard"><KeyRound size={16} /> Set up my memory</Link>}
        </div>
      </section>

      {!(proof.isError && book.isError && market.isError) && <section className="card grid-3">
        {!proof.isError && (
          <Link href="/proof" className="figure" aria-label="Memories on Walrus Mainnet, see proof">
            <span className="big">{proof.data ? proof.data.mainnetMemories.toLocaleString('en-US') : '—'}</span>
            <span className="label"><Database size={14} /> memories on Walrus Mainnet</span>
          </Link>
        )}
        {!book.isError && (
          <div className="figure">
            <span className="big">{book.data ? book.data.activePolicies : '—'}</span>
            <span className="label"><ShieldCheck size={14} /> active policies</span>
          </div>
        )}
        {!market.isError && (
          <div className="figure">
            <span className="big">{sui ? usd(sui.spotUsd, 3) : '—'}</span>
            <span className="label"><Activity size={14} /> SUI price from Pyth</span>
          </div>
        )}
      </section>}
      {/* One message per distinct error (when the backend is down all three fail the same way). */}
      {[...new Map(
        [proof, book, market].filter((q) => q.isError).map((q) => [userMessage(q.error), q] as const),
      )].map(([msg]) => (
        <ErrorState key={msg} error={new Error(msg)} onRetry={() => { proof.refetch(); book.refetch(); market.refetch(); }} />
      ))}

      <section className="card">
        <h2>How it works</h2>
        <ol className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {STEPS.map(({ Icon, title, body }, i) => (
            <li key={title} className="stack-sm">
              <span className="row strong"><Icon size={18} /> {i + 1}. {title}</span>
              <span className="small muted">{body}</span>
            </li>
          ))}
        </ol>
      </section>

      {proof.data && proof.data.lastBlobIds.length > 0 && (
        <section className="row small">
          <span className="muted">Latest memory:</span>
          {proof.data.lastBlobIds.slice(0, 3).map((b) => <BlobLink key={b} blobId={b} />)}
        </section>
      )}
    </div>
  );
}
