export type ErrorCode =
  | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'QUOTE_EXPIRED' | 'RATE_LIMITED'
  | 'CHAIN_ABORT' | 'UPSTREAM_TATUM' | 'UPSTREAM_MEMWAL' | 'UPSTREAM_ENCLAVE' | 'UPSTREAM_LLM' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, CONFLICT: 409, QUOTE_EXPIRED: 410,
  RATE_LIMITED: 429, CHAIN_ABORT: 422, UPSTREAM_TATUM: 502, UPSTREAM_MEMWAL: 502,
  UPSTREAM_ENCLAVE: 502, UPSTREAM_LLM: 502, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
  toBody() { return { error: { code: this.code, message: this.message, details: this.details } }; }
}

const ABORT_NAMES: Record<number, string> = {
  1: 'EPaused', 2: 'EQuoteExpired', 3: 'EBadQuoteSig', 4: 'EQuoteUsed', 5: 'EInsufficientPayment',
  6: 'EInsufficientCapacity', 7: 'ENotActive', 8: 'EWrongKind', 9: 'EOutsideWindow', 10: 'EWrongFeed',
  11: 'EPriceTooUncertain', 12: 'ENotBreached', 13: 'EBreachAlreadyReported', 14: 'ENoBreach',
  15: 'ETooEarly', 16: 'EBadAttestation', 17: 'EWrongPool', 18: 'EStaleEnclave', 19: 'ENotExpired',
  20: 'EBadSeq', 21: 'EBadParams', 22: 'ENegativePrice', 23: 'EInsufficientFree', 24: 'EPriceAbove',
};

/** Turns a Move abort message into a CHAIN_ABORT with a readable name when it is ours. */
export function chainAbort(message: string): AppError {
  const m = /ghostwriter[^,]*,\s*(\d+)\)|abort code:\s*(\d+)|MoveAbort.*?(\d+)\)?\s*$/i.exec(message);
  const code = m ? Number(m[1] ?? m[2] ?? m[3]) : null;
  return new AppError('CHAIN_ABORT', message, { abort: code === null ? null : { code, name: ABORT_NAMES[code] ?? 'unknown' } });
}
