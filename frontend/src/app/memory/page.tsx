'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import {
  Ban, CircleCheck, CircleX, Coins, Hash, KeyRound, LoaderCircle, ShieldCheck, ShieldPlus, ShieldX, Signature,
  TriangleExclamationPoint, Wallet,
} from 'lucide-react';
import { Address, BlobLink, CopyButton, EmptyState, ErrorState, TxLink } from '@/components/common';
import { useToast } from '@/components/shell/Toasts';
import { userMessage } from '@/lib/errors';
import { date, evidenceNetwork, fromBase, link, shortId, usd } from '@/lib/format';
import { revokeGhostwriterKey } from '@/lib/memwal';
import type { BorrowerDTO, Config, HistoryDTO, HistoryRecord, RecordKind } from '@/lib/types';
import { useConfig, useHistory } from '@/hooks/queries';
import { useBorrower } from '@/hooks/useBorrower';

export default function MemoryPage() {
  const { address, status, borrower, error, refetch } = useBorrower();
  const history = useHistory(status === 'registered' ? address : null);
  const { data: cfg } = useConfig();

  const header = (
    <div className="page-head">
      <div>
        <h1 className="page-title">My <em>memory</em></h1>
        <p className="page-sub">Your signed, hash-chained insurance history on Walrus Mainnet, checked against its anchor on Sui.</p>
      </div>
    </div>
  );

  if (status === 'no_wallet') {
    return <>{header}<section className="card"><EmptyState icon={Wallet} title="Connect your wallet to see your memory." action={<ConnectButton />} /></section></>;
  }
  if (status === 'loading') return <>{header}<div className="skeleton" style={{ height: 120 }} /></>;
  if (status === 'error') return <>{header}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (status === 'not_registered' || !borrower) {
    return (
      <>{header}
        <section className="card">
          <EmptyState icon={KeyRound} title="You don't have a memory yet." action={<Link className="btn" href="/onboard"><KeyRound size={16} /> Set up my memory</Link>} />
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="stack">
        <VerificationBanner history={history.data} loading={history.isPending} cfg={cfg} />
        {history.isError && <ErrorState error={history.error} onRetry={() => history.refetch()} />}
        <div className="grid-main-side">
          <section className="card">
            <h2>Records</h2>
            {history.isPending ? (
              <div className="stack-sm">{[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}</div>
            ) : history.data && history.data.records.length > 0 ? (
              <ol className="timeline">
                {[...history.data.records].sort((a, b) => b.seq - a.seq).map((r) => <RecordRow key={r.seq} r={r} />)}
              </ol>
            ) : (
              <p className="muted">No records yet.</p>
            )}
          </section>
          <div className="stack">
            <PriceFactor b={borrower} />
            {cfg && address && <WhoCanWrite b={borrower} cfg={cfg} address={address} />}
          </div>
        </div>
      </div>
    </>
  );
}

function VerificationBanner({ history, loading, cfg }: { history?: HistoryDTO; loading: boolean; cfg?: Config }) {
  if (loading) {
    return <div className="note"><LoaderCircle size={16} className="spin" /><span>Checking your history on Walrus and Sui…</span></div>;
  }
  if (!history) return null;
  const v = history.verification;
  const anchor = cfg && history.ledgerId
    ? <a className="linkbtn" href={link.testnetObject(cfg, history.ledgerId)} target="_blank" rel="noreferrer">Anchor on Sui</a>
    : null;

  if (v.partial) {
    return (
      <div className="note note--warn">
        <TriangleExclamationPoint size={16} />
        <span>Partly checked: Walrus returned {v.recalled} of {v.indexed ?? '?'} records. Try again in a minute. {anchor}</span>
      </div>
    );
  }
  if (!v.valid) {
    return (
      <div className="note note--deny" role="alert">
        <ShieldX size={16} />
        <div>
          History check failed:
          <ul style={{ listStyle: 'disc', paddingLeft: 18, marginTop: 4 }}>{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {anchor}
        </div>
      </div>
    );
  }
  return (
    <div className="note note--pass">
      <ShieldCheck size={16} />
      <span>History verified. {history.records.length} records signed by Ghostwriter, chain unbroken, matches the anchor on Sui (record #{v.anchoredSeq}). {anchor}</span>
    </div>
  );
}

const KIND_ICON: Record<RecordKind, typeof KeyRound> = {
  onboarded: KeyRound,
  policy_bought: ShieldPlus,
  warning: TriangleExclamationPoint,
  response: CircleCheck,
  payout: Coins,
  expired: CircleX,
};

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

function recordTitle(r: HistoryRecord): string {
  const d = r.data;
  switch (r.kind) {
    case 'onboarded': return 'Linked your memory account';
    case 'policy_bought': return `Bought ${str(d.kind)} cover, payout ${d.payout != null ? fromBase(str(d.payout)) : '?'} DUSDC`;
    case 'warning': return `Warned: price near trigger (${usd(num(d.spotUsd))} vs ${usd(num(d.strikeUsd))})`;
    case 'response': return `Responded: ${d.action === 'deposit' ? 'added collateral' : 'repaid debt'} on Suilend`;
    case 'payout': return `Received ${d.payout != null ? fromBase(str(d.payout)) : '?'} DUSDC (${str(d.path)})`;
    case 'expired': return `Cover ended${d.nearMiss ? ' after a near miss' : ''}`;
  }
}

function RecordRow({ r }: { r: HistoryRecord }) {
  const Icon = KIND_ICON[r.kind];
  return (
    <li>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <span className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <Icon size={16} style={{ flexShrink: 0, marginTop: 3 }} />
          <span><span className="muted">#{r.seq}</span> {recordTitle(r)}</span>
        </span>
        <span className="small muted nowrap">{date(r.at)}</span>
      </div>
      <div className="row small" style={{ marginTop: 6, gap: '4px 14px' }}>
        {r.evidence.map((d) => <TxLink key={d} digest={d} network={evidenceNetwork(r.kind)} />)}
        {r.blobId ? <BlobLink blobId={r.blobId} /> : <span className="muted">Saving to Walrus…</span>}
        {r.sigValid
          ? <span className="row pass" style={{ gap: 4 }}><Signature size={13} /> Signature OK</span>
          : <span className="row deny" style={{ gap: 4 }}><ShieldX size={13} /> Bad signature</span>}
        <span className="addr" title={`${r.hash} ← ${r.prev}`}>
          <Hash size={13} /> {shortId(r.hash)} <CopyButton value={r.hash} label="Copy hash" />
          ← {shortId(r.prev)} <CopyButton value={r.prev} label="Copy previous hash" />
        </span>
      </div>
    </li>
  );
}

function PriceFactor({ b }: { b: BorrowerDTO }) {
  const s = b.score;
  return (
    <section className="card stack-sm">
      <h2 style={{ margin: 0 }}>Your price factor</h2>
      <span className={`big ${s.discountFactor < 1 ? 'pass' : s.discountFactor > 1 ? 'deny' : ''}`}>×{s.discountFactor.toFixed(2)}</span>
      <span className="small muted">Below 1 means cheaper cover.</span>
      <div className="grid-3" style={{ marginTop: 8 }}>
        <div className="figure"><span className="big-sm">{s.warnings}</span><span className="label">warnings</span></div>
        <div className="figure"><span className="big-sm">{s.responses}</span><span className="label">responses</span></div>
        <div className="figure"><span className="big-sm">{s.payouts}</span><span className="label">payouts</span></div>
      </div>
      <span className="small">You answered {s.responses} of {s.warnings} warnings.</span>
    </section>
  );
}

function WhoCanWrite({ b, cfg, address }: { b: BorrowerDTO; cfg: Config; address: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true); setError(null);
    try {
      const r = await revokeGhostwriterKey(cfg, address, b.memwalAccountId);
      setRevoked(r.digest);
      setConfirming(false);
      toast({ icon: Ban, text: 'Access revoked.', action: { label: 'View Mainnet tx', href: link.mainnetTx(cfg, r.digest), external: true } });
    } catch (e) { setError(userMessage(e)); } finally { setBusy(false); }
  }

  return (
    <section className="card stack-sm">
      <h2 style={{ margin: 0 }}>Who can write to it</h2>
      <div className="row-between">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="strong">{cfg.memwal.borrowerDelegateLabel}</span>
          <span className="addr">{shortId(cfg.memwal.borrowerDelegatePublicKeyHex)} <CopyButton value={cfg.memwal.borrowerDelegatePublicKeyHex} /></span>
        </div>
        {revoked
          ? <span className="badge badge--deny">Revoked</span>
          : <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(true)}><Ban size={14} /> Revoke</button>}
      </div>
      {revoked && (
        <span className="small row">
          <TxLink digest={revoked} network="mainnet" />
          <Link className="linkbtn" href="/onboard">Add Ghostwriter&apos;s key again</Link>
        </span>
      )}
      {error && <div className="note note--deny" role="alert"><span>{error}</span></div>}
      <p className="small muted">
        Revoking stops Ghostwriter from saving new records. Records already saved stay in your account and stay readable by the key (Walrus Memory removal is forward-only).
      </p>

      <details>
        <summary className="linkbtn small">Verify it yourself</summary>
        <dl className="dl small" style={{ marginTop: 8 }}>
          <dt>Account</dt><dd><Address id={b.memwalAccountId} href={link.mainnetObject(cfg, b.memwalAccountId)} /></dd>
          <dt>Namespace</dt><dd className="mono">{cfg.memwal.historyNamespace}</dd>
          <dt>Record-signing key</dt><dd><span className="addr">{shortId(cfg.recordPubkeyHex, 10, 8)} <CopyButton value={cfg.recordPubkeyHex} /></span></dd>
          <dt>Ledger</dt><dd>{b.ledgerId ? <Address id={b.ledgerId} href={link.testnetObject(cfg, b.ledgerId)} /> : <span className="muted">—</span>}</dd>
        </dl>
        <p className="small muted" style={{ marginTop: 8 }}>Any underwriter you give access to can check the same signatures and the anchor on Sui.</p>
      </details>

      {confirming && (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="revoke-title" onClick={() => !busy && setConfirming(false)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h2 id="revoke-title" className="card-title" style={{ margin: 0 }}>Revoke Ghostwriter&apos;s access?</h2>
            <p>You&apos;ll sign on Sui Mainnet. Future records won&apos;t be saved, and your history discount will stop updating.</p>
            {error && <div className="note note--deny"><span>{error}</span></div>}
            <div className="row">
              <button type="button" className="btn btn--danger" disabled={busy} onClick={revoke}>
                <Ban size={16} /> {busy ? 'Waiting for wallet…' : 'Revoke on Mainnet'}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
