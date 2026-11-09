// lib/errors.ts
import { API_URL, ApiError } from './api';

/** Move abort codes, backend §5.6. */
export const ABORTS: Record<number, string> = {
  1: 'Ghostwriter is paused right now.',
  2: 'This quote expired. Get a new quote.',
  3: 'The quote signature did not match. Get a new quote.',
  4: 'This quote was already used.',
  5: 'Payment is lower than the premium.',
  6: 'The vault does not have enough free capacity for this cover. Try a smaller payout.',
  7: 'This policy is not active.',
  8: 'Wrong policy type for this action.',
  9: 'Outside the cover window.',
  10: 'Wrong price feed.',
  11: 'The price is too uncertain right now. Try again shortly.',
  12: 'The price is not below the trigger.',
  13: 'A breach is already being confirmed.',
  14: 'There is no breach to confirm.',
  15: 'Too early to confirm the breach.',
  16: 'The liquidation proof was not accepted.',
  17: 'Wrong pool.',
  18: 'The liquidation checker key is out of date.',
  19: 'Not expired yet.',
  20: 'Record sequence mismatch.',
  21: 'Invalid parameters.',
  22: 'Price feed returned a negative price.',
  23: 'Not enough free funds in the vault.',
  24: 'Price is above the trigger.',
};

/**
 * Pull a Move abort code out of a wallet or RPC error string.
 *
 * This has to be strict. An earlier version matched /abort[^\d]{0,80}?(\d{1,2})\b/, i.e. the word
 * "abort" followed by any digit within 80 characters — so a wallet `AbortError` that happened to
 * contain a number was reported to the user as a Move abort. A failed Mainnet signature during
 * onboarding surfaced as "The quote signature did not match", which is abort 3 and has nothing to
 * do with onboarding. Masking the real error is worse than showing an ugly one.
 *
 * Sui reports aborts in two shapes, and only these two count:
 *   MoveAbort(MoveLocation { module: …, function: 7, … }, 3) in command 0
 *   … abort code: 3
 * Note the `function: 7` inside the first — a loose pattern picks that up instead of the code.
 */
export function abortFromMessage(msg: string): number | null {
  const m =
    /MoveAbort\([\s\S]*?,\s*(\d{1,3})\s*\)/.exec(msg) ??
    /abort\s*code[^\d]{0,4}(\d{1,3})/i.exec(msg);
  const code = m ? Number(m[1]) : NaN;
  return Number.isInteger(code) && ABORTS[code] ? code : null;
}

export function userMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'CHAIN_ABORT') {
      const code = Number((e.details.abort as { code?: number } | undefined)?.code);
      if (ABORTS[code]) return ABORTS[code];
    }
    switch (e.code) {
      // The underwriter's own words are the message; the UI shows the counter-offers alongside.
      case 'UNDERWRITING_DECLINED': return e.message;
      case 'QUOTE_EXPIRED': return 'This quote expired. Get a new quote.';
      case 'RATE_LIMITED': return 'The data provider is busy. Wait a few seconds and try again.';
      case 'UPSTREAM_TATUM': return `Chain data is unavailable right now (${e.message}).`;
      case 'UPSTREAM_MEMWAL': return `Walrus Memory is unavailable right now (${e.message}).`;
      case 'UPSTREAM_ENCLAVE': return 'The liquidation checker is offline. Try again later.';
      default: return e.message;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  // fetch() rejects with a TypeError when the backend is down or CORS blocks it.
  if (e instanceof TypeError && /fetch|network|load failed/i.test(msg)) return `Can't reach the Ghostwriter backend at ${API_URL}.`;
  if (/reject|denied|cancel/i.test(msg)) return 'You cancelled the request in your wallet.';
  const code = abortFromMessage(msg);
  return code ? ABORTS[code] : msg;
}
