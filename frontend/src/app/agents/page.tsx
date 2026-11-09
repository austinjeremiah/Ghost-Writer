'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Bot, Info, Receipt, Signature, Zap } from 'lucide-react';
import { AgentBrief, Address, CopyButton, TxLink } from '@/components/common';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useEvents } from '@/lib/events';
import { fromBase } from '@/lib/format';
import type { Asset, PaymentRequired } from '@/lib/types';
import { useConfig, useAddress, useMarket } from '@/hooks/queries';

const AGENT_CMD = 'pnpm agent';

export default function AgentsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Agents can buy <em>cover</em> too</h1>
          <p className="page-sub">An agent asks for cover, gets an HTTP 402 with the price, signs the purchase transaction, and sends it back. The payment is the purchase, so cover starts the moment it settles.</p>
        </div>
      </div>
      <div className="stack">
        <section className="card">
          <h2>The flow</h2>
          <ol className="grid-3">
            <li className="stack-sm">
              <span className="row strong"><Bot size={18} /> 1. Ask</span>
              <span className="small"><code>POST /v1/agent/cover</code> with the cover request.</span>
            </li>
            <li className="stack-sm">
              <span className="row strong"><Receipt size={18} /> 2. Get the price</span>
              <span className="small"><code>402 Payment Required</code> with x402 v2 terms: scheme <code>exact</code>, network <code>sui:testnet</code>, amount = premium, pay to the vault.</span>
            </li>
            <li className="stack-sm">
              <span className="row strong"><Signature size={18} /> 3. Pay</span>
              <span className="small">The agent signs the <code>buy</code> transaction and resends with header <code>PAYMENT-SIGNATURE</code>. The backend checks it and executes it on Testnet; response header <code>PAYMENT-RESPONSE</code> has the tx digest.</span>
            </li>
          </ol>
        </section>

        {/* The agent acting on an instruction. The raw 402 panel below it is the protocol
            underneath, kept for anyone who wants to see the wire format. */}
        <AgentBrief />

        <div className="grid-2">
          <TryIt />
          <LivePurchases />
        </div>

        <div className="note small">
          <Info size={16} />
          <span>Follows the x402 v2 “exact” scheme for Sui. The spec lists <code>sui:mainnet</code>; we use <code>sui:testnet</code> by the same pattern. Our premium goes into the vault object, not an address, so the contract checks the amount.</span>
        </div>
      </div>
    </>
  );
}

function TryIt() {
  const address = useAddress();
  const { data: market } = useMarket();
  const cfg = useConfig().data;
  const [asset, setAsset] = useState<Asset>('SUI');
  const [trigger, setTrigger] = useState('');
  const [payout, setPayout] = useState('5');
  const [days, setDays] = useState('3');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PaymentRequired | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spot = market?.assets.find((a) => a.asset === asset)?.spotUsd;
  // Default trigger: 15% below spot, set once per asset when the price arrives.
  const [defaultedFor, setDefaultedFor] = useState<Asset | null>(null);
  useEffect(() => {
    if (spot !== undefined && defaultedFor !== asset) {
      setTrigger(String(Math.round(spot * 0.85 * 1e4) / 1e4));
      setDefaultedFor(asset);
    }
  }, [spot, asset, defaultedFor]);

  async function ask() {
    if (!address) return;
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.agentPaymentRequired({
        buyer: address, kind: 'price', asset,
        triggerPriceUsd: Number(trigger), payoutUsdc: Number(payout), durationDays: Number(days),
      }));
    } catch (e) { setError(userMessage(e)); } finally { setBusy(false); }
  }

  const ok = Number(trigger) > 0 && Number(payout) > 0 && Number.isInteger(Number(days)) && Number(days) > 0;
  const terms = result?.accepts[0];

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>The protocol underneath</h2>
      <p className="muted small" style={{ margin: 0 }}>The same request by hand, so you can read the raw x402 payment terms.</p>
      <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); if (ok) ask(); }}>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="a-asset">Asset</label>
            <select id="a-asset" className="select" value={asset} onChange={(e) => { setAsset(e.target.value as Asset); setResult(null); }}>
              {/* Same source of truth as /cover: whatever the backend prices. */}
              {(cfg?.enabledAssets ?? ['SUI']).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-trigger">Trigger (USD)</label>
            <input id="a-trigger" className="input" type="number" step="any" min="0" value={trigger} onChange={(e) => { setTrigger(e.target.value); setResult(null); }} />
          </div>
          <div className="field">
            <label htmlFor="a-payout">Payout (gUSD)</label>
            <input id="a-payout" className="input" type="number" step="any" min="0" value={payout} onChange={(e) => { setPayout(e.target.value); setResult(null); }} />
          </div>
          <div className="field">
            <label htmlFor="a-days">Days</label>
            <input id="a-days" className="input" type="number" step="1" min="1" value={days} onChange={(e) => { setDays(e.target.value); setResult(null); }} />
          </div>
        </div>
        {address ? (
          <div><button type="submit" className="btn" disabled={!ok || busy}><Zap size={16} /> {busy ? 'Asking…' : 'Ask for a price'}</button></div>
        ) : (
          <div className="stack-sm"><span className="small muted">Connect a wallet: the quote is signed for a buyer.</span><ConnectButton /></div>
        )}
      </form>

      {error && <div className="note note--deny" role="alert"><span>{error}</span></div>}

      {result && terms && (
        <div className="stack-sm" aria-live="polite">
          <span className="row"><span className="badge badge--warn">HTTP 402</span> <span className="small">{result.error}</span></span>
          <dl className="dl small">
            <dt>Scheme</dt><dd className="mono">{terms.scheme}</dd>
            <dt>Network</dt><dd className="mono">{terms.network}</dd>
            <dt>Amount</dt><dd>{fromBase(terms.amount)} gUSD</dd>
            <dt>Pay to</dt><dd><Address id={terms.payTo} /></dd>
            <dt>Max timeout</dt><dd>{terms.maxTimeoutSeconds} s</dd>
            <dt>Resource</dt><dd>{result.resource.description}</dd>
          </dl>
          <details>
            <summary className="linkbtn small">Raw 402 body</summary>
            <pre className="json">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}

      <p className="small muted">
        This panel only asks for the price. Use the box above to have the agent complete the
        purchase, or run it yourself from the backend folder: <code>{AGENT_CMD}</code>{' '}
        <CopyButton value={AGENT_CMD} label="Copy command" />
      </p>
    </section>
  );
}

function LivePurchases() {
  const { recent } = useEvents();
  const settled = recent.filter((e): e is Extract<typeof e, { type: 'x402.settled' }> => e.type === 'x402.settled');
  return (
    <section className="card">
      <h2>Live agent purchases</h2>
      {settled.length === 0 ? (
        <p className="muted">No agent purchases since you opened this page. Run <code>{AGENT_CMD}</code> to see one arrive.</p>
      ) : (
        <ul className="list-lines">
          {settled.map((e) => (
            <li key={`${e.id}:${e.data.digest}`} className="row small">
              <Bot size={16} /> <Address id={e.data.payer} /> bought cover
              <TxLink digest={e.data.digest} network="testnet" />
              <Link className="extlink" href={`/policies/${e.data.policyId}`}>View policy</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
