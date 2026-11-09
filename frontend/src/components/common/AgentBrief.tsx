'use client';
// Tell the agent what you want, in a sentence. It does the rest.
//
// This replaces a four-field form and a "now run this CLI command" note. The form made the visitor
// the buyer; the point of the scene is that they are not — a program with its own wallet reads the
// instruction, is quoted over x402, decides, pays, and comes back insured.
import { useState } from 'react';
import { Bot, CircleCheck, CircleX, LoaderCircle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useConfig } from '@/hooks/queries';
import type { AgentRun } from '@/lib/types';

const EXAMPLES = [
  "Cover my SUI if it drops 15% over the next 3 days. Don't pay more than 4 gUSD.",
  'I want 20 gUSD of protection for a week if SUI falls 10%. Budget 2 gUSD.',
  'Insure me against a 5% SUI drop tomorrow, but spend at most 0.5 gUSD.',
];

export function AgentBrief() {
  const { data: cfg } = useConfig();
  const [brief, setBrief] = useState(EXAMPLES[0]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (brief.trim().length < 5 || busy) return;
    setBusy(true); setError(null); setRun(null);
    try {
      setRun(await api.runAgent(brief.trim()));
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="stack-sm">
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={18} /> Tell the agent what you want
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          It reads the instruction, is quoted over x402, decides whether the price fits the budget
          you gave it, and pays from <strong>its own wallet</strong>. You never sign anything.
        </p>
      </div>

      <textarea
        className="input"
        rows={2}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        disabled={busy}
        style={{ resize: 'vertical', fontFamily: 'inherit' }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => { setBrief(x); setRun(null); }}>
            {x.length > 46 ? `${x.slice(0, 46)}…` : x}
          </button>
        ))}
      </div>

      <div>
        <button type="button" className="btn" disabled={busy || brief.trim().length < 5} onClick={go}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
          {busy ? 'The agent is working…' : 'Send it to the agent'}
        </button>
      </div>

      {error && <div className="note note--deny" role="alert"><span>{error}</span></div>}

      {run && (
        <div className="stack-sm" aria-live="polite">
          <div className="small">
            <strong>It read that as:</strong> trigger at {(run.mandate.triggerPct * 100).toFixed(0)}% of spot ·
            {' '}{run.mandate.payoutUsdc} gUSD cover · {run.mandate.durationDays} days ·
            {' '}budget {run.mandate.maxPremiumUsdc} gUSD
            {run.mandateSource === 'fallback' && <span className="muted"> (defaults — the model was unavailable)</span>}
          </div>

          <ol className="agent-steps">
            {run.steps.map((s, i) => (
              <li key={i} className={s.ok ? '' : 'agent-step--no'}>
                <span className="agent-step__mark">{s.ok ? <CircleCheck size={15} /> : <CircleX size={15} />}</span>
                <div>
                  <strong>{s.title}</strong>
                  {s.detail && <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{s.detail}</div>}
                  {s.data && <div className="mono small agent-step__data">{s.data}</div>}
                </div>
              </li>
            ))}
          </ol>

          {run.outcome === 'insured' && run.policyId && (
            <div className="note">
              <span>
                Insured for {run.premiumUsdc} gUSD, bought by the agent.{' '}
                {cfg && run.buyDigest && (
                  <a className="linkbtn" href={`${cfg.explorers.testnetTx}${run.buyDigest}`} target="_blank" rel="noreferrer">
                    View the transaction
                  </a>
                )}
              </span>
            </div>
          )}
          {run.outcome === 'declined' && (
            <div className="note note--warn"><span>The agent declined: the price was above the budget you gave it.</span></div>
          )}
        </div>
      )}
    </section>
  );
}
