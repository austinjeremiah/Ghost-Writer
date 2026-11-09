'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { Brain, CircleCheck, Info, KeyRound, LoaderCircle, ShieldPlus } from 'lucide-react';
import { Address, BlobLink, ErrorState, StepList, TxLink, WalletCapabilities, type Step } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useOnEvent } from '@/lib/events';
import { link, shortId } from '@/lib/format';
import { addGhostwriterKey, createMemoryAccount, savedAccountId } from '@/lib/memwal';
import { qk, useConfig } from '@/hooks/queries';
import { useBorrower } from '@/hooks/useBorrower';
import type { BorrowerDTO } from '@/lib/types';

type Busy = null | 'create' | 'key' | 'register';
type Live = { queued: boolean; blobId: string | null; failed: string | null; anchored: { seq: number; digest: string } | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OnboardPage() {
  const qc = useQueryClient();
  const config = useConfig();
  const cfg = config.data;
  const { address, status, borrower } = useBorrower();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [createDigest, setCreateDigest] = useState<string | null>(null);
  const [keyDigest, setKeyDigest] = useState<string | null>(null);
  const [keyDone, setKeyDone] = useState(false);
  const [registered, setRegistered] = useState<BorrowerDTO | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [waitingDelegate, setWaitingDelegate] = useState(false);
  const [error, setError] = useState<{ step: 2 | 3 | 4; message: string; link?: 'memory' } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [live, setLive] = useState<Live>({ queued: false, blobId: null, failed: null, anchored: null });

  // Reset per wallet; restore the account id saved by an earlier attempt.
  const lastAddress = useRef<string | null>(null);
  useEffect(() => {
    if (lastAddress.current === address) return;
    lastAddress.current = address;
    setAccountId(address ? savedAccountId.get(address) : null);
    setCreateDigest(null); setKeyDigest(null); setKeyDone(false); setRegistered(null);
    setError(null); setPasteOpen(false); setPasteNote(null);
    setLive({ queued: false, blobId: null, failed: null, anchored: null });
  }, [address]);

  const dto = registered ?? (status === 'registered' ? borrower : null);
  const isDone = !!dto;

  useOnEvent(['memory.queued', 'memory.written', 'memory.failed', 'ledger.anchored'], (e) => {
    if (!address) return;
    if (e.type === 'ledger.anchored') {
      if (e.data.borrower === address) setLive((l) => ({ ...l, anchored: { seq: e.data.seq, digest: e.data.digest } }));
      return;
    }
    if (e.data.account !== address) return;
    if (e.type === 'memory.queued') setLive((l) => ({ ...l, queued: true, failed: null }));
    if (e.type === 'memory.written') setLive((l) => ({ ...l, queued: true, blobId: e.data.blobId, failed: null }));
    if (e.type === 'memory.failed') setLive((l) => ({ ...l, failed: e.data.error }));
  });

  // ---------- actions ----------
  async function createAccount() {
    if (!cfg || !address) return;
    setBusy('create'); setError(null);
    try {
      const r = await createMemoryAccount(cfg, address);
      setCreateDigest(r.digest);
      if (!r.accountId) {
        setPasteNote('created');
        setPasteOpen(true);
      } else {
        savedAccountId.set(address, r.accountId);
        setAccountId(r.accountId);
      }
    } catch (e) {
      const msg = userMessage(e);
      setError({ step: 2, message: msg });
      // Any non-cancel error may mean the wallet already has an account (one per address).
      if (!/cancelled/.test(msg)) setPasteOpen(true);
    } finally { setBusy(null); }
  }

  async function addKey() {
    if (!cfg || !address || !accountId) return;
    setBusy('key'); setError(null);
    try {
      const r = await addGhostwriterKey(cfg, address, accountId);
      setKeyDigest(r.digest);
      setKeyDone(true);
    } catch (e) {
      const msg = userMessage(e);
      if (/already|exist/i.test(msg) && !/cancelled/.test(msg)) setKeyDone(true);
      else setError({ step: 3, message: msg });
    } finally { setBusy(null); }
  }

  async function register() {
    if (!address || !accountId) return;
    setBusy('register'); setError(null); setWaitingDelegate(false);
    const started = Date.now();
    try {
      for (;;) {
        try {
          const r = await api.registerBorrower(address, accountId);
          qc.setQueryData(qk.borrower(address), r);
          setRegistered(r);
          return;
        } catch (e) {
          const reason = e instanceof ApiError && e.status === 409 ? (e.details.reason as string | undefined) : undefined;
          // Walrus Memory's relayer caches delegate checks for up to 30 s.
          if (reason === 'DELEGATE_NOT_REGISTERED' && Date.now() - started < 30_000) {
            setWaitingDelegate(true);
            await sleep(5000);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      const reason = e instanceof ApiError && e.status === 409 ? (e.details.reason as string | undefined) : undefined;
      if (reason === 'NOT_OWNER') {
        setError({ step: 4, message: 'That memory account belongs to another wallet.' });
        setPasteOpen(true);
      } else if (reason === 'ALREADY_REGISTERED') {
        setError({ step: 4, message: 'This wallet is already registered with another memory account.', link: 'memory' });
      } else if (reason === 'DELEGATE_NOT_REGISTERED') {
        setError({ step: 4, message: 'Walrus Memory has not seen the Ghostwriter key yet. Try again in a moment.' });
      } else {
        setError({ step: 4, message: userMessage(e) });
      }
    } finally { setBusy(null); setWaitingDelegate(false); }
  }

  function savePasted(id: string) {
    if (!address) return;
    const norm = normalizeSuiAddress(id.trim());
    savedAccountId.set(address, norm);
    setAccountId(norm);
    setPasteOpen(false);
    setPasteNote(null);
    setError(null);
  }

  // ---------- step model ----------
  const current: 1 | 2 | 3 | 4 | 5 = isDone ? 5 : !address ? 1 : !accountId ? 2 : !keyDone ? 3 : 4;
  const stateFor = (n: 1 | 2 | 3 | 4): Step['state'] => {
    if (isDone || n < current) return 'done';
    if (n > current) return 'todo';
    if (error?.step === n) return 'error';
    if ((n === 2 && busy === 'create') || (n === 3 && busy === 'key') || (n === 4 && busy === 'register')) return 'doing';
    return 'todo';
  };

  const steps: Step[] = [
    { label: 'Connect wallet', state: stateFor(1), detail: address ? <span className="addr">{shortId(address)}</span> : undefined },
    {
      label: 'Create your memory account',
      state: stateFor(2),
      detail: <>
        {createDigest && <TxLink digest={createDigest} network="mainnet" />}
        {(accountId ?? dto?.memwalAccountId) && cfg && (
          <span>Account <Address id={(accountId ?? dto?.memwalAccountId)!} href={link.mainnetObject(cfg, (accountId ?? dto?.memwalAccountId)!)} /></span>
        )}
      </>,
    },
    {
      label: "Let Ghostwriter write your history",
      state: stateFor(3),
      detail: cfg ? <>
        <span>Label “{cfg.memwal.borrowerDelegateLabel}” · key <span className="mono">{shortId(cfg.memwal.borrowerDelegatePublicKeyHex)}</span></span>
        {keyDigest && <TxLink digest={keyDigest} network="mainnet" />}
      </> : undefined,
    },
    {
      label: 'Register with Ghostwriter',
      state: stateFor(4),
      detail: <>
        {waitingDelegate && <span className="row"><LoaderCircle size={14} className="spin" /> Waiting for Walrus Memory to see the new key…</span>}
        {dto?.ledgerId && cfg && <span>Ledger <Address id={dto.ledgerId} href={link.testnetObject(cfg, dto.ledgerId)} /></span>}
      </>,
    },
  ];

  // ---------- render ----------
  if (config.isError) {
    return (
      <>
        <Header />
        <ErrorState error={config.error} onRetry={() => config.refetch()} />
      </>
    );
  }

  const primary = (() => {
    if (current === 1) return <ConnectButton />;
    if (current === 5) return <Link className="btn" href="/cover"><ShieldPlus size={16} /> Get cover</Link>;
    if (!cfg) return <button className="btn" disabled>Loading settings…</button>;
    if (status === 'loading') return <button className="btn" disabled>Checking your wallet…</button>;
    if (current === 2) return <button className="btn" disabled={!!busy} onClick={createAccount}>{busy === 'create' ? 'Waiting for wallet…' : 'Create my memory account'}</button>;
    if (current === 3) return <button className="btn" disabled={!!busy} onClick={addKey}>{busy === 'key' ? 'Waiting for wallet…' : "Add Ghostwriter's key"}</button>;
    return <button className="btn" disabled={!!busy} onClick={register}>{busy === 'register' ? 'Registering…' : 'Register'}</button>;
  })();

  return (
    <>
      <Header />
      <div className="grid-main-side">
        <div className="stack">
          {!isDone && (
            <div className="note"><Info size={16} /><span>These two steps sign on <strong>Sui Mainnet</strong> and need a little SUI for gas. Buying cover later happens on Testnet.</span></div>
          )}
          {/* States up front whether this account can sign on Mainnet at all, instead of letting it
              fail inside the wallet with an empty error. */}
          {!isDone && <WalletCapabilities />}
          <section className="card">
            <StepList steps={steps} />
            {!isDone && current >= 2 && !accountId && !pasteOpen && (
              <button type="button" className="linkbtn small" style={{ marginTop: 8 }} onClick={() => setPasteOpen(true)}>
                I already have a memory account
              </button>
            )}
            {pasteOpen && !isDone && address && (
              <PasteAccount
                note={pasteNote === 'created' && createDigest ? <>Created (<TxLink digest={createDigest} network="mainnet" />). Paste the account ID from memory.walrus.xyz to continue.</> : null}
                onSave={savePasted}
                onCancel={() => setPasteOpen(false)}
              />
            )}
            {error && (
              <div className="note note--deny" role="alert" style={{ marginTop: 12 }}>
                <span>{error.message}{error.link === 'memory' && <> <Link className="linkbtn" href="/memory">Go to My memory</Link></>}</span>
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>{primary}</div>
          </section>
        </div>

        {isDone && dto && <SuccessPanel dto={dto} live={live} fresh={!!registered} />}
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Set up your <em>memory</em></h1>
        <p className="page-sub">Your insurance history lives in your own Walrus Memory account on Sui Mainnet. You can remove Ghostwriter&apos;s access at any time.</p>
      </div>
    </div>
  );
}

function PasteAccount({ note, onSave, onCancel }: { note: React.ReactNode; onSave: (id: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const valid = isValidSuiAddress(value.trim());
  return (
    <form
      className="stack-sm"
      style={{ marginTop: 12 }}
      onSubmit={(e) => { e.preventDefault(); if (valid) onSave(value); }}
    >
      {note && <p className="small">{note}</p>}
      <div className="field">
        <label htmlFor="memwal-account">Paste your memory account ID (from memory.walrus.xyz)</label>
        <input
          id="memwal-account" className="input mono" placeholder="0x…" value={value} autoComplete="off" spellCheck={false}
          aria-invalid={value !== '' && !valid} onChange={(e) => setValue(e.target.value)}
        />
        {value !== '' && !valid && <span className="field-error">That is not a valid Sui object ID.</span>}
      </div>
      <div className="row">
        <button type="submit" className="btn btn--sm" disabled={!valid}>Save account ID</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SuccessPanel({ dto, live, fresh }: { dto: BorrowerDTO; live: Live; fresh: boolean }) {
  // Registered before this visit and nothing new is in flight: report what the backend already has.
  const saved = !!live.blobId || (!fresh && !live.queued && dto.records > 0);
  const anchored = !!live.anchored || (!fresh && !live.queued && dto.anchoredSeq > 0);
  return (
    <section className="card card--raised stack" aria-live="polite">
      <div className="row"><CircleCheck size={22} className="pass" /><h2 className="card-title" style={{ margin: 0 }}>You&apos;re set up.</h2></div>
      <div className="grid-2">
        <div className="figure"><span className="big-sm">{dto.records}</span><span className="label">records in your history</span></div>
        <div className="figure"><span className="big-sm">#{dto.anchoredSeq}</span><span className="label">anchored on Sui</span></div>
      </div>
      <ul className="stack-sm small">
        <li className="row">
          {saved ? <CircleCheck size={14} className="pass" /> : <LoaderCircle size={14} className="spin" />}
          {live.blobId ? <>Saved <BlobLink blobId={live.blobId} /></> : saved ? 'Saved to Walrus' : 'Writing your first record to Walrus…'}
        </li>
        {live.failed && <li className="deny">Saving failed: {live.failed}. It will retry.</li>}
        <li className="row">
          {anchored ? <CircleCheck size={14} className="pass" /> : <LoaderCircle size={14} className="spin" />}
          {live.anchored
            ? <>Anchored on Sui (record #{live.anchored.seq}) <TxLink digest={live.anchored.digest} network="testnet" /></>
            : anchored ? `Anchored on Sui (record #${dto.anchoredSeq})` : 'Anchoring on Sui…'}
        </li>
      </ul>
      <div className="row">
        <Link className="btn" href="/cover"><ShieldPlus size={16} /> Get cover</Link>
        <Link className="btn btn--ghost" href="/memory"><Brain size={16} /> See my memory</Link>
      </div>
      <p className="tiny muted"><KeyRound size={12} /> The live lines show what happened since you opened this page.</p>
    </section>
  );
}
