'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Bot, CircleX, Coins, Database, ScrollText, Zap } from 'lucide-react';
import { AskUnderwriter, Amount, BlobLink, ErrorState, TxLink } from '@/components/common';
import { useEvents, useOnEvent, type AnyEvent } from '@/lib/events';
import { date, fromBase, pct, shortId } from '@/lib/format';
import type { Book, MemoryWriteStatus, UnderwriterNamespace } from '@/lib/types';
import { useBook, useMemoryWrites, useUnderwriterMemory } from '@/hooks/queries';

export default function UnderwriterPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">The <em>underwriter</em></h1>
          <p className="page-sub">The AI underwriter&apos;s book and its memory: money in the vault, rules it has learned, how its prices moved, and every memory it wrote to Walrus Mainnet.</p>
        </div>
      </div>
      <div className="stack">
        <Vault />
        {/* Talk to the agent. Every answer is grounded in the memories listed under it. */}
        <AskUnderwriter />
        <div className="grid-main-side">
          <div className="stack">
            <Rules />
            <MultiplierChart />
            <MemoryTabs />
          </div>
          <Activity />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Vault() {
  const book = useBook();
  if (book.isError) return <ErrorState error={book.error} onRetry={() => book.refetch()} />;
  const b = book.data;
  const locked = b ? BigInt(b.locked) : 0n;
  const free = b ? BigInt(b.free) : 0n;
  const total = locked + free;
  const lockedPct = total > 0n ? Number((locked * 10000n) / total) / 100 : 0;

  return (
    <section className="card stack">
      <div className="figure">
        <span className="big">{b ? fromBase(b.vault) : '—'}</span>
        <span className="label">gUSD in the vault (Testnet)</span>
      </div>
      <div className="stack-sm">
        <div className="bar" role="img" aria-label={b ? `${lockedPct}% locked for active policies` : 'Loading'}>
          <span style={{ width: `${total > 0n ? lockedPct : 0}%` }} />
          <span style={{ width: `${total > 0n ? 100 - lockedPct : 0}%` }} />
        </div>
        <div className="row small">
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--cl-ink)' }} /> Locked for active policies {b ? <Amount units={b.locked} /> : '—'}</span>
          <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--cl-accent)', opacity: 0.45 }} /> Free {b ? <Amount units={b.free} /> : '—'}</span>
        </div>
      </div>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="figure"><span className="big-sm">{b ? fromBase(b.premiumsCollected) : '—'}</span><span className="label">Premiums collected</span></div>
        <div className="figure"><span className="big-sm">{b ? fromBase(b.payoutsMade) : '—'}</span><span className="label">Payouts made</span></div>
        <div className="figure"><span className="big-sm">{b ? pct(b.lossRatio) : '—'}</span><span className="label">Loss ratio (payouts ÷ premiums)</span></div>
        <div className="figure"><span className="big-sm">{b ? b.activePolicies : '—'}</span><span className="label">Active policies</span></div>
      </div>
    </section>
  );
}

