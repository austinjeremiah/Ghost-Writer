// lib/errors.ts
import { ApiError } from './api';

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
 * Best-effort: wallet and RPC error strings differ by wallet, so we look for "abort … <code>" and map it.
 * If nothing matches, show the raw message. Never hide it.
 */
export function abortFromMessage(msg: string): number | null {
  const m = /abort[^\d]{0,80}?(\d{1,2})\b/i.exec(msg);
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
      case 'QUOTE_EXPIRED': return 'This quote expired. Get a new quote.';
      case 'RATE_LIMITED': return 'The data provider is busy. Wait a few seconds and try again.';
      case 'UPSTREAM_TATUM': return `Chain data is unavailable right now (${e.message}).`;
      case 'UPSTREAM_MEMWAL': return `Walrus Memory is unavailable right now (${e.message}).`;
      case 'UPSTREAM_ENCLAVE': return 'The liquidation checker is offline. Try again later.';
      default: return e.message;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return 'You cancelled the request in your wallet.';
  const code = abortFromMessage(msg);
  return code ? ABORTS[code] : msg;
}
