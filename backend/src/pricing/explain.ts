// Natural-language explanations via Vultr inference (OpenAI-compatible API).
//
// The model NEVER decides a price. Every number is computed in pricing/quote.ts and passed in as
// facts; the model only puts them into a sentence. That also makes memory text safe to include:
// a malicious memory can influence wording, never a premium or a payout.
import OpenAI from 'openai';
import { env } from '../config.js';
import { log } from '../log.js';

const client = new OpenAI({ apiKey: env.VULTR_INFERENCE_API_KEY, baseURL: env.VULTR_INFERENCE_BASE_URL });

const QUOTE_SYSTEM = `You explain an insurance quote to a crypto borrower in at most 90 words.
Use only the facts provided; never invent numbers. Name each memory that changed the price by its short id (first 8 characters) and say whether it raised or lowered the price, and why — quote the hit rate from its summary when there is one.
Amounts are denominated in the value of the "currency" field. Use that name exactly; never write USD, USDC or dollars.
Do not give financial advice. Plain English, no headings, no markdown.`;

const LESSON_SYSTEM = `You write a one-sentence underwriting lesson (max 30 words) from a loss on a liquidation-protection policy.
Use only the facts provided. Start with the bucket, for example "SUI, high vol, 10-15% below spot:".`;

/**
 * The configured model is a reasoning model: left alone it spends the whole token budget on hidden
 * thinking and returns `finish_reason: "length"` with an empty message. `reasoning_effort: 'none'`
 * turns that off (confirmed against the endpoint: 0 reasoning tokens, answer in ~6). The generous
 * budget and the <think> stripping below stay as belt and braces for a model that ignores the flag.
 */
export async function complete(system: string, facts: unknown, maxTokens: number): Promise<string | null> {
  try {
    const r = await client.chat.completions.create(
      {
        model: env.VULTR_INFERENCE_MODEL,
        max_tokens: maxTokens,
        temperature: 0.3,
        reasoning_effort: 'none',
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(facts) }],
      },
      { timeout: 20_000 },
    );
    const raw = r.choices[0]?.message?.content ?? '';
    // An unclosed <think> means the budget ran out mid-thought: nothing usable follows it.
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<\/?think>\s*/i, '').trim();
    if (!text) log.warn('llm returned no text after stripping reasoning', { finish: r.choices[0]?.finish_reason });
    return text || null;
  } catch (e) {
    log.warn('llm failed; using deterministic fallback', { message: (e as Error).message });
    return null;
  }
}

export type ExplainResult = { text: string; source: 'llm' | 'fallback' };

export async function explainQuote(facts: Record<string, unknown>): Promise<ExplainResult> {
  const t = await complete(QUOTE_SYSTEM, facts, 800);
  if (t) return { text: t, source: 'llm' };
  const f = facts as { probability: number; multiplier: number; factors: Record<string, number> };
  return {
    source: 'fallback',
    text: `Model probability ${(f.probability * 100).toFixed(1)}%. Memory multiplier ×${f.multiplier.toFixed(2)} `
      + `(cases ×${f.factors.cases.toFixed(2)}, rules ×${f.factors.rules.toFixed(2)}, your history ×${f.factors.borrower.toFixed(2)}).`,
  };
}

export async function writeLesson(facts: Record<string, unknown>): Promise<string> {
  const t = await complete(LESSON_SYSTEM, facts, 300);
  const f = facts as { asset: string; volBucket: string; moneyBucket: string };
  return t ?? `${f.asset}, ${f.volBucket} vol, ${f.moneyBucket}% below spot: a covered drop happened; price this bucket higher.`;
}
