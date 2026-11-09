// Ask the underwriter.
//
// The agent answers from what it can recall, and only from that. Every namespace it owns is
// searched with the question itself as the query, the hits become the facts, and the model is told
// it may use nothing else. When recall comes back empty the honest answer is "I have no memory of
// that" — which is a feature: it makes the memory visible by its absence as well as its presence.
//
// Grounding also contains the obvious risk. Memory text is untrusted input: anyone who buys a
// policy writes into the underwriter's namespaces. The model may only quote and summarise it, and
// nothing it says moves money — pricing and the underwriting mandate are elsewhere, in code.
import { C, env } from '../config.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { pool } from '../chain/poolCache.js';
import { complete } from '../pricing/explain.js';
import { underwriter, recall } from '../memory/client.js';
import { getBorrower } from '../memory/records.js';

export type AskTurn = { role: 'user' | 'agent'; text: string };

export type AskCitation = { namespace: string; blobId: string; summary: string; distance?: number };

export type AskResult = {
  answer: string;
  citations: AskCitation[];
  /** How many memories were recalled, per namespace, so the UI can show the agent's reach. */
  recalled: Record<string, number>;
  source: 'llm' | 'fallback';
};

const ASK_SYSTEM = `You are Ghostwriter's underwriting agent, answering a question about your own book and your own memory.

You are given: your live book, and memories recalled from Walrus for this question. Each memory has an id.

Rules:
- Answer ONLY from the book facts and the recalled memories. Never use outside knowledge about crypto, prices or insurance.
- If the memories do not answer the question, say plainly that you have no memory of it. Do not guess.
- Cite the memories you used by their id, in brackets, like [X0EYnlVP].
- Speak as the underwriter, in the first person: "I priced", "I declined", "I hold".
- At most 110 words. Plain English, no markdown, no headings.
- Amounts are in gUSD. Never give financial advice.
- When "lookingAt" is present the user is asking about that quote; treat its numbers as given.`;

/** Namespaces the underwriter owns, searched for every question. */
const OWN = [C.NS.cases, C.NS.rules, C.NS.decisions, C.NS.policies] as const;

const strip = (t: string) => {
  for (const p of Object.values(C.PREFIX)) if (t.startsWith(p)) return t.slice(p.length);
  return t.replace(/^GHOSTWRITER_[A-Z]+_V1 /, '');
};

export async function askUnderwriter(
  question: string,
  history: AskTurn[],
  askerAddress: string | null,
  /** What the asker is looking at, e.g. the quote on screen, so "this" has a referent. */
  context?: string,
): Promise<AskResult> {
  const p = await pool();
  const counts = db.prepare(
    `SELECT SUM(status IN ('active','breach')) AS live, SUM(status='paid') AS paid, SUM(status='expired') AS expired FROM policies`,
  ).get() as { live: number | null; paid: number | null; expired: number | null };

  const recalled: Record<string, number> = {};
  const citations: AskCitation[] = [];
  const snippets: Array<{ id: string; namespace: string; text: string }> = [];

  // One recall per namespace, using the question as the query. Failures are per-namespace so a
  // relayer hiccup degrades the answer instead of breaking it.
  await Promise.all(
    OWN.map(async (ns) => {
      try {
        const hits = await recall(underwriter, ns, question, 4);
        recalled[ns] = hits.length;
        for (const h of hits) {
          const text = strip(h.text).slice(0, 320);
          snippets.push({ id: h.blobId.slice(0, 8), namespace: ns, text });
          if (citations.length < 6) {
            citations.push({ namespace: ns, blobId: h.blobId, summary: text.slice(0, 140), distance: h.distance });
          }
        }
      } catch (e) {
        recalled[ns] = 0;
        log.warn('ask: recall failed', { namespace: ns, message: (e as Error).message });
      }
    }),
  );

  // The asker's own history, when they are registered. Their memories belong to them, so this is
  // only read for the person who owns it.
  let borrower: unknown = null;
  if (askerAddress && getBorrower(askerAddress)) {
    const b = getBorrower(askerAddress)!;
    try {
      const hits = await recall(underwriter, C.NS.history, question, 3);
      recalled[C.NS.history] = hits.length;
      for (const h of hits) snippets.push({ id: h.blobId.slice(0, 8), namespace: C.NS.history, text: strip(h.text).slice(0, 240) });
      borrower = { address: askerAddress, memwalAccountId: b.memwal_account_id, registered: true };
    } catch {
      borrower = { address: askerAddress, registered: true };
    }
  }

  const facts = {
    currency: 'gUSD',
    question,
    // Facts about what the user is looking at. Still only facts — the agent may quote them.
    lookingAt: context ?? null,
    conversation: history.slice(-6).map((t) => `${t.role}: ${t.text}`),
    book: {
      vault: Number(p.vault) / 10 ** env.COIN_DECIMALS,
      free: Number(p.free) / 10 ** env.COIN_DECIMALS,
      locked: Number(p.locked) / 10 ** env.COIN_DECIMALS,
      premiumsCollected: Number(p.premiumsCollected) / 10 ** env.COIN_DECIMALS,
      payoutsMade: Number(p.payoutsMade) / 10 ** env.COIN_DECIMALS,
      lossRatio: p.premiumsCollected > 0n ? Number((Number(p.payoutsMade) / Number(p.premiumsCollected)).toFixed(2)) : 0,
      activePolicies: counts.live ?? 0, paidPolicies: counts.paid ?? 0, expiredPolicies: counts.expired ?? 0,
      paused: p.paused,
    },
    borrower,
    memories: snippets,
  };

  const text = await complete(ASK_SYSTEM, facts, 600);
  if (text) return { answer: text, citations, recalled, source: 'llm' };

  // The model is down. Say what was recalled rather than inventing an answer.
  const total = snippets.length;
  return {
    source: 'fallback',
    answer: total
      ? `I can't reach my language model, but I recalled ${total} memories for that question across ${Object.keys(recalled).length} namespaces. The closest is: ${snippets[0].text.slice(0, 160)}`
      : 'I have no memory that answers that, and I cannot reach my language model to say more.',
    citations,
    recalled,
  };
}