function Rules() {
  const book = useBook();
  const [flash, setFlash] = useState<Record<string, number>>({});
  useOnEvent(['rule.updated'], (e) => setFlash((f) => ({ ...f, [e.data.ruleId]: Date.now() })));

  const rules = book.data?.rules ?? [];
  return (
    <section className="card">
      <h2>What it has learned</h2>
      {book.isPending ? <div className="skeleton" style={{ height: 80 }} />
        : book.isError ? <ErrorState error={book.error} onRetry={() => book.refetch()} />
        : rules.length === 0 ? <p className="muted">No rules yet. Rules appear after the first payout or near miss.</p>
        : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Bucket</th><th>Multiplier</th><th>Status</th><th>Evidence</th><th>Lesson</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={`${r.ruleId}:${flash[r.ruleId] ?? 0}`} className={flash[r.ruleId] ? 'flash' : undefined}>
                    <td>{r.asset}, {r.volBucket} volatility, {r.moneyBucket}% below spot</td>
                    <td className="nowrap">×{r.multiplier.toFixed(2)}{r.multiplier > 1 && <ArrowUpRight size={14} className="deny" />}</td>
                    <td><span className={`badge ${r.status === 'active' ? 'badge--pass' : r.status === 'retired' ? 'badge--muted' : 'badge--warn'}`}>{r.status}</span></td>
                    <td className="small">{r.payouts} payouts, {r.quietExpiries} quiet expiries</td>
                    <td className="small">{r.lesson}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function MultiplierChart() {
  const book = useBook();
  const pts = book.data?.multiplierHistory ?? [];
  return (
    <section className="card">
      <h2>How memory moved the price</h2>
      {book.isPending ? <div className="skeleton" style={{ height: 190 }} />
        : book.isError ? null
        : pts.length === 0 ? <p className="muted">No quotes yet.</p>
        : <MultiplierSvg history={pts} />}
      <p className="tiny muted" style={{ marginTop: 8 }}>
        One bar per quote, newest on the right. Above the line memory made the cover dearer than the
        model alone; below it, cheaper.
      </p>
    </section>
  );
}

/**
 * Bars diverging from ×1.00 rather than a line against a time axis.
 *
 * A time axis made this unreadable: quotes arrive in bursts, so hours of inactivity ate most of the
 * width and every interesting point was crushed into the right edge. What matters here is not when
 * a quote happened but whether memory raised or lowered it, so each quote gets equal width and the
 * baseline is ×1.00 — "the model's own price, unchanged".
 */
function MultiplierSvg({ history }: { history: Book['multiplierHistory'] }) {
  const W = 640, H = 190, L = 40, R = 12, T = 14, B = 26;
  const MAX_BARS = 48;
  const pts = [...history].sort((a, b) => a.at - b.at).slice(-MAX_BARS);
  const [hover, setHover] = useState<number | null>(null);

  const hi = Math.max(1.6, ...pts.map((p) => p.multiplier)) * 1.08;
  const lo = Math.min(0.6, ...pts.map((p) => p.multiplier)) * 0.95;
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const band = (W - L - R) / pts.length;
  const barW = Math.max(2, Math.min(14, band * 0.62));
  const cx = (i: number) => L + band * (i + 0.5);

  const ticks = [lo < 0.8 ? 0.6 : undefined, 1, hi > 2 ? 2 : undefined, hi > 3 ? 3 : undefined]
    .filter((v): v is number => v !== undefined);
  const base = y(1);
  const active = hover === null ? null : pts[hover];

  return (
    <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Price multiplier for the last ${pts.length} quotes`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)}
                  stroke={v === 1 ? 'var(--cl-line-strong)' : 'var(--cl-line)'}
                  strokeDasharray={v === 1 ? undefined : '3 4'} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--cl-ink-3)">×{v.toFixed(1)}</text>
          </g>
        ))}

        {pts.map((p, i) => {
          const up = p.multiplier >= 1;
          const top = y(Math.max(p.multiplier, 1));
          const h = Math.max(1.5, Math.abs(y(p.multiplier) - base));
          return (
            <g key={`${p.quoteId}:${p.at}`}>
              <rect x={cx(i) - barW / 2} y={top} width={barW} height={h} rx={2}
                    fill={up ? 'var(--cl-ink)' : 'var(--cl-accent)'}
                    opacity={hover === null || hover === i ? (up ? 0.92 : 0.8) : 0.3} />
              {/* A full-height, invisible hit area: the bars are too thin to aim at. */}
              <rect x={cx(i) - band / 2} y={T} width={band} height={H - T - B}
                    fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}

        <text x={L} y={H - 7} fontSize={11} fill="var(--cl-ink-3)">{date(pts[0].at)}</text>
        {pts.length > 1 && (
          <text x={W - R} y={H - 7} textAnchor="end" fontSize={11} fill="var(--cl-ink-3)">{date(pts[pts.length - 1].at)}</text>
        )}
      </svg>

      {active && hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${(cx(hover) / W) * 100}%`,
            top: `${(y(Math.max(active.multiplier, 1)) / H) * 100}%`,
            // Flip to the left near the right edge so the tip never leaves the card.
            transform: cx(hover) > W * 0.72 ? 'translate(-100%, -115%)' : 'translate(-50%, -115%)',
          }}
        >
          <strong>×{active.multiplier.toFixed(2)}</strong>
          <span>{active.multiplier >= 1 ? 'memory made it dearer' : 'memory made it cheaper'}</span>
          <span className="muted">{date(active.at)} · quote {shortId(active.quoteId)}</span>
        </div>
      )}
    </div>
  );
}

const NAMESPACES: Array<{ id: UnderwriterNamespace; label: string }> = [
  { id: 'cases', label: 'Cases' }, { id: 'rules', label: 'Rules' },
  // Every accept, counter and decline the agent has made, as written to Walrus.
  { id: 'decisions', label: 'Decisions' },
  { id: 'quotes', label: 'Quotes' }, { id: 'policies', label: 'Policies' },
];

