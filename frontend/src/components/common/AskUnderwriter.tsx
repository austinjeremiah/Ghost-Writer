'use client';
// Talk to the underwriter.
//
// Every answer is grounded in memories recalled from Walrus for that question, and the blobs it
// used are listed underneath so a reader can open them. Ask it something outside its memory and it
// says so — which is the point: the answers come from the book's history, not from a model's
// training data.
import { useRef, useState } from 'react';
import { Brain, CornerDownLeft, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useAddress } from '@/hooks/queries';
import { BlobLink } from './BlobLink';
import type { AskCitation, AskTurn } from '@/lib/types';

type Entry = AskTurn & { citations?: AskCitation[]; recalled?: Record<string, number> };

const DEFAULT_SUGGESTIONS = [
  'What have you learned about SUI falling 5% in a week?',
  'Why would you refuse to cover 900 gUSD?',
  'How is your book doing?',
];

export function AskUnderwriter({
  title = 'Ask the underwriter',
  subtitle = 'It answers only from what it can recall on Walrus, and shows you the memories it used.',
  suggestions = DEFAULT_SUGGESTIONS,
  /** Facts about what the user is looking at, so "this quote" has a referent. */
  context,
  /** Renders inside another card rather than as its own. */
  embedded = false,
}: {
  title?: string;
  subtitle?: string;
  suggestions?: string[];
  context?: string;
  embedded?: boolean;
} = {}) {
  const address = useAddress();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setDraft('');
    const history: AskTurn[] = entries.map((e) => ({ role: e.role, text: e.text }));
    setEntries((prev) => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const r = await api.askUnderwriter(q, history, address, context);
      setEntries((prev) => [...prev, { role: 'agent', text: r.answer, citations: r.citations, recalled: r.recalled }]);
    } catch (e) {
      setEntries((prev) => [...prev, { role: 'agent', text: userMessage(e) }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  }

  const Wrapper = embedded ? 'div' : 'section';
  return (
    <Wrapper className={embedded ? 'stack' : 'card stack'}>
      <div className="stack-sm">
        <h2 style={{ margin: 0, fontSize: embedded ? 16 : undefined, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={embedded ? 16 : 18} /> {title}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>{subtitle}</p>
      </div>

      {entries.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="btn btn--sm btn--ghost" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="stack" style={{ maxHeight: embedded ? 320 : 460, overflowY: 'auto', gap: 14 }}>
          {entries.map((e, i) => (
            <div key={i} className={e.role === 'user' ? 'ask-turn ask-turn--user' : 'ask-turn'}>
              <span className="small" style={{ opacity: 0.6 }}>{e.role === 'user' ? 'You' : 'Underwriter'}</span>
              <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.text}</p>
              {e.citations && e.citations.length > 0 && (
                <div className="stack-sm" style={{ marginTop: 8 }}>
                  <span className="small" style={{ opacity: 0.6 }}>
                    recalled{' '}
                    {Object.entries(e.recalled ?? {})
                      .filter(([, n]) => n > 0)
                      .map(([ns, n]) => `${n} from ${ns.replace('ghostwriter-', '')}`)
                      .join(', ') || 'nothing'}
                  </span>
                  <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                    {e.citations.slice(0, 4).map((c) => (
                      <li key={c.blobId} style={{ opacity: 0.85 }}>
                        <BlobLink blobId={c.blobId} /> {c.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="ask-turn small" style={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: 8 }}>
              <LoaderCircle size={14} className="spin" /> recalling…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={(ev) => { ev.preventDefault(); void send(draft); }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          className="input"
          placeholder="Ask about its book, its memories, or a decision it made…"
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn" disabled={busy || draft.trim().length < 3}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <CornerDownLeft size={16} />} Ask
        </button>
      </form>
    </Wrapper>
  );
}
