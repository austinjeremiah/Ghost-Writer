'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  ArrowDownRight, ArrowUpRight, Brain, Database, KeyRound, Landmark, RefreshCw, ScrollText, Timer, TrendingDown, Wallet, Zap,
} from 'lucide-react';
import { BlobLink, Countdown, ErrorState, StepList, TxLink, type Step } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { buyAndConfirm, type BuyStep } from '@/lib/buy';
import { abortFromMessage, userMessage } from '@/lib/errors';
import { date, distanceToTrigger, fromBase, pct, shortId, usd } from '@/lib/format';
import type { Asset, Citation, Config, PolicyKind, QuoteDTO, QuoteInput } from '@/lib/types';
import { qk, useAddress, useConfig, useMarket, usePositions } from '@/hooks/queries';
import { useBorrower } from '@/hooks/useBorrower';
import { dusdcKey, useDusdc } from '@/hooks/useDusdc';

const DUSDC_FORM = 'https://tally.so/r/Xx102L';

export default function CoverPage() {
  const config = useConfig();
  const market = useMarket();
  const address = useAddress();
  const { status: borrowerStatus } = useBorrower();
  const positions = usePositions(address);

  const [kind, setKind] = useState<PolicyKind>('price');
  const [asset, setAsset] = useState<Asset>('SUI');
  const [obligationId, setObligationId] = useState('');
  const [trigger, setTrigger] = useState('');
  const [payout, setPayout] = useState('10');
  const [days, setDays] = useState('7');

  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<{ message: string; needsOnboard?: boolean } | null>(null);

  const cfg = config.data;
  const spot = market.data?.assets.find((a) => a.asset === asset);
  const registered = borrowerStatus === 'registered';

  // Any change to the request invalidates the quote.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setQuote(null); setQuoteError(null); };

  const limits = cfg && {
    payoutMin: Number(fromBase(cfg.limits.payoutMin)),
    payoutMax: Number(fromBase(cfg.limits.payoutMax)),
    daysMin: cfg.limits.durationDaysMin,
    daysMax: cfg.limits.durationDaysMax,
  };

  const triggerN = Number(trigger);
  const payoutN = Number(payout);
  const daysN = Number(days);
  const errors = {
    trigger: trigger === '' ? null
      : !(triggerN > 0) ? 'Trigger must be above 0.'
      : spot && triggerN >= spot.spotUsd ? "Trigger must be below today's price." : null,
    payout: payout === '' || !limits ? null
      : !(payoutN >= limits.payoutMin && payoutN <= limits.payoutMax) ? `Payout must be between ${limits.payoutMin} and ${limits.payoutMax} DUSDC.` : null,
    days: days === '' || !limits ? null
      : !Number.isInteger(daysN) || daysN < limits.daysMin || daysN > limits.daysMax ? `Length must be a whole number of days, ${limits.daysMin}–${limits.daysMax}.` : null,
    obligation: kind !== 'liquidation' || obligationId === '' ? null
      : !isValidSuiAddress(obligationId.trim()) ? 'That is not a valid Sui object ID.' : null,
  };
  const valid = !!spot && !!limits && trigger !== '' && payout !== '' && days !== ''
    && !errors.trigger && !errors.payout && !errors.days
    && (kind === 'price' || (registered && obligationId !== '' && !errors.obligation));

  async function getQuote() {
    if (!address || !valid) return;
    setQuoting(true); setQuoteError(null); setQuote(null);
    const input: QuoteInput = {
      buyer: address,
      kind, asset,
      triggerPriceUsd: triggerN,
      payoutUsdc: payoutN,
      durationDays: daysN,
      ...(kind === 'liquidation' ? { obligationId: normalizeSuiAddress(obligationId.trim()) } : {}),
    };
    try {
      setQuote(await api.quote(input));
    } catch (e) {
      const needsOnboard = kind === 'liquidation' && e instanceof ApiError && e.status === 404;
      setQuoteError({ message: needsOnboard ? 'Set up memory first.' : userMessage(e), needsOnboard });
    } finally { setQuoting(false); }
  }

  if (config.isError) return <><Header /><ErrorState error={config.error} onRetry={() => config.refetch()} /></>;

  const obligations = positions.data?.obligations ?? [];
  const formDisabled = market.isPending || !cfg;

  return (
    <>
      <Header />
      <div className="grid-2">
        {/* ---------- request form ---------- */}
        <section className="card">
          <h2>Your cover</h2>
          {market.isError ? (
            <ErrorState error={market.error} onRetry={() => market.refetch()} />
          ) : (
            <fieldset disabled={formDisabled} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              {formDisabled && <p className="muted small">Loading prices…</p>}

              <div className="field">
                <span className="field-label" id="kind-label">Kind</span>
                <div className="segmented" role="group" aria-labelledby="kind-label">
                  <button type="button" aria-pressed={kind === 'price'} onClick={() => edit(setKind)('price')}>
                    <TrendingDown size={16} /> Price drop
                  </button>
                  <button type="button" aria-pressed={kind === 'liquidation'} disabled={!registered} onClick={() => edit(setKind)('liquidation')}>
                    <Landmark size={16} /> Liquidation
                  </button>
                </div>
                <span className="hint">
                  {kind === 'price'
                    ? 'Pays if the price stays below your trigger.'
                    : 'Pays if your Suilend position is liquidated.'}
                  {!registered && <> Liquidation cover needs your memory. <Link className="linkbtn" href="/onboard">Set up memory first</Link></>}
                </span>
              </div>

              <div className="field">
                <label htmlFor="asset">Asset</label>
                <select id="asset" className="select" value={asset} onChange={(e) => edit(setAsset)(e.target.value as Asset)}>
                  <option value="SUI">SUI</option>
                  <option value="BTC">BTC</option>
                </select>
                {spot && <span className="hint">Now {usd(spot.spotUsd)}, volatility {pct(spot.volAnnual)} a year ({spot.volBucket})</span>}
              </div>

              {kind === 'liquidation' && (
                <div className="field">
                  <label htmlFor="obligation">{obligations.length ? 'Suilend obligation' : 'Suilend obligation ID (Mainnet)'}</label>
                  {obligations.length > 0 ? (
                    <select id="obligation" className="select" value={obligationId} onChange={(e) => edit(setObligationId)(e.target.value)}>
                      <option value="">Choose an obligation</option>
                      {obligations.map((o) => <option key={o.obligationId} value={o.obligationId}>{shortId(o.obligationId)}</option>)}
                    </select>
                  ) : (
                    <input
                      id="obligation" className="input mono" placeholder="0x…" value={obligationId} spellCheck={false}
                      aria-invalid={!!errors.obligation} onChange={(e) => edit(setObligationId)(e.target.value)}
                    />
                  )}
                  {errors.obligation && <span className="field-error">{errors.obligation}</span>}
                  {positions.data?.note && <span className="hint">{positions.data.note}</span>}
                </div>
              )}

              <div className="field">
                <label htmlFor="trigger">Trigger price (USD)</label>
                <input
                  id="trigger" className="input" type="number" inputMode="decimal" min="0" step="any" value={trigger}
                  aria-invalid={!!errors.trigger} onChange={(e) => edit(setTrigger)(e.target.value)}
                />
                <div className="row">
                  {[0.05, 0.1, 0.15].map((x) => (
                    <button key={x} type="button" className="btn btn--sm btn--ghost" disabled={!spot}
                      onClick={() => spot && edit(setTrigger)(String(Math.round(spot.spotUsd * (1 - x) * 1e4) / 1e4))}>
                      {Math.round(x * 100)}% below
                    </button>
                  ))}
                </div>
                {errors.trigger
                  ? <span className="field-error">{errors.trigger}</span>
                  : spot && triggerN > 0 && <span className="hint">{pct(distanceToTrigger(spot.spotUsd, triggerN))} below today&apos;s price</span>}
              </div>

              <div className="grid-2" style={{ gap: 16 }}>
                <div className="field">
                  <label htmlFor="payout">Payout (DUSDC)</label>
                  <input
                    id="payout" className="input" type="number" inputMode="decimal" min={limits?.payoutMin} max={limits?.payoutMax} step="any"
                    value={payout} aria-invalid={!!errors.payout} onChange={(e) => edit(setPayout)(e.target.value)}
                  />
                  {limits && <span className="hint">{limits.payoutMin}–{limits.payoutMax} DUSDC</span>}
                  {errors.payout && <span className="field-error">{errors.payout}</span>}
                </div>
                <div className="field">
                  <label htmlFor="days">Length (days)</label>
                  <input
                    id="days" className="input" type="number" inputMode="numeric" min={limits?.daysMin} max={limits?.daysMax} step="1"
                    value={days} aria-invalid={!!errors.days} onChange={(e) => edit(setDays)(e.target.value)}
                  />
                  {limits && <span className="hint">{limits.daysMin}–{limits.daysMax} days</span>}
                  {errors.days && <span className="field-error">{errors.days}</span>}
                </div>
              </div>

              {kind === 'price' && cfg && (
                <div className="note"><Timer size={16} /><span>Pays if the price stays below the trigger for {Math.round(cfg.pool.confirmDelayMs / 60000)} minutes at any time in the window.</span></div>
              )}

              {address ? (
                <button type="button" className="btn" disabled={!valid || quoting || !!cfg?.pool.paused} onClick={getQuote}>
                  <Zap size={16} /> {quoting ? 'Getting quote…' : 'Get quote'}
                </button>
              ) : (
                <div className="stack-sm">
                  <span className="muted small">Connect wallet to get a quote. The quote is signed for your address.</span>
                  <ConnectButton />
                </div>
              )}
              {cfg?.pool.paused && <span className="field-error">New cover is paused.</span>}
              {quoteError && (
                <div className="note note--deny" role="alert">
                  <span>{quoteError.message}{quoteError.needsOnboard && <> <Link className="linkbtn" href="/onboard">Set up memory</Link></>}</span>
                </div>
              )}
            </fieldset>
          )}
        </section>

        {/* ---------- quote ---------- */}
        <div className="stack">
          {quote && cfg ? (
            <QuotePanel
              key={quote.quoteId}
              quote={quote}
              cfg={cfg}
              registered={registered}
              onClear={() => setQuote(null)}
              onRequote={getQuote}
            />
          ) : (
            <section className="card">
              <h2>Your quote</h2>
              <p className="muted">Fill in the request and press “Get quote”. You&apos;ll see the premium, how it was built, and the memories that changed it.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Get <em>cover</em></h1>
        <p className="page-sub">Build a cover request, see a signed quote with its full price breakdown and the memories that changed it, then buy it with your wallet.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Factor({ value, label }: { value: number; label: string }) {
  const Icon = value > 1 ? ArrowUpRight : value < 1 ? ArrowDownRight : null;
  const cls = value > 1 ? 'deny' : value < 1 ? 'pass' : '';
  return (
    <div className="term">
      <span className={`v ${cls}`}>×{value.toFixed(2)}{Icon && <Icon size={16} aria-label={value > 1 ? 'raised the price' : 'lowered the price'} />}</span>
      <span className="l">{label}</span>
    </div>
  );
}

const CITE_ICON: Record<Citation['kind'], typeof Database> = { case: Database, rule: ScrollText, record: Brain };

function QuotePanel({ quote: q, cfg, registered, onClear, onRequote }: {
  quote: QuoteDTO; cfg: Config; registered: boolean; onClear: () => void; onRequote: () => void;
}) {
  const [expired, setExpired] = useState(() => Date.now() >= q.expiresMs);
  const p = q.pricing;
  return (
    <>
      <section className="card stack" aria-live="polite">
        <div className="row-between">
          <div>
            <div className="big">{fromBase(q.premium)} <span className="big-sm">DUSDC</span></div>
            <div className="muted">for {fromBase(q.payout)} DUSDC of cover</div>
          </div>
          <span className={`badge ${expired ? 'badge--deny' : ''}`}>
            <Timer size={13} /> {expired ? 'Price expired' : <>Price held for <Countdown to={q.expiresMs} onDone={() => setExpired(true)} /></>}
          </span>
        </div>

        <div className="stack-sm">
          <span className="field-label">How the price is built</span>
          <div className="formula">
            <div className="term"><span className="v">{fromBase(p.basePremium)}</span><span className="l">model price</span></div>
            <span className="op">×</span>
            <Factor value={p.factors.cases} label="past cases" />
            <span className="op">×</span>
            <Factor value={p.factors.rules} label="learned rules" />
            <span className="op">×</span>
            <Factor value={p.factors.borrower} label="your history" />
            <span className="op">=</span>
            <div className="term"><span className="v strong">{fromBase(q.premium)}</span><span className="l">your premium</span></div>
          </div>
          <span className="small muted">Chance of payout ≈ {pct(p.probability)} · combined multiplier ×{p.multiplier.toFixed(2)}</span>
        </div>
      </section>

      <section className="card">
        <h2>Why</h2>
        {q.citations.length === 0 ? (
          <p className="muted">No past memory matched this request. The price is the model price.</p>
        ) : (
          <ul className="list-lines">
            {q.citations.map((c) => {
              const Icon = CITE_ICON[c.kind];
              return (
                <li key={`${c.namespace}:${c.blobId}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <Icon size={16} style={{ flexShrink: 0, marginTop: 3 }} aria-label={c.kind} />
                  <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
                    <span>{c.summary}</span>
                    <span className="row small muted">
                      {c.distance !== undefined && <span>similarity {(1 - c.distance).toFixed(2)}</span>}
                      <BlobLink blobId={c.blobId} label="View memory" />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <hr className="divider" style={{ margin: '12px 0' }} />
        <p>{q.explanation}</p>
        <span className="badge badge--muted" style={{ marginTop: 8 }}>{q.explanationSource === 'openai' ? 'Written by AI' : 'Standard explanation'}</span>
      </section>

      <BuyBox quote={q} cfg={cfg} expired={expired} onClear={onClear} onRequote={onRequote} />

      {q.kind === 'price' && !registered && (
        <div className="note"><KeyRound size={16} /><span>Set up your memory to build a history that lowers future prices. <Link className="linkbtn" href="/onboard">Set up memory</Link></span></div>
      )}
    </>
  );
}

function BuyBox({ quote: q, cfg, expired, onClear, onRequote }: {
  quote: QuoteDTO; cfg: Config; expired: boolean; onClear: () => void; onRequote: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const address = useAddress();
  const balance = useDusdc();
  const [step, setStep] = useState<BuyStep | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const low = balance.data !== undefined && BigInt(balance.data) < BigInt(q.premium);
  const bought = !!digest; // the tx landed on chain; only the backend sync may be pending

  const done = async (policyId: string) => {
    qc.invalidateQueries({ queryKey: dusdcKey(address) });
    qc.invalidateQueries({ queryKey: qk.policiesRoot });
    router.push(`/policies/${policyId}`);
  };

  async function buy() {
    setError(null); setDigest(null);
    try {
      const policy = await buyAndConfirm(q, cfg, (s, d) => { setStep(s); if (d) setDigest(d); });
      await done(policy.policyId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = abortFromMessage(msg);
      setError(userMessage(e));
      if (code === 2 || code === 4) onClear();
      setStep((s) => (s === 'wallet' ? null : s));
    }
  }

  async function retrySync() {
    if (!digest) return;
    setSyncing(true); setError(null);
    try {
      const policy = await api.confirmPolicy(digest, q.quoteId);
      setStep('done');
      await done(policy.policyId);
    } catch (e) { setError(userMessage(e)); } finally { setSyncing(false); }
  }

  const steps: Step[] | null = step && [
    { label: 'Approve in wallet', state: step === 'wallet' ? (error ? 'error' : 'doing') : 'done' },
    { label: 'Recording your policy', state: step === 'wallet' ? 'todo' : step === 'confirming' ? (error ? 'error' : 'doing') : 'done',
      link: digest ? <TxLink digest={digest} network="testnet" /> : undefined },
    { label: 'Done', state: step === 'done' ? 'done' : 'todo' },
  ];

  const lines = useMemo(() => [
    `Pays ${fromBase(q.payout)} DUSDC to ${shortId(q.buyer)}`,
    `Covers ${date(q.startMs)} → ${date(q.endMs)}`,
    'Signs on Sui Testnet',
  ], [q]);

  return (
    <section className="card card--raised stack">
      <h2 style={{ margin: 0 }}>Buy</h2>
      <ul className="stack-sm small">{lines.map((l) => <li key={l}>{l}</li>)}</ul>

      {low && !bought && (
        <div className="note note--warn">
          <Wallet size={16} />
          <span>You have {fromBase(balance.data!)} DUSDC. <a className="linkbtn" href={DUSDC_FORM} target="_blank" rel="noreferrer">Get test DUSDC</a></span>
        </div>
      )}

      {steps && <StepList steps={steps} />}

      {bought && step !== 'done' && error && (
        <div className="note note--warn">
          <span>Your cover is bought (<TxLink digest={digest!} network="testnet" />). We&apos;re still syncing it.</span>
          <button type="button" className="btn btn--sm btn--ghost" disabled={syncing} onClick={retrySync}>
            <RefreshCw size={14} /> {syncing ? 'Syncing…' : 'Retry sync'}
          </button>
        </div>
      )}
      {error && !bought && <div className="note note--deny" role="alert"><span>{error}</span></div>}

      {!bought && (
        !address ? <ConnectButton />
          : expired ? (
            <button type="button" className="btn" onClick={onRequote}><RefreshCw size={16} /> Get a new quote</button>
          ) : (
            <button type="button" className="btn" disabled={low || cfg.pool.paused || step === 'wallet' || balance.isPending} onClick={buy}>
              <Wallet size={16} /> {step === 'wallet' ? 'Waiting for wallet…' : `Buy cover for ${fromBase(q.premium)} DUSDC`}
            </button>
          )
      )}
    </section>
  );
}