function MemoryTabs() {
  const [ns, setNs] = useState<UnderwriterNamespace>('cases');
  const mem = useUnderwriterMemory(ns);
  return (
    <section className="card">
      <h2>Memory on Walrus Mainnet</h2>
      <div className="tabs" role="tablist">
        {NAMESPACES.map((n) => (
          <button key={n.id} role="tab" aria-selected={ns === n.id} onClick={() => setNs(n.id)}>{n.label}</button>
        ))}
      </div>
      {mem.isPending ? <div className="skeleton" style={{ height: 100 }} />
        : mem.isError ? <ErrorState error={mem.error} onRetry={() => mem.refetch()} />
        : (
          <>
            <p className="row small" style={{ marginBottom: 8 }}><Database size={14} /> {mem.data.indexedCount} memories</p>
            {mem.data.items.length === 0 ? <p className="muted">No memories in this namespace yet.</p> : (
              <ul className="list-lines">
                {mem.data.items.map((it) => (
                  <li key={it.blobId} className="stack-sm" style={{ gap: 4 }}>
                    <span className={it.text === null ? 'muted' : undefined}>{it.text ?? 'Encrypted, not shown'}</span>
                    <span className="row small muted">
                      <BlobLink blobId={it.blobId} />
                      {it.expiresAt ? <span>Expires {it.expiresAt}</span> : it.endEpoch !== null ? <span>epoch {it.endEpoch}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
    </section>
  );
}

const ACTIVITY_TYPES = new Set<AnyEvent['type']>(['memory.queued', 'memory.written', 'memory.failed', 'quote.issued', 'rule.updated', 'policy.paid', 'x402.settled']);

const WRITE_BADGE: Record<MemoryWriteStatus, string> = {
  queued: 'badge badge--muted', writing: 'badge badge--warn', done: 'badge badge--pass', failed: 'badge badge--deny',
};

function ActivityLine({ e }: { e: AnyEvent }) {
  switch (e.type) {
    case 'memory.queued':
      return <><Database size={14} /> Queued {e.data.namespace} memory ({e.data.purpose})</>;
    case 'memory.written':
      return <><Database size={14} /> Saved {e.data.namespace} memory ({e.data.purpose}) <BlobLink blobId={e.data.blobId} /></>;
    case 'memory.failed':
      return <><CircleX size={14} className="deny" /> {e.data.namespace} memory failed: {e.data.error}</>;
    case 'quote.issued':
      return <><Zap size={14} /> Quote ×{e.data.multiplier.toFixed(2)} for {shortId(e.data.buyer)}</>;
    case 'rule.updated':
      return <><ScrollText size={14} /> Rule {shortId(e.data.ruleId)} now ×{e.data.multiplier.toFixed(2)} ({e.data.status})</>;
    case 'policy.paid':
      return <><Coins size={14} /> Paid {fromBase(e.data.payout)} DUSDC ({e.data.path}) <TxLink digest={e.data.digest} network="testnet" /></>;
    case 'x402.settled':
      return <><Bot size={14} /> Agent {shortId(e.data.payer)} bought cover <Link className="extlink" href={`/policies/${e.data.policyId}`}>policy</Link></>;
    default:
      return null;
  }
}

function Activity() {
  const writes = useMemoryWrites();
  const { recent } = useEvents();
  const lines = recent.filter((e) => ACTIVITY_TYPES.has(e.type));

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Live activity</h2>
      <div className="stack-sm">
        {writes.isPending ? <div className="skeleton" style={{ height: 60 }} />
          : writes.isError ? <ErrorState error={writes.error} onRetry={() => writes.refetch()} />
          : (
            <>
              <span className="strong">{writes.data.done} of {writes.data.total} writes saved</span>
              <ul className="list-lines small">
                {writes.data.items.slice(0, 10).map((w) => (
                  <li key={w.id} className="stack-sm" style={{ gap: 2 }}>
                    <span className="row"><span className={WRITE_BADGE[w.status]}>{w.status}</span> {w.namespace} · {w.purpose}</span>
                    {w.blobId ? <BlobLink blobId={w.blobId} /> : w.error ? <span className="deny">{w.error}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
      </div>
      <hr className="divider" />
      <div className="stack-sm">
        <span className="field-label">Since you opened this page</span>
        {lines.length === 0 ? <p className="small muted">Nothing yet. New quotes, memories and payouts appear here live.</p> : (
          <ul className="list-lines small">
            {lines.map((e) => <li key={`${e.type}:${e.id}:${e.receivedAt}`} className="row" style={{ gap: 6 }}><ActivityLine e={e} /></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
