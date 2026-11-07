'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { isValidTransactionDigest } from '@mysten/sui/utils';
import { Brain, CircleQuestionMark, Cpu, LoaderCircle, Radio, ShieldCheck, Timer } from 'lucide-react';
import { Address, Amount, Countdown, EmptyState, ErrorState, StatusBadge, TxLink } from '@/components/common';
import { CoverTitle } from '@/components/policy/CoverTitle';
import { PriceChart, type PricePoint } from '@/components/policy/PriceChart';
import { api, ApiError } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useEvents, useOnEvent } from '@/lib/events';
import { date, distanceToTrigger, e8ToUsd, fromBase, link, pct, usd } from '@/lib/format';
import type { Config, PolicyDTO } from '@/lib/types';
import { useConfig, useMarket, usePolicy } from '@/hooks/queries';

const BUFFER = 360; // ≈ 1 hour at one tick per 10 s

export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const policy = usePolicy(id);
  const { data: cfg } = useConfig();

  if (policy.isPending) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 44, width: '50%' }} />
        <div className="grid-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 80 }} />)}</div>
      </div>
    );
  }
  if (policy.error instanceof ApiError && policy.error.status === 404) {
    return (
      <section className="card">
        <EmptyState icon={CircleQuestionMark} title="No policy with this ID." action={<Link className="btn" href="/policies">My policies</Link>} />
      </section>
    );
  }
  if (policy.isError) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />;

  return <Detail p={policy.data} cfg={cfg} />;
}

function Detail({ p, cfg }: { p: PolicyDTO; cfg: Config | undefined }) {
  const { data: market } = useMarket();
  const { recent } = useEvents();
  const strike = e8ToUsd(p.strikeE8);
  const spot = market?.assets.find((a) => a.asset === p.asset);

  // Live price buffer, filled only from price.tick while this page is open.
  const [points, setPoints] = useState<PricePoint[]>([]);
  useOnEvent(['price.tick'], (e) => {
    const tick = e.data.prices.find((x) => x.asset === p.asset);
    if (tick) setPoints((pts) => [...pts, { t: tick.publishMs, v: tick.spotUsd }].slice(-BUFFER));
  });

  const breachEvents = recent
    .filter((e): e is Extract<typeof e, { type: 'breach.reported' | 'breach.reset' }> =>
      (e.type === 'breach.reported' || e.type === 'breach.reset') && e.data.policyId === p.policyId)
    .slice().reverse();

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="stack-sm">
          <h1 className="page-title" style={{ fontSize: 32 }}><CoverTitle policy={p} /></h1>
          <div className="row small">
            <StatusBadge status={p.status} />
            <span className="muted">Holder</span> <Address id={p.holder} />
            <span className="muted">Policy</span> <Address id={p.policyId} href={cfg ? link.testnetObject(cfg, p.policyId) : undefined} />
          </div>
        </div>
      </div>

      <section className="card grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="figure"><span className="label">Payout</span><span className="big-sm"><Amount units={p.payout} /></span></div>
        <div className="figure"><span className="label">Premium paid</span><span className="big-sm"><Amount units={p.premium} /></span></div>
        <div className="figure"><span className="label">Window</span><span>{date(p.startMs)} → {date(p.endMs)}</span></div>
        {(p.status === 'active' || p.status === 'breach') && (
          <div className="figure"><span className="label">Ends in</span><span className="big-sm"><Countdown to={p.endMs} /></span></div>
        )}
      </section>

      {p.kind === 'price' && (
        <div className="grid-main-side">
          <section className="card">
            <h2>Price vs trigger</h2>
            <PriceChart points={points} trigger={strike} />
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Live since you opened this page{points.length === 0 ? ' — waiting for the first price tick.' : ` · ${points.length} ticks`}
            </p>
          </section>
          <div className="stack">
            <section className="card stack-sm">
              <div className="figure"><span className="label">Now</span><span className="big-sm">{spot ? usd(spot.spotUsd) : '—'}</span></div>
              {spot && <span className={distanceToTrigger(spot.spotUsd, strike) < 0 ? 'deny' : ''}>
                {distanceToTrigger(spot.spotUsd, strike) >= 0
                  ? `${pct(distanceToTrigger(spot.spotUsd, strike))} above trigger`
                  : `${pct(-distanceToTrigger(spot.spotUsd, strike))} below trigger`}
              </span>}
              <span className="small muted">Trigger {usd(strike)}</span>
            </section>
            {p.status === 'breach' && cfg && <BreachTimer p={p} cfg={cfg} strike={strike} />}
          </div>
        </div>
      )}

      {p.kind === 'liquidation' && <LiquidationBlock p={p} cfg={cfg} />}

      <section className="card">
        <h2>Timeline</h2>
        <ol className="timeline">
          <li className="row">Bought {p.buyDigest && <TxLink digest={p.buyDigest} network="testnet" />}</li>
          {breachEvents.map((e) => (
            <li key={e.id} className="row">
              {e.type === 'breach.reported' ? 'Price below trigger' : 'Price recovered, breach reset'} at {usd(Number(e.data.priceE8) / 1e8)}
              <TxLink digest={e.data.digest} network="testnet" />
            </li>
          ))}
          {p.status === 'paid' && (
            <li className="row pass">
              {p.settlePath === 'liquidation' ? 'Paid by liquidation proof' : 'Paid by price check'}
              {p.settleDigest && <TxLink digest={p.settleDigest} network="testnet" />}
            </li>
          )}
          {p.status === 'expired' && (
            <li className="row muted">Expired {p.settleDigest && <TxLink digest={p.settleDigest} network="testnet" />}</li>
          )}
        </ol>
        {breachEvents.length === 0 && p.status !== 'paid' && p.status !== 'expired' && (
          <p className="tiny muted">Breach events appear here as they happen while this page is open.</p>
        )}
      </section>

      {p.asset === 'BTC' && p.kind === 'price' && p.hedge.status !== 'none' && (
        <section className="card">
          <h2>Hedge</h2>
          <p>Partial hedge on DeepBook Predict: <span className="badge">{p.hedge.status}</span></p>
          {p.hedge.detail && <p className="small muted" style={{ marginTop: 6 }}>{p.hedge.detail}</p>}
        </section>
      )}

      <div className="note">
        <Brain size={16} />
        <span>This outcome will be saved to the underwriter&apos;s memory and, if you&apos;re set up, to your own history. <Link className="linkbtn" href="/memory">My memory</Link></span>
      </div>
    </div>
  );
}

