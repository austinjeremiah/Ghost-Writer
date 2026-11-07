// lib/api.ts
import type {
  Health, Config, Market, BorrowerDTO, HistoryDTO, Positions, QuoteInput, QuoteDTO, QuoteStatus,
  PolicyDTO, PolicyStatus, Book, UnderwriterMemory, UnderwriterNamespace, MemoryWrites, Proof, PaymentRequired,
} from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

/** Backend error body: { error: { code, message, details } } (backend §5.1). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    // Only send content-type when there is a body, so plain GETs stay simple requests.
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.ok) return (await res.json()) as T;
  let err: { code?: string; message?: string; details?: Record<string, unknown> } | undefined;
  try { err = ((await res.json()) as { error?: typeof err }).error; } catch { /* non-JSON body */ }
  throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `HTTP ${res.status}`, err?.details ?? {});
}

const enc = encodeURIComponent;

export const api = {
  health: () => call<Health>('/v1/health'),
  config: () => call<Config>('/v1/config'),
  market: () => call<Market>('/v1/market'),

  registerBorrower: (address: string, memwalAccountId: string) =>
    call<BorrowerDTO>(`/v1/borrowers/${enc(address)}`, { method: 'PUT', body: { memwalAccountId } }),
  borrower: (address: string) => call<BorrowerDTO>(`/v1/borrowers/${enc(address)}`),
  history: (address: string) => call<HistoryDTO>(`/v1/borrowers/${enc(address)}/history`),
  positions: (address: string) => call<Positions>(`/v1/borrowers/${enc(address)}/positions`),

  quote: (input: QuoteInput) => call<QuoteDTO>('/v1/quotes', { method: 'POST', body: input }),
  getQuote: (id: string) => call<QuoteDTO & { status: QuoteStatus }>(`/v1/quotes/${enc(id)}`),

  confirmPolicy: (digest: string, quoteId: string) =>
    call<PolicyDTO>('/v1/policies/confirm', { method: 'POST', body: { digest, quoteId } }),
  policies: (q: { holder?: string; status?: PolicyStatus } = {}) => {
    const p = new URLSearchParams();
    if (q.holder) p.set('holder', q.holder);
    if (q.status) p.set('status', q.status);
    const qs = p.toString();
    return call<{ policies: PolicyDTO[] }>(`/v1/policies${qs ? `?${qs}` : ''}`);
  },
  policy: (id: string) => call<PolicyDTO>(`/v1/policies/${enc(id)}`),
  claimLiquidation: (id: string, txDigest: string) =>
    call<{ status: 'paid'; settleDigest: string }>(`/v1/policies/${enc(id)}/claim-liquidation`, { method: 'POST', body: { txDigest } }),

  book: () => call<Book>('/v1/underwriter/book'),
  underwriterMemory: (namespace: UnderwriterNamespace, limit = 20) =>
    call<UnderwriterMemory>(`/v1/underwriter/memory?namespace=${namespace}&limit=${limit}`),
  memoryWrites: (limit = 50) => call<MemoryWrites>(`/v1/memory/writes?limit=${limit}`),
  proof: () => call<Proof>('/v1/proof'),

  /** x402 step 1 only: ask for a price without paying. The backend answers 402 with the payment terms. */
  agentPaymentRequired: async (input: QuoteInput): Promise<PaymentRequired> => {
    const res = await fetch(`${API_URL}/v1/agent/cover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    if (res.status === 402) return (await res.json()) as PaymentRequired;
    let err: { code?: string; message?: string } | undefined;
    try { err = ((await res.json()) as { error?: typeof err }).error; } catch { /* ignore */ }
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `expected 402, got ${res.status}`);
  },
};
