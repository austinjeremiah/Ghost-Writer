'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Radio, ShieldPlus, Wallet } from 'lucide-react';
import { Amount, Countdown, EmptyState, ErrorState, StatusBadge } from '@/components/common';
import { CoverTitle } from '@/components/policy/CoverTitle';
import { date, distanceToTrigger, e8ToUsd, pct, timeLeft, usd } from '@/lib/format';
import type { PolicyDTO } from '@/lib/types';
import { useAddress, useConfig, useMarket, usePolicies } from '@/hooks/queries';

type Tab = 'active' | 'paid' | 'expired' | 'all';
const TABS: Array<{ id: Tab; label: string; match: (p: PolicyDTO) => boolean }> = [
  { id: 'active', label: 'Active', match: (p) => p.status === 'active' || p.status === 'breach' },
  { id: 'paid', label: 'Paid', match: (p) => p.status === 'paid' },
  { id: 'expired', label: 'Expired', match: (p) => p.status === 'expired' },
  { id: 'all', label: 'All', match: () => true },
];

export default function PoliciesPage() {
  const address = useAddress();
  const policies = usePolicies(address);
  const [tab, setTab] = useState<Tab>('active');

  const header = (
    <div className="page-head">
      <div>
        <h1 className="page-title">My <em>policies</em></h1>
        <p className="page-sub">Every policy your wallet holds, with live distance to the trigger.</p>
      </div>
      <Link className="btn" href="/cover"><ShieldPlus size={16} /> Get cover</Link>
    </div>
  );

  if (!address) {
    return <>{header}<section className="card"><EmptyState icon={Wallet} title="Connect your wallet to see your policies." action={<ConnectButton />} /></section></>;
  }
  if (policies.isError) return <>{header}<ErrorState error={policies.error} onRetry={() => policies.refetch()} /></>;

  const list = policies.data?.policies ?? [];
  return (
    <>
      {header}
      <section className="card">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}<span className="count">{policies.data ? list.filter(t.match).length : '—'}</span>
            </button>
          ))}
        </div>
        {policies.isPending ? (
          <div className="stack-sm">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>
        ) : list.length === 0 ? (
          <EmptyState icon={ShieldPlus} title="No cover yet." action={<Link className="btn" href="/cover">Get cover</Link>} />
        ) : (
          <PolicyTable policies={list.filter(TABS.find((t) => t.id === tab)!.match)} />
        )}
      </section>
    </>
  );
}

function PolicyTable({ policies }: { policies: PolicyDTO[] }) {
  const router = useRouter();
  const { data: market } = useMarket();
  const { data: cfg } = useConfig();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // Breach rows first; otherwise keep the backend's newest-first order.
  const rows = useMemo(() => [...policies].sort((a, b) => Number(b.status === 'breach') - Number(a.status === 'breach')), [policies]);

  if (!rows.length) return <p className="muted" style={{ padding: '16px 0' }}>Nothing here.</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Cover</th><th>Payout</th><th>Now</th><th>Ends</th><th>Status</th><th>Hedge</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const spot = market?.assets.find((a) => a.asset === p.asset)?.spotUsd;
            const open = p.status === 'active' || p.status === 'breach';
            const go = () => router.push(`/policies/${p.policyId}`);
            return (
              <tr key={p.policyId} className="clickable" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
                <td><Link href={`/policies/${p.policyId}`} onClick={(e) => e.stopPropagation()}><CoverTitle policy={p} /></Link></td>
                <td className="nowrap"><Amount units={p.payout} /></td>
                <td>
                  {p.kind === 'liquidation'
                    ? <span className="row small"><Radio size={14} /> Watching on Mainnet</span>
                    : spot !== undefined
                      ? <span className="stack-sm" style={{ gap: 0 }}>
                          <span>{usd(spot)}</span>
                          <span className="small muted">{pct(distanceToTrigger(spot, e8ToUsd(p.strikeE8)))} above trigger</span>
                        </span>
                      : <span className="muted">—</span>}
                </td>
                <td className="nowrap">{open ? timeLeft(p.endMs - now) : date(p.endMs)}</td>
                <td>
                  <div className="stack-sm" style={{ gap: 4 }}>
                    <StatusBadge status={p.status} />
                    {p.status === 'breach' && cfg?.pool && (
                      <span className="small warn">Payout in <Countdown to={p.breachStartedMs + cfg.pool.confirmDelayMs} /> if it stays below</span>
                    )}
                  </div>
                </td>
                <td>{p.asset === 'BTC' && p.hedge.status !== 'none' ? <span className="badge badge--muted">{p.hedge.status}</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