function BreachTimer({ p, cfg, strike }: { p: PolicyDTO; cfg: Config; strike: number }) {
  const deadline = p.breachStartedMs + cfg.pool.confirmDelayMs;
  const [over, setOver] = useState(() => Date.now() >= deadline);
  useEffect(() => { setOver(Date.now() >= deadline); }, [deadline]);
  return (
    <section className="card card--raised stack-sm" aria-live="polite">
      <span className="row warn strong"><Timer size={18} /> Breach</span>
      {over ? (
        <span className="row"><LoaderCircle size={16} className="spin" /> Confirming on Sui…</span>
      ) : (
        <>
          <span className="big"><Countdown to={deadline} onDone={() => setOver(true)} /></span>
          <span className="small">Pays {fromBase(p.payout)} DUSDC if the price stays below {usd(strike)} until then.</span>
        </>
      )}
      <span className="tiny muted">The confirm transaction is sent by Ghostwriter, not by you.</span>
    </section>
  );
}

function LiquidationBlock({ p, cfg }: { p: PolicyDTO; cfg: Config | undefined }) {
  const { recent } = useEvents();
  const seen = recent.filter((e): e is Extract<typeof e, { type: 'liquidation.seen' }> =>
    e.type === 'liquidation.seen' && e.data.obligationId === p.obligationId);

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>What we&apos;re watching</h2>
      <p className="row">
        <Radio size={16} /> Suilend obligation
        <Address id={p.obligationId} href={cfg ? link.mainnetObject(cfg, p.obligationId) : undefined} /> on Sui Mainnet
      </p>
      <p className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Cpu size={16} style={{ flexShrink: 0, marginTop: 3 }} />
        <span>If this obligation is liquidated before {date(p.endMs)}, a Nautilus enclave checks the Mainnet transaction and signs a proof. The contract verifies the signature and pays you.</span>
      </p>

      <div>
        <span className="field-label">Seen liquidations</span>
        {seen.length === 0 ? (
          <p className="small muted">None since you opened this page.</p>
        ) : (
          <ul className="list-lines">
            {seen.map((e) => (
              <li key={e.id} className="row">
                <TxLink digest={e.data.txDigest} network="mainnet" />
                <span className={e.data.matchedPolicyId === p.policyId ? 'badge badge--pass' : 'badge badge--muted'}>
                  {e.data.matchedPolicyId === p.policyId ? 'matched this policy' : 'not matched'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(p.status === 'active' || p.status === 'breach') && <ManualClaim policyId={p.policyId} />}
    </section>
  );
}

function ManualClaim({ policyId }: { policyId: string }) {
  const [digest, setDigest] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; settleDigest: string } | { ok: false; message: string } | null>(null);
  const valid = isValidTransactionDigest(digest.trim());

  async function claim() {
    setBusy(true); setResult(null);
    try {
      const r = await api.claimLiquidation(policyId, digest.trim());
      setResult({ ok: true, settleDigest: r.settleDigest });
    } catch (e) {
      let message = userMessage(e);
      if (e instanceof ApiError && e.status === 409) message = `This policy can't be claimed now (${e.message}).`;
      if (e instanceof ApiError && e.status === 502) message = 'The liquidation checker is offline.';
      setResult({ ok: false, message });
    } finally { setBusy(false); }
  }

  return (
    <details>
      <summary className="linkbtn small"><ShieldCheck size={14} /> Manual claim</summary>
      <form className="stack-sm" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (valid) claim(); }}>
        <div className="field">
          <label htmlFor="liq-digest">Mainnet transaction digest with the liquidation</label>
          <input id="liq-digest" className="input mono" value={digest} spellCheck={false} autoComplete="off"
            aria-invalid={digest !== '' && !valid} onChange={(e) => setDigest(e.target.value)} />
          {digest !== '' && !valid && <span className="field-error">That is not a valid transaction digest.</span>}
        </div>
        <div><button type="submit" className="btn btn--sm" disabled={!valid || busy}><ShieldCheck size={14} /> {busy ? 'Checking…' : 'Check and claim'}</button></div>
        {result?.ok && <div className="note note--pass"><span>Paid. <TxLink digest={result.settleDigest} network="testnet" /></span></div>}
        {result && !result.ok && <div className="note note--deny" role="alert"><span>{result.message}</span></div>}
      </form>
    </details>
  );
}
