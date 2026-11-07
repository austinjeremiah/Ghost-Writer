# Ghostwriter — Frontend Build Doc

> Pages, what goes inside each one, and how each piece is wired to the backend.
> Styling, fonts and visual design come from **your Next.js template**. This doc only says *what* goes on the screen and *where its data comes from*.
>
> Source of truth for every request and event: **GHOSTWRITER_BACKEND.md §5 (ICD)**. If this doc and the ICD ever disagree, the ICD wins.

---

## 0. Read this first

### 0.1 Rules
- **Nothing is mock.** Every number, address, price and record on screen comes from the backend API, the SSE stream, or the chain. No placeholder data, no fake loading delays. If data is missing, show the empty state described for that page.
- **No secrets in the frontend.** The only frontend env var is `NEXT_PUBLIC_API_URL`. Everything else (package IDs, pool ID, feed IDs, the Ghostwriter delegate *public* key) comes from `GET /v1/config`. Tatum, Pyth, OpenAI and Walrus Memory keys stay on the backend.
- **Two networks, always visible.** Policies and money are on **Sui Testnet**. Walrus Memory is on **Sui Mainnet**. Every transaction button says which network it signs on.
- **The wallet signs; the backend never holds user keys.** The user signs (a) the buy transaction on Testnet, and (b) the Walrus Memory account and delegate-key transactions on Mainnet.
- Build pages in the order of §6. Each page ends with a **Done when** list. Do not move on until it passes against the real backend.

### 0.2 Versions (checked on npm, 7 Nov 2026)

| Package | Version | Why |
|---|---|---|
| `next` | your template's version (latest is 16.4.5) | App Router assumed. If the template uses the Pages Router, the page contents are the same; only file names change |
| `react` | your template's (latest 19.3.1) | |
| `@mysten/dapp-kit-react` | `^2.1.45` | Mysten's current wallet kit for React. The old `@mysten/dapp-kit` is JSON-RPC only and "will not receive further updates" (Mysten docs) |
| `@mysten/sui` | `^2.39.1` | Required by `@mysten/dapp-kit-core` and `@mysten/seal` |
| `@mysten-incubation/memwal` | `0.1.13` exact | Same version as the backend. We use only its `/account` entry (`createAccount`, `addDelegateKey`, `removeDelegateKey`) |
| `@mysten/seal` | `^1.5.4` | A **required** peer of `@mysten-incubation/memwal` (only `ai`, `zod`, `@mysten/walrus` are optional) |
| `@tanstack/react-query` | `^5.107.1` | Fetching, caching, and refetching when SSE events arrive |
| `lucide-react` | `^1.70.0` | Icons. Names in this doc were checked against 1.70.0; some old names were renamed (e.g. `AlertTriangle` → `TriangleExclamationPoint`) |

All code in §3 was type-checked (`tsc --strict`) against exactly these versions on 7 Nov 2026.

```bash
pnpm add @mysten/dapp-kit-react@^2.1.45 @mysten/sui@^2.39.1 @mysten-incubation/memwal@0.1.13 @mysten/seal@^1.5.4 @tanstack/react-query@^5.107.1 lucide-react@^1.70.0
```

### 0.3 Setup with the backend
- `frontend/.env.local` (never commit):
  ```
  NEXT_PUBLIC_API_URL=http://localhost:8787
  ```
- Backend `.env`: `CORS_ORIGINS=http://localhost:3000` (already the default in the backend doc). Without this, every browser call fails with a CORS error.
- Start order: backend `pnpm dev`, then frontend `pnpm dev`, then open `http://localhost:3000`.

### 0.4 What the user needs in their wallet (Slush or any Sui wallet)
| For | Network | Coin |
|---|---|---|
| Creating the Walrus Memory account and adding the Ghostwriter key | Mainnet | a little SUI for gas |
| Buying cover | Testnet | testnet SUI for gas + DUSDC for the premium |
| Revoking the Ghostwriter key | Mainnet | a little SUI for gas |

DUSDC (Testnet) comes from the DeepBook Predict Testnet form `https://tally.so/r/Xx102L` (same link as backend P0). Show it on the cover page when the balance is too low.

---

## 1. Folder layout (App Router)

```
frontend/
├── .env.local                     # NEXT_PUBLIC_API_URL only
├── app/
│   ├── layout.tsx                 # server component: html/body, imports <ClientRoot>
│   ├── client-root.tsx            # 'use client': loads Providers with ssr:false
│   ├── providers.tsx              # 'use client': QueryClient + DAppKit + Events
│   ├── page.tsx                   # 6.1 Home
│   ├── onboard/page.tsx           # 6.2 Set up memory
│   ├── cover/page.tsx             # 6.3 Get cover
│   ├── policies/page.tsx          # 6.4 My policies
│   ├── policies/[id]/page.tsx     # 6.5 Policy detail
│   ├── memory/page.tsx            # 6.6 My memory
│   ├── underwriter/page.tsx       # 6.7 Underwriter
│   ├── agents/page.tsx            # 6.8 Agent payments (x402)
│   └── proof/page.tsx             # 6.9 Proof (for judges)
├── components/
│   ├── shell/{AppShell,Sidebar,TopBar,HealthBanner,LiveDot}.tsx
│   ├── common/{Amount,Address,TxLink,BlobLink,Countdown,StatusBadge,StepList,EmptyState,ErrorState,CopyButton}.tsx
│   └── (page-specific components live next to each page)
├── lib/
│   ├── types.ts                   # ICD types (copy of backend §5)
│   ├── api.ts                     # one function per endpoint
│   ├── format.ts                  # units, prices, addresses, time, explorer links
│   ├── errors.ts                  # error code + Move abort → user message
│   ├── dapp-kit.ts                # wallet kit instance (testnet + mainnet)
│   ├── events.tsx                 # SSE provider + hooks
│   ├── memwal.ts                  # browser-side Walrus Memory account steps (Mainnet)
│   └── buy.ts                     # buy transaction (Testnet) + confirm
└── hooks/
    ├── queries.ts                 # react-query hooks per endpoint
    └── useBorrower.ts             # onboarding status for the connected wallet
```

> Every file that uses wallet hooks, `EventSource`, or `localStorage` must be a client component (`'use client'`), and the provider tree is loaded with `ssr: false`. Wallets are detected through `window`, so this cannot run on the server (dApp Kit Next.js guide).

---

## 2. Sitemap and navigation

### 2.1 Left sidebar (in this order)

| Label | Route | Icon (`lucide-react`) | Shown when |
|---|---|---|---|
| Home | `/` | `LayoutDashboard` | always |
| Get cover | `/cover` | `ShieldPlus` | always |
| My policies | `/policies` | `ListChecks` | always (asks to connect if no wallet) |
| My memory | `/memory` | `Brain` | always (sends to `/onboard` if not registered) |
| Underwriter | `/underwriter` | `Landmark` | always |
| Agents | `/agents` | `Bot` | always |
| Proof | `/proof` | `Receipt` | always (bottom of sidebar) |

Sidebar bottom: the onboarding nudge **"Set up your memory"** (icon `KeyRound`) linking to `/onboard`, shown only while `useBorrower().status === 'not_registered'`.

### 2.2 Route guards

| Route | Wallet needed | Must be registered | Signs on |
|---|---|---|---|
| `/` | no | no | — |
| `/onboard` | yes | — | Mainnet |
| `/cover` | yes to buy (quote form works without) | only for **liquidation** cover | Testnet |
| `/policies`, `/policies/[id]` | yes (list); detail works by id | no | — |
| `/memory` | yes | yes | Mainnet (revoke only) |
| `/underwriter`, `/agents`, `/proof` | no | no | — |

A guard never redirects silently. It renders the page's empty state with one button (Connect wallet, or Set up memory).

---

## 3. Shared wiring (write these first)

### 3.1 `lib/types.ts` — the ICD, as TypeScript

Copy exactly. Field names and string enums must match the backend.

```ts
// lib/types.ts — mirrors GHOSTWRITER_BACKEND.md §5. Amounts are integer base-unit strings (DUSDC = 6 decimals).
export type PolicyKind = 'price' | 'liquidation';
export type Asset = 'SUI' | 'BTC';
export type QuoteStatus = 'issued' | 'used' | 'expired';
export type PolicyStatus = 'active' | 'breach' | 'paid' | 'expired';
export type MemoryWriteStatus = 'queued' | 'writing' | 'done' | 'failed';
export type RecordKind = 'onboarded' | 'policy_bought' | 'warning' | 'response' | 'payout' | 'expired';
export type RuleStatus = 'trial' | 'active' | 'retired';
export type VolBucket = 'low' | 'mid' | 'high';

export type Health = {
  ok: true; version: string; uptimeS: number;
  workers: {
    priceWatcher: 'running' | 'stopped'; liquidationWatcher: 'running' | 'stopped';
    checkpointPulse: 'stream' | 'polling' | 'stopped'; memoryQueue: 'running' | 'stopped';
    hedger: 'disabled' | 'running';
  };
};

export type Config = {
  network: { policies: 'testnet'; memory: 'mainnet' };
  packageId: string; poolId: string; coinType: string; coinDecimals: 6; clockId: '0x6';
  feeds: { SUI: string; BTC: string };
  pool: { confirmDelayMs: number; maxConfBps: number; maxPriceAgeS: number; quotePubkeyHex: string; paused: boolean };
  memwal: {
    packageId: string; registryId: string; serverUrl: string;
    borrowerDelegatePublicKeyHex: string; borrowerDelegateLabel: 'Ghostwriter underwriter';
    underwriterAccountId: string; historyNamespace: 'ghostwriter-history';
  };
  recordPubkeyHex: string;
  enclave: { objectId: string; configId: string };
  limits: { payoutMin: string; payoutMax: string; durationDaysMin: number; durationDaysMax: number; quoteTtlMs: number };
  explorers: { testnetObject: string; testnetTx: string; mainnetObject: string; mainnetTx: string; walrusBlob: string };
};

export type MarketAsset = { asset: Asset; feedId: string; spotUsd: number; publishMs: number; volAnnual: number; volBucket: VolBucket };
export type Market = { assets: MarketAsset[] };

export type BorrowerDTO = {
  address: string; memwalAccountId: string; ledgerId: string | null;
  records: number; anchoredSeq: number;
  score: { verified: boolean; warnings: number; responses: number; payouts: number; discountFactor: number };
};

export type HistoryRecord = {
  seq: number; kind: RecordKind; at: number; data: Record<string, unknown>;
  evidence: string[]; hash: string; prev: string; blobId: string | null; sigValid: boolean;
};
export type HistoryDTO = {
  address: string; memwalAccountId: string; ledgerId: string;
  verification: { valid: boolean; reasons: string[]; recalled: number; indexed: number | null; anchoredSeq: number; anchoredHead: string; partial: boolean };
  records: HistoryRecord[];
};

export type Positions = { obligations: Array<{ obligationId: string; raw: unknown }>; note?: string };

export type QuoteInput = {
  buyer: string; kind: PolicyKind; asset: Asset; triggerPriceUsd: number; payoutUsdc: number;
  durationDays: number; obligationId?: string;
};
export type Citation = { namespace: string; blobId: string; kind: 'case' | 'rule' | 'record'; summary: string; distance?: number };
export type QuoteDTO = {
  quoteId: string; buyer: string; kind: PolicyKind; kindU8: 0 | 1; asset: Asset;
  feedId: string; strikeE8: string; obligationId: string;
  payout: string; premium: string; startMs: number; endMs: number; expiresMs: number;
  signatureHex: string;
  pricing: { spotUsd: number; volAnnual: number; probability: number; basePremium: string;
             multiplier: number; factors: { cases: number; rules: number; borrower: number } };
  citations: Citation[];
  explanation: string; explanationSource: 'openai' | 'fallback';
  moveCall: { target: string; typeArguments: [string]; argOrder: string[] };
};

export type PolicyDTO = {
  policyId: string; quoteId: string; holder: string; kind: PolicyKind; asset: Asset;
  feedId: string; strikeE8: string; obligationId: string; payout: string; premium: string;
  startMs: number; endMs: number; status: PolicyStatus; breachStartedMs: number;
  buyDigest: string | null; settleDigest: string | null; settlePath: 'price' | 'liquidation' | null;
  hedge: { status: 'none' | 'queued' | 'filled' | 'refunded' | 'failed'; detail?: string };
};

export type Rule = { ruleId: string; asset: Asset; volBucket: string; moneyBucket: string; multiplier: number;
                     status: RuleStatus; lesson: string; payouts: number; quietExpiries: number };
export type Book = {
  vault: string; locked: string; free: string; premiumsCollected: string; payoutsMade: string;
  lossRatio: number; activePolicies: number; rules: Rule[];
  multiplierHistory: Array<{ at: number; quoteId: string; multiplier: number }>;
};
export type UnderwriterNamespace = 'cases' | 'rules' | 'quotes' | 'policies';
export type UnderwriterMemory = {
  namespace: string; indexedCount: number;
  items: Array<{ blobId: string; createdAt: string | null; endEpoch: number | null; expiresAt: string | null; text: string | null }>;
};
export type MemoryWrites = {
  total: number; done: number;
  items: Array<{ id: number; account: 'underwriter' | string; namespace: string; purpose: string;
                 status: MemoryWriteStatus; blobId: string | null; error: string | null; createdAt: number }>;
};
export type Proof = { memwalAgentId: string; underwriterAccountId: string; mainnetMemories: number; lastBlobIds: string[];
                      packageId: string; poolId: string; enclaveObjectId: string };

/** x402 v2 "Payment Required" body (backend §5.7). */
export type PaymentRequired = {
  x402Version: 2; error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: Array<{ scheme: 'exact'; network: string; amount: string; asset: string; payTo: string;
                   maxTimeoutSeconds: number; extra: { quote: QuoteDTO; how: string } }>;
};

/** SSE payloads (backend §5.5). */
export type EventMap = {
  'chain.checkpoint': { network: 'testnet'; seq: string; at: number };
  'price.tick': { prices: Array<{ asset: Asset; spotUsd: number; publishMs: number }> };
  'quote.issued': { quoteId: string; buyer: string; premium: string; multiplier: number };
  'policy.bought': PolicyDTO;
  'breach.reported': { policyId: string; priceE8: string; digest: string };
  'breach.reset': { policyId: string; priceE8: string; digest: string };
  'policy.paid': { policyId: string; holder: string; payout: string; path: 'price' | 'liquidation'; digest: string };
  'policy.expired': { policyId: string; digest: string };
  'warning.issued': { policyId: string; borrower: string; spotUsd: number; strikeUsd: number };
  'liquidation.seen': { obligationId: string; txDigest: string; matchedPolicyId: string | null };
  'memory.queued': { id: number; account: string; namespace: string; purpose: string };
  'memory.written': { id: number; account: string; namespace: string; purpose: string; blobId: string };
  'memory.failed': { id: number; account: string; namespace: string; purpose: string; error: string };
  'ledger.anchored': { borrower: string; seq: number; head: string; digest: string };
  'rule.updated': { ruleId: string; multiplier: number; status: RuleStatus };
  'hedge.placed': { policyId: string; detail: unknown };
  'hedge.filled': { policyId: string; detail: unknown };
  'hedge.failed': { policyId: string; detail: unknown };
  'x402.settled': { quoteId: string; payer: string; digest: string; policyId: string };
};
export type EventType = keyof EventMap;
export const EVENT_TYPES = [
  'chain.checkpoint', 'price.tick', 'quote.issued', 'policy.bought', 'breach.reported', 'breach.reset',
  'policy.paid', 'policy.expired', 'warning.issued', 'liquidation.seen', 'memory.queued', 'memory.written',
  'memory.failed', 'ledger.anchored', 'rule.updated', 'hedge.placed', 'hedge.filled', 'hedge.failed', 'x402.settled',
] as const satisfies readonly EventType[];
```

### 3.2 `lib/api.ts` — one function per endpoint

```ts
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
```

### 3.3 `lib/format.ts` — units, prices, addresses, links

```ts
// lib/format.ts
import type { Config, RecordKind } from './types';

const DEC = 6; // DUSDC decimals (also in /v1/config.coinDecimals)

/** "1940000" → "1.94" */
export function fromBase(units: string, decimals = DEC, dp = 2): string {
  const n = BigInt(units);
  const whole = n / 10n ** BigInt(decimals);
  const frac = (n % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').slice(0, dp);
  return dp > 0 ? `${whole}.${frac}` : whole.toString();
}
/** strikeE8 "86000000" → 0.86 */
export const e8ToUsd = (e8: string) => Number(e8) / 1e8;
export const usd = (n: number, dp = n < 10 ? 4 : 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
export const shortId = (id: string, head = 6, tail = 4) => (id.length <= head + tail + 2 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`);

/** Distance from spot down to trigger, as a fraction. 0.037 = 3.7% above trigger. */
export const distanceToTrigger = (spotUsd: number, strikeUsd: number) => (spotUsd - strikeUsd) / spotUsd;

export function timeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const link = {
  testnetTx: (c: Config, d: string) => `${c.explorers.testnetTx}${d}`,
  testnetObject: (c: Config, id: string) => `${c.explorers.testnetObject}${id}`,
  mainnetTx: (c: Config, d: string) => `${c.explorers.mainnetTx}${d}`,
  mainnetObject: (c: Config, id: string) => `${c.explorers.mainnetObject}${id}`,
  blob: (c: Config, blobId: string) => `${c.explorers.walrusBlob}${blobId}`,
};

/**
 * Which chain a record's evidence digest lives on (from the backend's appendRecord calls):
 * 'response' carries a Mainnet Suilend deposit/repay digest; 'policy_bought', 'payout', 'expired' carry Testnet digests.
 */
export const evidenceNetwork = (kind: RecordKind): 'mainnet' | 'testnet' => (kind === 'response' ? 'mainnet' : 'testnet');
```

### 3.4 `lib/errors.ts` — what to tell the user

```ts
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
```

### 3.5 `lib/dapp-kit.ts` and the provider tree

```ts
// lib/dapp-kit.ts
import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

/**
 * Browser reads (coin lookup for the buy tx, DUSDC balance) use the public Mysten fullnodes.
 * The Tatum key is a backend secret, so Tatum is used server-side only (backend §1.4).
 */
const GRPC_URLS = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
} as const;

export const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'],
  defaultNetwork: 'testnet',            // buying happens on Testnet
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  storageKey: 'ghostwriter:wallet',
});

declare module '@mysten/dapp-kit-react' {
  interface Register { dAppKit: typeof dAppKit }
}
```

```tsx
// app/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { useState, type ReactNode } from 'react';
import { dAppKit } from '@/lib/dapp-kit';
import { EventsProvider } from '@/lib/events';
import { AppShell } from '@/components/shell/AppShell';

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <DAppKitProvider dAppKit={dAppKit}>
        <EventsProvider>
          <AppShell>{children}</AppShell>
        </EventsProvider>
      </DAppKitProvider>
    </QueryClientProvider>
  );
}
```

```tsx
// app/client-root.tsx
'use client';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

// `ssr: false` is only allowed inside a client component, so the server layout imports this file.
const Providers = dynamic(() => import('./providers'), { ssr: false, loading: () => null });

export function ClientRoot({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
```

```tsx
// app/layout.tsx  (server component; keep your template's <html>/<body>, fonts, globals)
import { ClientRoot } from './client-root';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ClientRoot>{children}</ClientRoot></body>
    </html>
  );
}
```

> Every page file below starts with `'use client';`. Pages render inside the client-only provider tree, so hooks are safe everywhere.

### 3.6 `lib/events.tsx` — one SSE connection for the whole app

What it does:
1. Opens **one** `EventSource` to `${API_URL}/v1/events` when the app loads.
2. Listens to every event type in `EVENT_TYPES`.
3. Keeps the last 200 events in memory (feeds on Underwriter and Agents pages read this).
4. Invalidates or updates react-query caches per the table in §7, so pages refresh themselves.
5. On a dropped connection the browser reconnects on its own and sends `Last-Event-ID`; the backend replays missed events (backend §5.5). Show the state with `LiveDot`.

```tsx
// lib/events.tsx
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from './api';
import { EVENT_TYPES, type EventMap, type EventType, type Market } from './types';
import { qk } from '@/hooks/queries';

export type AnyEvent = { [K in EventType]: { id: string; type: K; data: EventMap[K]; receivedAt: number } }[EventType];
type Listener = (e: AnyEvent) => void;
type Ctx = { status: 'connecting' | 'live' | 'reconnecting'; recent: AnyEvent[]; lastCheckpoint: EventMap['chain.checkpoint'] | null; subscribe: (l: Listener) => () => void };

const EventsCtx = createContext<Ctx | null>(null);
const MAX = 200;

export function EventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [status, setStatus] = useState<Ctx['status']>('connecting');
  const [recent, setRecent] = useState<AnyEvent[]>([]);
  const [lastCheckpoint, setLastCheckpoint] = useState<Ctx['lastCheckpoint']>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/v1/events`);
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus('reconnecting'); // EventSource retries by itself

    const onAny = (type: EventType) => (msg: MessageEvent<string>) => {
      let data: unknown;
      try { data = JSON.parse(msg.data); } catch { return; }
      const ev = { id: msg.lastEventId, type, data, receivedAt: Date.now() } as AnyEvent;
      applyToCache(qc, ev);
      if (ev.type === 'chain.checkpoint') setLastCheckpoint(ev.data);
      else setRecent((r) => [ev, ...r].slice(0, MAX));
      listeners.current.forEach((l) => l(ev));
    };
    const handlers = EVENT_TYPES.map((t) => [t, onAny(t)] as const);
    handlers.forEach(([t, h]) => es.addEventListener(t, h as EventListener));
    return () => { handlers.forEach(([t, h]) => es.removeEventListener(t, h as EventListener)); es.close(); };
  }, [qc]);

  const subscribe = (l: Listener) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; };
  return <EventsCtx.Provider value={{ status, recent, lastCheckpoint, subscribe }}>{children}</EventsCtx.Provider>;
}

export function useEvents() {
  const c = useContext(EventsCtx);
  if (!c) throw new Error('useEvents must be inside EventsProvider');
  return c;
}

/** Run `fn` for each new event of the given types (e.g. toasts, local chart buffers). */
export function useOnEvent<T extends EventType>(types: T[], fn: (e: Extract<AnyEvent, { type: T }>) => void) {
  const { subscribe } = useEvents();
  const ref = useRef(fn); ref.current = fn;
  const key = types.join(',');
  useEffect(() => subscribe((e) => { if ((types as EventType[]).includes(e.type)) ref.current(e as Extract<AnyEvent, { type: T }>); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribe, key]);
}

/** §7 of this doc, as code. */
function applyToCache(qc: ReturnType<typeof useQueryClient>, ev: AnyEvent) {
  switch (ev.type) {
    case 'price.tick':
      qc.setQueryData<Market>(qk.market, (m) => m && {
        assets: m.assets.map((a) => {
          const p = ev.data.prices.find((x) => x.asset === a.asset);
          return p ? { ...a, spotUsd: p.spotUsd, publishMs: p.publishMs } : a;
        }),
      });
      break;
    case 'policy.bought':
      qc.setQueryData(qk.policy(ev.data.policyId), ev.data);
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'breach.reported': case 'breach.reset': case 'policy.paid': case 'policy.expired':
    case 'hedge.placed': case 'hedge.filled': case 'hedge.failed':
      qc.invalidateQueries({ queryKey: qk.policy(ev.data.policyId) });
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      if (ev.type === 'policy.paid' || ev.type === 'policy.expired') qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'x402.settled':
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'rule.updated':
      qc.invalidateQueries({ queryKey: qk.book });
      qc.invalidateQueries({ queryKey: qk.uwMemory('rules') });
      break;
    case 'memory.queued': case 'memory.written': case 'memory.failed':
      qc.invalidateQueries({ queryKey: qk.memoryWrites });
      qc.invalidateQueries({ queryKey: qk.proof });
      if (ev.data.account === 'underwriter') qc.invalidateQueries({ queryKey: qk.uwMemoryRoot });
      else { qc.invalidateQueries({ queryKey: qk.history(ev.data.account) }); qc.invalidateQueries({ queryKey: qk.borrower(ev.data.account) }); }
      break;
    case 'ledger.anchored':
      qc.invalidateQueries({ queryKey: qk.history(ev.data.borrower) });
      qc.invalidateQueries({ queryKey: qk.borrower(ev.data.borrower) });
      break;
    default: break; // quote.issued, warning.issued, liquidation.seen: read from `recent` / useOnEvent
  }
}
```

> Address casing: the backend sends normalized `0x` + 64 lowercase hex (backend §5.1). Wallets may give a shorter form. Always pass addresses through `normalizeSuiAddress` from `@mysten/sui/utils` before comparing or using them as query keys (done in `useAddress` below).

### 3.7 `hooks/queries.ts` — data hooks

```ts
// hooks/queries.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { api } from '@/lib/api';
import type { PolicyStatus, UnderwriterNamespace } from '@/lib/types';

export const qk = {
  health: ['health'] as const,
  config: ['config'] as const,
  market: ['market'] as const,
  borrower: (a: string) => ['borrower', a] as const,
  history: (a: string) => ['history', a] as const,
  positions: (a: string) => ['positions', a] as const,
  policiesRoot: ['policies'] as const,
  policies: (holder?: string, status?: PolicyStatus) => ['policies', holder ?? '', status ?? ''] as const,
  policy: (id: string) => ['policy', id] as const,
  book: ['book'] as const,
  uwMemoryRoot: ['uwMemory'] as const,
  uwMemory: (ns: UnderwriterNamespace) => ['uwMemory', ns] as const,
  memoryWrites: ['memoryWrites'] as const,
  proof: ['proof'] as const,
};

/** Connected wallet address, normalized; null when disconnected. */
export function useAddress(): string | null {
  const acct = useCurrentAccount();
  return acct ? normalizeSuiAddress(acct.address) : null;
}

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, refetchInterval: 30_000 });
export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
export const useMarket = () => useQuery({ queryKey: qk.market, queryFn: api.market, refetchInterval: 60_000 }); // price.tick keeps spot fresh between refetches
export const useBorrowerQuery = (a: string | null) =>
  useQuery({ queryKey: qk.borrower(a ?? ''), queryFn: () => api.borrower(a!), enabled: !!a, retry: false });
export const useHistory = (a: string | null) =>
  useQuery({ queryKey: qk.history(a ?? ''), queryFn: () => api.history(a!), enabled: !!a, staleTime: 30_000 }); // backend caches 30 s
export const usePositions = (a: string | null) =>
  useQuery({ queryKey: qk.positions(a ?? ''), queryFn: () => api.positions(a!), enabled: !!a });
export const usePolicies = (holder?: string | null, status?: PolicyStatus) =>
  useQuery({ queryKey: qk.policies(holder ?? undefined, status), queryFn: () => api.policies({ holder: holder ?? undefined, status }), enabled: holder !== null });
export const usePolicy = (id: string) => useQuery({ queryKey: qk.policy(id), queryFn: () => api.policy(id) });
export const useBook = () => useQuery({ queryKey: qk.book, queryFn: api.book });
export const useUnderwriterMemory = (ns: UnderwriterNamespace) => useQuery({ queryKey: qk.uwMemory(ns), queryFn: () => api.underwriterMemory(ns) });
export const useMemoryWrites = () => useQuery({ queryKey: qk.memoryWrites, queryFn: () => api.memoryWrites(50) });
export const useProof = () => useQuery({ queryKey: qk.proof, queryFn: api.proof });
```

### 3.8 `hooks/useBorrower.ts` — is this wallet set up?

```ts
// hooks/useBorrower.ts
'use client';
import { ApiError } from '@/lib/api';
import { useAddress, useBorrowerQuery } from './queries';

export type BorrowerStatus = 'no_wallet' | 'loading' | 'not_registered' | 'registered' | 'error';

export function useBorrower() {
  const address = useAddress();
  const q = useBorrowerQuery(address);
  let status: BorrowerStatus;
  if (!address) status = 'no_wallet';
  else if (q.isPending) status = 'loading';
  else if (q.error instanceof ApiError && q.error.status === 404) status = 'not_registered';
  else if (q.error) status = 'error';
  else status = 'registered';
  return { address, status, borrower: q.data ?? null, error: q.error, refetch: q.refetch };
}
```

### 3.9 `lib/memwal.ts` — Walrus Memory account steps in the browser (Mainnet)

Facts this relies on (read from the published `@mysten-incubation/memwal@0.1.13` package):
- `createAccount({ packageId, registryId, walletSigner, suiClient?, suiNetwork? })` → `{ accountId, owner, digest }`. **One account per address** (enforced by the contract). The account is a **shared** object.
- `addDelegateKey({ packageId, registryId, accountId, publicKey, label, walletSigner, … })` → `{ digest, publicKey, suiAddress }`. Only the owner can add.
- `removeDelegateKey({ packageId, registryId, accountId, publicKey, walletSigner, … })` → `{ digest }`. "Forward-only": the key loses access to memories saved after removal; older ones stay readable by it.
- `walletSigner` = `{ address, signAndExecuteTransaction({ transaction }), signPersonalMessage({ message }) }`. The SDK accepts the v2 result shape `{ $kind: 'Transaction', Transaction: { digest } }`, then waits for the tx itself and throws if it failed on-chain.
- dApp Kit's `signAndExecuteTransaction` takes a `network` option, so we sign on **Mainnet** without switching the whole app away from Testnet.

```ts
// lib/memwal.ts
'use client';
import { createAccount, addDelegateKey, removeDelegateKey, type CreateAccountOpts } from '@mysten-incubation/memwal/account';
import { dAppKit } from './dapp-kit';
import type { Config } from './types';

type WalletSigner = NonNullable<CreateAccountOpts['walletSigner']>;

/** A memwal WalletSigner that always signs on Sui MAINNET with the connected wallet. */
function mainnetSigner(address: string): WalletSigner {
  return {
    address,
    signAndExecuteTransaction: async ({ transaction }) => {
      const r = await dAppKit.signAndExecuteTransaction({ transaction, network: 'mainnet' });
      return r.$kind === 'Transaction'
        ? { $kind: 'Transaction' as const, Transaction: { digest: r.Transaction.digest } }
        : { $kind: 'FailedTransaction' as const, FailedTransaction: { digest: r.FailedTransaction.digest } };
    },
    signPersonalMessage: async ({ message }) => ({ signature: (await dAppKit.signPersonalMessage({ message })).signature }),
  };
}

const base = (cfg: Config, address: string) => ({
  packageId: cfg.memwal.packageId,
  registryId: cfg.memwal.registryId,
  walletSigner: mainnetSigner(address),
  suiClient: dAppKit.getClient('mainnet'),
  suiNetwork: 'mainnet' as const,
});

export async function createMemoryAccount(cfg: Config, address: string) {
  const r = await createAccount(base(cfg, address));
  return r; // r.accountId may be '' if the SDK could not read it from effects → UI asks the user to paste it (see 6.2)
}

export async function addGhostwriterKey(cfg: Config, address: string, accountId: string) {
  return addDelegateKey({
    ...base(cfg, address), accountId,
    publicKey: cfg.memwal.borrowerDelegatePublicKeyHex,
    label: cfg.memwal.borrowerDelegateLabel,
  });
}

export async function revokeGhostwriterKey(cfg: Config, address: string, accountId: string) {
  return removeDelegateKey({ ...base(cfg, address), accountId, publicKey: cfg.memwal.borrowerDelegatePublicKeyHex });
}

/** Remember the account id per wallet so a reload mid-onboarding does not lose it. Browser-only convenience. */
const KEY = (a: string) => `ghostwriter:memwalAccount:${a}`;
export const savedAccountId = {
  get: (a: string) => { try { return localStorage.getItem(KEY(a)); } catch { return null; } },
  set: (a: string, id: string) => { try { localStorage.setItem(KEY(a), id); } catch { /* private mode */ } },
};
```

### 3.10 `lib/buy.ts` — the buy transaction (Testnet)

Same PTB as backend `scripts/agent-buyer.ts`, signed by the wallet. Argument order is `quote.moveCall.argOrder` and must match the Move `buy` signature (backend §5.6). `coinWithBalance` builds a DUSDC coin of exactly the premium from the user's coins.

```ts
// lib/buy.ts
'use client';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { dAppKit } from './dapp-kit';
import { api, ApiError } from './api';
import type { Config, PolicyDTO, QuoteDTO } from './types';

const bytes = (hex: string) => Array.from(fromHex(hex.replace(/^0x/, '')));

export function buildBuyTx(q: QuoteDTO, cfg: Config): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: q.moveCall.target,
    typeArguments: q.moveCall.typeArguments,
    arguments: [
      tx.object(cfg.poolId),                       // pool
      tx.pure.u8(q.kindU8),                        // kind
      tx.pure.vector('u8', bytes(q.feedId)),       // feedId (32 raw bytes)
      tx.pure.u64(q.strikeE8),                     // strikeE8
      tx.pure.address(q.obligationId),             // obligationId (0x0 for price cover)
      tx.pure.u64(q.payout),                       // payout
      tx.pure.u64(q.premium),                      // premium
      tx.pure.u64(q.startMs),                      // startMs
      tx.pure.u64(q.endMs),                        // endMs
      tx.pure.vector('u8', bytes(q.quoteId)),      // quoteId (16 raw bytes)
      tx.pure.u64(q.expiresMs),                    // expiresMs
      tx.pure.vector('u8', bytes(q.signatureHex)), // signature
      coinWithBalance({ type: cfg.coinType, balance: BigInt(q.premium) }), // payment: exactly the premium
      tx.object.clock(),                           // clock
    ],
  });
  return tx;
}

export type BuyStep = 'wallet' | 'confirming' | 'done';

/** Sign on Testnet, then tell the backend so it can index the policy and write the borrower record. */
export async function buyAndConfirm(q: QuoteDTO, cfg: Config, onStep: (s: BuyStep, digest?: string) => void): Promise<PolicyDTO> {
  onStep('wallet');
  const r = await dAppKit.signAndExecuteTransaction({ transaction: buildBuyTx(q, cfg), network: 'testnet' });
  if (r.$kind === 'FailedTransaction') {
    throw new Error(r.FailedTransaction.status.error?.message ?? 'Transaction failed on chain');
  }
  const digest = r.Transaction.digest;
  onStep('confirming', digest);
  // The tx is final, but the backend reads it through Tatum; retry briefly if it is not visible yet.
  for (let i = 0; ; i++) {
    try {
      const p = await api.confirmPolicy(digest, q.quoteId);
      onStep('done', digest);
      return p;
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status === 404 || e.status === 502);
      if (!retryable || i >= 4) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

/** DUSDC the connected wallet holds on Testnet (base units string). */
export async function dusdcBalance(cfg: Config, owner: string): Promise<string> {
  const { balance } = await dAppKit.getClient('testnet').getBalance({ owner, coinType: cfg.coinType });
  return balance.balance;
}
```

> If `confirmPolicy` still fails after the retries, the policy **is bought** (the digest proves it). Show the digest with a "Retry sync" button that calls `confirmPolicy` again. The backend also picks it up from chain events, so it will appear in My policies.

---

## 4. App shell (on every page)

### 4.1 Sidebar
Items from §2.1. Active item = current route. Collapsible to icons only if your template supports it.

### 4.2 Top bar (left → right)

| Element | Content | Data |
|---|---|---|
| Network pills | "Policies: Testnet" and "Memory: Mainnet" (icon `Network`) | `config.network` |
| Live dot | `LiveDot`: green "Live" when SSE is `live`; amber "Reconnecting" otherwise. Tooltip: "Testnet checkpoint #<seq>, <n>s ago" | `useEvents().status`, `lastCheckpoint` |
| SUI price | "SUI $0.893" (icon `Activity`) | `useMarket()` SUI row; updates on `price.tick` |
| DUSDC balance | "12.40 DUSDC" (icon `Coins`), only when connected | `dusdcBalance()` via react-query, key `['dusdc', address]`, refetch 30 s and after a buy |
| Wallet | `ConnectButton` from `@mysten/dapp-kit-react/ui` | dApp Kit |

### 4.3 Health banner
Above the page content, shown only when something is wrong. Poll `GET /v1/health` every 30 s.

| Condition | Message | Icon |
|---|---|---|
| health request fails | "Ghostwriter backend is not reachable at <API_URL>." | `Unplug` |
| `config.pool.paused` | "New cover is paused." | `Ban` |
| `workers.priceWatcher === 'stopped'` | "Price watching is stopped. Payouts are delayed." | `TriangleExclamationPoint` |
| `workers.checkpointPulse === 'polling'` | (no banner; LiveDot tooltip says "polling") | — |

### 4.4 Global toasts (only for the connected wallet)
Use `useOnEvent` in `AppShell`. Show a toast only if the event concerns the connected address or one of its policies (keep a `Set` of the user's policy ids from `usePolicies(address)`).

| Event | Toast | Icon | Action button |
|---|---|---|---|
| `warning.issued` with `borrower === address` | "SUI is within 5% of your trigger. Topping up now lowers your future price." | `TriangleExclamationPoint` | "View policy" → `/policies/<policyId>` |
| `breach.reported` (my policy) | "Price is below your trigger. Payout in <confirmDelay> if it stays there." | `Timer` | "Watch" → policy |
| `breach.reset` (my policy) | "Price recovered. Breach timer reset." | `RefreshCw` | — |
| `policy.paid` with `holder === address` | "<payout> DUSDC paid to your wallet." | `CircleCheck` | "View tx" → testnet tx |
| `ledger.anchored` with `borrower === address` | "Your record #<seq> is anchored on Sui." | `Hash` | "My memory" |
| `memory.failed` with `account === address` | "Saving a record to your memory failed: <error>. It will retry." | `CircleX` | — |

### 4.5 Shared components (props only; looks come from the template)

| Component | Props | Behaviour |
|---|---|---|
| `Amount` | `units: string`, `symbol='DUSDC'` | `fromBase(units)` + symbol |
| `Address` | `id: string`, `href?: string` | `shortId(id)` + `CopyButton` + optional `ExternalLink` icon link |
| `TxLink` | `digest`, `network: 'testnet'|'mainnet'` | link via `link.testnetTx/mainnetTx`, icon `ExternalLink` |
| `BlobLink` | `blobId` | link via `link.blob`, icon `Database` |
| `Countdown` | `to: number` (ms), `onDone?` | ticks every second with `timeLeft(to - Date.now())` |
| `StatusBadge` | `status: PolicyStatus` | active=`ShieldCheck`, breach=`Timer`, paid=`CircleCheck`, expired=`CircleX` |
| `StepList` | `steps: {label, state: 'todo'|'doing'|'done'|'error', detail?, link?}[]` | icons: todo=none, doing=`LoaderCircle` (spin), done=`CircleCheck`, error=`CircleX` |
| `EmptyState` | `icon`, `title`, `body`, `action?` | one sentence and one button |
| `ErrorState` | `error: unknown`, `onRetry?` | `userMessage(error)` + Retry (icon `RefreshCw`) |
| `CopyButton` | `value` | icon `Copy` → `CircleCheck` for 1.5 s |

---

## 5. How to read each page section

Every page below has the same parts:
- **Purpose**: one line.
- **Data**: which hooks/endpoints it reads, and which SSE events refresh it.
- **Layout**: the blocks on the page, top to bottom, with the components and icons inside each.
- **Actions**: what each button does, step by step, with the exact calls.
- **States**: loading, empty, and error behaviour.
- **Done when**: checks against the real backend.

---

## 6. Pages

### 6.1 Home — `/` (`app/page.tsx`)

**Purpose:** say what Ghostwriter is in one line, show that it is live, and send people to Get cover or Set up memory.

**Data**
| What | Source |
|---|---|
| Memories on Mainnet, latest blob ids | `useProof()` → `mainnetMemories`, `lastBlobIds` |
| Active policies, vault | `useBook()` → `activePolicies`, `vault`, `free` |
| SUI and BTC price | `useMarket()` (kept fresh by `price.tick`) |
| Onboarding state | `useBorrower()` |

**Layout**
1. **Hero**
   - Headline: "Liquidation cover priced by an underwriter that remembers."
   - One sentence: "Ghostwriter pays you automatically if SUI or BTC falls below your trigger, or if your Suilend position is liquidated. Its prices learn from every past outcome, stored on Walrus Memory."
   - Buttons: "Get cover" (`ShieldPlus`) → `/cover`. Second button depends on `useBorrower().status`: `not_registered` or `no_wallet` → "Set up my memory" (`KeyRound`) → `/onboard`; `registered` → "My memory" (`Brain`) → `/memory`.
2. **Live strip** (three figures, each with a small label underneath)
   - `<mainnetMemories>` "memories on Walrus Mainnet" (`Database`). Clicking it goes to `/proof`.
   - `<activePolicies>` "active policies" (`ShieldCheck`).
   - SUI `<spotUsd>` "SUI price from Pyth" (`Activity`).
3. **How it works** (this is a real sequence, so numbered steps are right)
   1. "Ask for cover" (`ShieldPlus`): pick a trigger, a payout and a length.
   2. "See why it costs that" (`Brain`): the price shows which past cases, rules and records changed it.
   3. "Buy in one transaction" (`Wallet`): your wallet pays the premium into the vault on Sui Testnet.
   4. "Get paid without a claim" (`CircleCheck`): a Pyth price check or a Nautilus-verified liquidation triggers the payout.
4. **Latest memory** (optional, small): the first 3 `lastBlobIds` as `BlobLink`s.

**Actions**: navigation only.

**States**
- Loading: show the layout with the three figures as "—". Never show 0 while loading.
- `useProof` or `useBook` error: hide only that figure and show a small `ErrorState` with Retry under the strip.

**Done when**
- With the backend running, the three figures match `GET /v1/proof`, `GET /v1/underwriter/book` and `GET /v1/market`.
- The SUI price changes on screen within one `PRICE_POLL_MS` (10 s) without a reload.

---

### 6.2 Set up memory — `/onboard` (`app/onboard/page.tsx`)

**Purpose:** create the user's own Walrus Memory account on **Mainnet**, add Ghostwriter's key so Ghostwriter can write the user's signed history, and register with the backend. This is the "borrower-owned memory" part of the pitch.

**Data**
| What | Source |
|---|---|
| Wallet address | `useAddress()` |
| Already registered? | `useBorrower()` (`GET /v1/borrowers/:address`, 404 = not yet) |
| Package/registry ids, Ghostwriter delegate public key and label | `useConfig().memwal` |
| Saved account id from a previous attempt | `savedAccountId.get(address)` |
| Live progress after registering | SSE `memory.queued` / `memory.written` (account = address), `ledger.anchored` (borrower = address) |

**Layout**
1. **Header**: "Set up your memory". Sub-line: "Your insurance history lives in your own Walrus Memory account on Sui Mainnet. You can remove Ghostwriter's access at any time."
2. **Network note** (icon `Info`): "These two steps sign on **Sui Mainnet** and need a little SUI for gas. Buying cover later happens on Testnet."
3. **Steps** (`StepList`, 4 rows):

| # | Label | Done when | Detail / link shown |
|---|---|---|---|
| 1 | Connect wallet | `address` not null | short address |
| 2 | Create your memory account | have `accountId` | Mainnet tx link (`link.mainnetTx`), account id (`Address` → `link.mainnetObject`) |
| 3 | Let Ghostwriter write your history | `addDelegateKey` succeeded | Mainnet tx link; label "Ghostwriter underwriter"; Ghostwriter key `shortId(borrowerDelegatePublicKeyHex)` |
| 4 | Register with Ghostwriter | `PUT /v1/borrowers` returned 200 | ledger id (`link.testnetObject`) |

4. **Primary button** under the steps. Its label changes with the current step: "Connect wallet" → "Create my memory account" → "Add Ghostwriter's key" → "Register" → (done) "Get cover".
5. **"I already have a memory account"** (link button, under step 2). Opens an input: "Paste your memory account ID (from memory.walrus.xyz)". Validate with `isValidSuiAddress` from `@mysten/sui/utils`. On save → `savedAccountId.set`, mark step 2 done.
6. **After success panel** (icon `CircleCheck`): "You're set up." Shows `BorrowerDTO.records` and `anchoredSeq`, plus a live line: "Writing your first record to Walrus… / Saved (blob <BlobLink>) / Anchored on Sui (tx)". Buttons: "Get cover" → `/cover`, "See my memory" → `/memory`.

**Actions**

*On page load*
1. If `useBorrower().status === 'registered'`: show only the success panel (all steps done).
2. Else, if `savedAccountId.get(address)` has a value, mark step 2 done with that id.

*Step 2: Create my memory account*
1. `const r = await createMemoryAccount(cfg, address)`.
2. If `r.accountId` is empty: show the paste input from block 5 with "Created (tx <link>). Paste the account ID from memory.walrus.xyz to continue." Do not guess an id.
3. Else `savedAccountId.set(address, r.accountId)`; step 2 done.
4. On error:
   - Wallet rejected → "You cancelled the request in your wallet." Stay on step 2.
   - Any other error from the contract: the user may already have an account (one per address). Show `userMessage(e)` and open the paste input.

*Step 3: Add Ghostwriter's key*
1. `await addGhostwriterKey(cfg, address, accountId)`.
2. On error: show `userMessage(e)`. If the message says the key already exists, treat step 3 as done (re-running on an account that already has the key is harmless to skip).

*Step 4: Register*
1. `await api.registerBorrower(address, accountId)`.
2. Handle the 409 reasons (backend §5.4 and the borrower route):

| `details.reason` | What happened | What to do |
|---|---|---|
| `DELEGATE_NOT_REGISTERED` | Walrus Memory has not seen the new key yet (its relayer caches checks for up to 30 s) | Show "Waiting for Walrus Memory to see the new key…" with `LoaderCircle`, retry after 5 s, then every 5 s up to 30 s total. Then show the error with a Retry button |
| `NOT_OWNER` | The account id belongs to a different wallet | "That memory account belongs to another wallet." Re-open the paste input |
| `ALREADY_REGISTERED` | This wallet is registered with a different account id | "This wallet is already registered with another memory account." Link to `/memory` |

3. On 200: `queryClient.setQueryData(qk.borrower(address), dto)`; show the success panel.

*Live progress in the success panel*
- `useOnEvent(['memory.queued','memory.written','memory.failed'], …)` filtered to `e.data.account === address`.
- `useOnEvent(['ledger.anchored'], …)` filtered to `e.data.borrower === address`.

**States**
- No wallet: steps visible, only step 1 actionable.
- `useConfig` loading: disable the primary button ("Loading settings…").
- Config error: `ErrorState`; nothing else works without it.

**Done when**
- A fresh wallet goes through steps 2–4. The Mainnet explorer shows a `MemWalAccount` created and a `add_delegate_key` call. `GET /v1/borrowers/<address>` returns `ledgerId` not null.
- Within a minute the success panel shows "Saved" with a real blob id and "Anchored".
- Reloading mid-flow (after step 2) keeps the account id.
- Running onboarding again with the same wallet shows the success panel straight away.

---

### 6.3 Get cover — `/cover` (`app/cover/page.tsx`)

**Purpose:** build a cover request, get a signed quote with its full price breakdown and the memories that changed it, then buy it with the wallet.

**Data**
| What | Source |
|---|---|
| Spot price and vol per asset | `useMarket()` |
| Limits, pool, coin | `useConfig()` (`limits`, `pool.paused`, `coinType`) |
| Onboarding (liquidation needs it) | `useBorrower()` |
| Suilend obligations (liquidation) | `usePositions(address)` → `GET /v1/borrowers/:address/positions` |
| DUSDC balance | `dusdcBalance(cfg, address)` |
| Quote | `api.quote(input)` (POST, not cached) |

**Layout: two columns on desktop (form left, quote right); stacked on mobile.**

**Left: the request form**
1. **Kind** (segmented control, 2 options)
   - "Price drop" (`TrendingDown`): pays if the price stays below your trigger.
   - "Liquidation" (`Landmark`): pays if your Suilend position is liquidated. Disabled with a "Set up memory first" link unless `useBorrower().status === 'registered'` (the backend returns 404 for unregistered liquidation quotes).
2. **Asset** (select): SUI, BTC. Under it: "Now <usd(spotUsd)>, volatility <pct(volAnnual)> a year (<volBucket>)".
3. **Obligation** (liquidation only)
   - If `positions.obligations.length > 0`: a select listing `shortId(obligationId)`.
   - Otherwise an input "Suilend obligation ID (Mainnet)" validated with `isValidSuiAddress`. If `positions.note` is present, show it as helper text.
4. **Trigger price** (number input, USD)
   - Quick buttons: "5% below", "10% below", "15% below", each setting `spotUsd × (1 − x)` rounded to 4 decimals.
   - Live hint: "<pct(distanceToTrigger(spot, trigger))> below today's price".
   - Validation: must be `> 0` and `< spotUsd` ("Trigger must be below today's price").
5. **Payout** (number input, DUSDC). Min/max from `config.limits.payoutMin/payoutMax` (base units → `fromBase`, i.e. 1–1000).
6. **Length** (number input, days, integer). `config.limits.durationDaysMin`–`durationDaysMax` (1–30).
7. **Price-cover rule line** (price kind only, icon `Timer`): "Pays if the price stays below the trigger for <confirmDelayMs as minutes> minutes at any time in the window." Use `config.pool.confirmDelayMs`.
8. **Button** "Get quote" (`Zap`). Disabled while invalid, while `config.pool.paused`, or while a quote request is running.

**Right: the quote (shown after "Get quote")**
1. **Price line**: big `fromBase(premium)` DUSDC, then "for <fromBase(payout)> DUSDC of cover". Next to it a `Countdown` to `expiresMs`: "Price held for 1:42". When it reaches 0: replace the Buy button with "Get a new quote" (`RefreshCw`).
2. **How the price is built** (one row of terms; each term has a small label under it)
   - `fromBase(pricing.basePremium)` "model price" × `pricing.factors.cases` "past cases" × `pricing.factors.rules` "learned rules" × `pricing.factors.borrower` "your history" = `fromBase(premium)` "your premium".
   - Colour/arrow per factor: `> 1` raised the price (`ArrowUpRight`), `< 1` lowered it (`ArrowDownRight`), `= 1` neutral.
   - Under the row: "Chance of payout ≈ <pct(probability)> · combined multiplier ×<multiplier.toFixed(2)>". Use your template's separator style; plain text is fine.
   - Note: `multiplier` is clamped by the backend to 0.6–3.0, so `basePremium × factors` may not equal the premium exactly. Show the backend's numbers as they are; never recompute the premium on the client.
3. **Why** (list of `citations`; this is the "memory visibly changes the price" moment)
   - Each row: icon by `kind` (`case` → `Database`, `rule` → `ScrollText`, `record` → `Brain`), the `summary`, `distance` if present ("similarity <(1 − distance).toFixed(2)>"), and `BlobLink` for `blobId` ("View memory").
   - Empty `citations`: "No past memory matched this request. The price is the model price."
4. **Explanation**: `explanation` text. Small tag: "Written by AI" when `explanationSource === 'openai'`, "Standard explanation" when `'fallback'`.
5. **Buy box**
   - Lines: "Pays <payout> DUSDC to <shortId(buyer)>", "Covers <date(startMs)> → <date(endMs)>", "Signs on Sui Testnet".
   - Balance check: if `BigInt(balance) < BigInt(premium)`: show "You have <fromBase(balance)> DUSDC. Get test DUSDC" linking to `https://tally.so/r/Xx102L`; disable Buy.
   - Button: "Buy cover for <fromBase(premium)> DUSDC" (`Wallet`). Disabled when not connected (show `ConnectButton` instead), expired, balance low, or paused.
   - While buying: `StepList` with "Approve in wallet" → "Recording your policy" → "Done", plus the Testnet `TxLink` once the digest is known.
6. **Not set up nudge** (price kind, not registered; icon `KeyRound`): "Set up your memory to build a history that lowers future prices." Link `/onboard`. Never block a price-cover purchase on this.

**Actions**

*Get quote*
1. Build `QuoteInput`:
   ```ts
   const input: QuoteInput = {
     buyer: address!,                       // must be connected to quote, since the quote is signed for this buyer
     kind, asset,
     triggerPriceUsd: Number(trigger),
     payoutUsdc: Number(payout),
     durationDays: Number(days),
     ...(kind === 'liquidation' ? { obligationId } : {}),
   };
   const q = await api.quote(input);
   ```
2. Keep `q` in component state (not react-query: each quote is single-use).
3. Errors → `userMessage(e)` under the button. 404 on liquidation → "Set up memory first" with link.

*Buy*
1. `const policy = await buyAndConfirm(q, cfg, setStep)`.
2. On success: invalidate `['dusdc', address]` and `qk.policiesRoot`, then `router.push('/policies/' + policy.policyId)`.
3. On error: `userMessage(e)`. If the wallet reported abort 2 or 4 (expired/used), clear the quote and ask for a new one.
4. If the tx succeeded but confirm failed (digest known, error thrown): show "Your cover is bought (tx <link>). We're still syncing it." with "Retry sync" → `api.confirmPolicy(digest, q.quoteId)`.

*Changing any form field* clears the current quote (it no longer matches the request).

**States**
- Market loading: form disabled with "Loading prices…".
- Market error: `ErrorState` (the quote needs spot price).
- Not connected: the form works, but "Get quote" says "Connect wallet to get a quote" and shows `ConnectButton`.

**Done when**
- A SUI price quote shows real `basePremium`, factors, at least one citation with a working Walruscan link (after `pnpm seed` on the backend), and an explanation.
- The countdown expires at `expiresMs` and Buy turns into "Get a new quote".
- Buying with enough DUSDC opens the wallet on **Testnet**, then lands on the new policy page; `GET /v1/policies/<id>` matches.
- With too little DUSDC, Buy is disabled and the DUSDC link shows.
- Liquidation kind is disabled for an unregistered wallet; enabled after onboarding.

---

### 6.4 My policies — `/policies` (`app/policies/page.tsx`)

**Purpose:** every policy the wallet holds, with live distance to trigger and status.

**Data**
| What | Source |
|---|---|
| Policies | `usePolicies(address)` → `GET /v1/policies?holder=<address>` (newest first, max 200) |
| Spot prices | `useMarket()` + `price.tick` |
| Refresh | SSE `policy.*`, `breach.*`, `hedge.*`, `x402.settled` (see §7) |

**Layout**
1. **Header**: "My policies" + button "Get cover" (`ShieldPlus`).
2. **Tabs**: Active (status `active` or `breach`), Paid, Expired, All. Each tab label has a count. Filter on the client from the one list.
3. **Table / list** (one row per policy; click → `/policies/<policyId>`)

| Column | Content |
|---|---|
| Cover | Kind icon (`TrendingDown` price / `Landmark` liquidation) + "SUI below $0.86" or "Suilend liquidation <shortId(obligationId)>" |
| Payout | `Amount units={payout}` |
| Now | price kind: `usd(spot)` and "<pct(distanceToTrigger(spot, e8ToUsd(strikeE8)))> above trigger"; liquidation: "Watching on Mainnet" (`Radio`) |
| Ends | `active`/`breach`: `timeLeft(endMs - now)`; else the date |
| Status | `StatusBadge`. For `breach`, add `Countdown` to `breachStartedMs + config.pool.confirmDelayMs` |
| Hedge | BTC only, when `hedge.status !== 'none'`: small badge `queued/filled/refunded/failed` |

4. **Breach row highlight**: a `breach` row sorts to the top of Active and shows "Payout in <countdown> if it stays below".

**States**
- No wallet: `EmptyState` (`Wallet`) "Connect your wallet to see your policies." + `ConnectButton`.
- Empty list: `EmptyState` (`ShieldPlus`) "No cover yet." + "Get cover".
- Error: `ErrorState`.

**Done when**
- After a purchase on `/cover`, the row appears without a reload (`policy.bought`).
- A `breach.reported` from the backend moves the row to the top with a running countdown; `policy.paid` turns it to Paid.

---

### 6.5 Policy detail — `/policies/[id]` (`app/policies/[id]/page.tsx`)

**Purpose:** one policy, live. For price cover: price against the trigger and the breach timer. For liquidation cover: the obligation being watched and the proof path.

**Data**
| What | Source |
|---|---|
| Policy | `usePolicy(id)` → `GET /v1/policies/:id` |
| Live price buffer (price cover) | `useOnEvent(['price.tick'])` → keep the last 360 points for this asset in component state (≈ 1 hour at 10 s) |
| Breach confirm delay | `config.pool.confirmDelayMs` |
| Events for this policy | `useEvents().recent` filtered by `policyId`, plus `liquidation.seen` filtered by `obligationId` |

> The backend has no price-history endpoint. The chart starts empty when the page opens and fills from `price.tick`. Say "Live since you opened this page" under it. Do not draw made-up history.

**Layout**
1. **Header**: cover title (as in the list), `StatusBadge`, holder `Address`, policy id `Address` → `link.testnetObject`.
2. **Key figures row**: Payout (`Amount`), Premium paid (`Amount`), Window `date(startMs) → date(endMs)`, Ends in (`Countdown` to `endMs` while active).
3. **Price cover only: Price vs trigger**
   - Line chart from the live buffer; horizontal line at `e8ToUsd(strikeE8)` labelled "Trigger <usd>"; the area below the line marked as the payout zone. Use your template's chart component, or a plain SVG polyline.
   - Next to it: "Now <usd(spot)>", "<pct(distance)> above trigger".
4. **Price cover only: Breach timer** (only while `status === 'breach'`)
   - Big `Countdown` to `breachStartedMs + confirmDelayMs` with "Pays <payout> DUSDC if the price stays below <trigger> until then." Icon `Timer`.
   - When the countdown reaches 0, show "Confirming on Sui…" (`LoaderCircle`) until `policy.paid` or `breach.reset` arrives. The confirm transaction is sent by the backend, not the user.
5. **Liquidation cover only: What we're watching**
   - "Suilend obligation <Address id={obligationId} href={link.mainnetObject(...)}> on Sui Mainnet" (`Radio`).
   - "If this obligation is liquidated before <date(endMs)>, a Nautilus enclave checks the Mainnet transaction and signs a proof. The contract verifies the signature and pays you." (`Cpu`)
   - **Seen liquidations**: list of `liquidation.seen` events whose `obligationId` matches: Mainnet `TxLink` and "matched this policy" / "not matched".
   - **Manual claim** (collapsed, for demo and retry): input "Mainnet transaction digest with the liquidation" (validate with `isValidTransactionDigest`), button "Check and claim" (`ShieldCheck`) → `api.claimLiquidation(id, digest)`. Results: 200 → "Paid" + `TxLink` testnet `settleDigest`; 409 → "This policy can't be claimed now (<message>)"; 422 → `userMessage(e)` (e.g. abort 16, proof not accepted); 502 → "The liquidation checker is offline."
6. **Timeline** (one list, oldest first; this is a real sequence)
   - "Bought" + `TxLink` testnet `buyDigest`.
   - Each `breach.reported` / `breach.reset` event for this policy seen since the page opened: price `usd(Number(priceE8)/1e8)` + `TxLink`.
   - Final state from the DTO: `paid` → "Paid by price check" or "Paid by liquidation proof" (from `settlePath`) + `TxLink` `settleDigest`; `expired` → "Expired" + `TxLink` `settleDigest` if present.
7. **Hedge** (BTC price cover, when `hedge.status !== 'none'`): "Partial hedge on DeepBook Predict: <status>". Show `hedge.detail` text as-is under it.
8. **Memory note** (icon `Brain`): "This outcome will be saved to the underwriter's memory and, if you're set up, to your own history." Link `/memory`.

**Actions**: manual claim only (liquidation). Everything else is live display.

**States**
- Loading: skeleton of header + figures.
- 404: `EmptyState` (`CircleQuestionMark`) "No policy with this ID." + "My policies".
- Error: `ErrorState`.

**Done when**
- For a price policy bought near spot (backend demo setup), the chart fills every 10 s, `breach.reported` shows the timer, and the page flips to Paid with a Testnet link when `policy.paid` arrives.
- For a liquidation policy, a manual claim with a real Mainnet liquidation digest for that obligation returns 200 and shows the settle tx, or shows the exact refusal message.

---

### 6.6 My memory — `/memory` (`app/memory/page.tsx`)

**Purpose:** show the user's own signed, hash-chained history on Walrus Mainnet, prove it's untampered, show how it changes their price, and let them revoke Ghostwriter's access.

**Data**
| What | Source |
|---|---|
| Registration + score | `useBorrower()` → `BorrowerDTO` (`score.discountFactor`, `warnings`, `responses`, `payouts`, `records`, `anchoredSeq`) |
| History + verification | `useHistory(address)` → `GET /v1/borrowers/:address/history` |
| Keys for "verify it yourself" | `useConfig()` → `recordPubkeyHex`, `memwal.borrowerDelegatePublicKeyHex`, `memwal.historyNamespace` |
| Refresh | SSE `memory.written` (account = address), `ledger.anchored` (borrower = address) |

**Layout**
1. **Verification banner** (top, full width)

| Condition | Text | Icon |
|---|---|---|
| `verification.valid && !partial` | "History verified. <records.length> records signed by Ghostwriter, chain unbroken, matches the anchor on Sui (record #<anchoredSeq>)." | `ShieldCheck` |
| `verification.partial` | "Partly checked: Walrus returned <recalled> of <indexed> records. Try again in a minute." | `TriangleExclamationPoint` |
| `!valid` | "History check failed:" + each `reasons[]` as a bullet | `ShieldX` |

   Link: "Anchor on Sui" → `link.testnetObject(ledgerId)`.
2. **Two columns**
   - **Left: Records** (newest first; `seq` is a real sequence so show "#5")
     - Row: kind icon, title, date (`at`), and a second line of links.

| `kind` | Icon | Title (from `data`) |
|---|---|---|
| `onboarded` | `KeyRound` | "Linked your memory account" |
| `policy_bought` | `ShieldPlus` | "Bought <data.kind> cover, payout <fromBase(data.payout)> DUSDC" |
| `warning` | `TriangleExclamationPoint` | "Warned: price near trigger (<usd(data.spotUsd)> vs <usd(data.strikeUsd)>)" |
| `response` | `CircleCheck` | "Responded: <data.action === 'deposit' ? 'added collateral' : 'repaid debt'> on Suilend" |
| `payout` | `Coins` | "Received <fromBase(data.payout)> DUSDC (<data.path>)" |
| `expired` | `CircleX` | "Cover ended" + (data.nearMiss ? " after a near miss" : "") |

     - Links line: each `evidence[]` digest as `TxLink` on `evidenceNetwork(kind)`; `BlobLink` when `blobId` (else "Saving to Walrus…"); "Signature OK" (`Signature`) or "Bad signature" (`ShieldX`) from `sigValid`; hash `shortId(hash)` with "← <shortId(prev)>" (icon `Hash`), both with `CopyButton`.
     - Show the chain visually (a vertical line joining rows) if your template has a timeline component.
   - **Right: two cards**
     - **Your price factor**: big `×<discountFactor.toFixed(2)>`; "Below 1 means cheaper cover." Three small figures: warnings, responses, payouts. One line: "You answered <responses> of <warnings> warnings."
     - **Who can write to it**
       - Row: "Ghostwriter underwriter", key `shortId(borrowerDelegatePublicKeyHex)`, button "Revoke" (`Ban`).
       - Text under it: "Revoking stops Ghostwriter from saving new records. Records already saved stay in your account and stay readable by the key (Walrus Memory removal is forward-only)."
       - **Verify it yourself** (collapsed): account id (`Address` → mainnet object), namespace `ghostwriter-history`, Ghostwriter record-signing public key `recordPubkeyHex` (`CopyButton`), ledger id. Text: "Any underwriter you give access to can check the same signatures and the anchor on Sui."

**Actions**

*Revoke*
1. Confirm dialog: "Revoke Ghostwriter's access? You'll sign on Sui Mainnet. Future records won't be saved, and your history discount will stop updating."
2. `await revokeGhostwriterKey(cfg, address, borrower.memwalAccountId)`.
3. Success → toast "Access revoked (tx <mainnet link>)". Show the key row as "Revoked" for this session (the backend has no revoke status field; future writes will fail on its side with `DELEGATE_NOT_REGISTERED`).
4. To restore access: link "Add Ghostwriter's key again" → `/onboard` (step 3 + 4 run again; register returns 200 for the same pair).

**States**
- No wallet: `EmptyState` (`Wallet`).
- Not registered: `EmptyState` (`KeyRound`) "You don't have a memory yet." + "Set up my memory" → `/onboard`.
- History loading: banner shows "Checking your history on Walrus and Sui…" (`LoaderCircle`). This can take a few seconds (backend re-verifies, cached 30 s).
- History error: `ErrorState` with the backend message (e.g. `UPSTREAM_MEMWAL`).

**Done when**
- After onboarding and one purchase, the page shows records #1 onboarded and #2 policy bought, each with a Walruscan link and "Signature OK", and the banner says verified.
- A new record appears within about a minute of an outcome (`memory.written` then `ledger.anchored`) without a reload.
- Revoke opens the wallet on **Mainnet** and returns a Mainnet tx link.

---

### 6.7 Underwriter — `/underwriter` (`app/underwriter/page.tsx`)

**Purpose:** show the AI underwriter's book and its memory: money in the vault, rules it has learned, how its prices moved, and every memory it wrote to Walrus Mainnet. This page is where judges see "learning over time".

**Data**
| What | Source |
|---|---|
| Book | `useBook()` → `GET /v1/underwriter/book` |
| Memory by namespace | `useUnderwriterMemory(ns)` → `GET /v1/underwriter/memory?namespace=cases|rules|quotes|policies&limit=20` |
| Write queue | `useMemoryWrites()` → `GET /v1/memory/writes?limit=50` |
| Live | SSE `rule.updated`, `policy.paid`, `policy.expired`, `memory.*`, `quote.issued` |

**Layout**
1. **Vault** (full width)
   - Big figure: `fromBase(vault)` "DUSDC in the vault (Testnet)".
   - One stacked bar: `locked` (for active policies) + `free`; legend with both amounts (`Amount`). Compute widths from `BigInt(locked)` and `BigInt(free)`; guard against `vault === '0'`.
   - Small figures: Premiums collected, Payouts made, Loss ratio `pct(lossRatio)` ("payouts ÷ premiums"), Active policies.
2. **What it has learned** (rules table)

| Column | Content |
|---|---|
| Bucket | "<asset>, <volBucket> volatility, <moneyBucket>% below spot" |
| Multiplier | `×<multiplier.toFixed(2)>` with `ArrowUpRight` if `> 1` |
| Status | `trial` / `active` / `retired` badge |
| Evidence | "<payouts> payouts, <quietExpiries> quiet expiries" |
| Lesson | `lesson` text |

   Empty: "No rules yet. Rules appear after the first payout or near miss."
   When `rule.updated` arrives, briefly highlight the changed row (match `ruleId`).
3. **Price multiplier over time**: line chart of `multiplierHistory` (`at` → `multiplier`), y-axis starting at 0.6 (the backend clamp minimum). Under it: "Each point is a quote. Jumps happen when a new memory changes the price."
4. **Memory on Walrus Mainnet** (tabs: Cases, Rules, Quotes, Policies → `cases|rules|quotes|policies`)
   - Tab header: "<indexedCount> memories" (icon `Database`).
   - Rows: `text` (or "Encrypted, not shown" when `text` is null), `BlobLink`, "Expires <expiresAt>" when present (else "epoch <endEpoch>").
5. **Live activity** (right column or bottom)
   - From `useEvents().recent`, filter to `memory.queued|written|failed`, `quote.issued`, `rule.updated`, `policy.paid`, `x402.settled`. One line each, newest first, with an icon:
     `memory.written` → `Database` "Saved <namespace> memory (<purpose>)" + `BlobLink`; `memory.failed` → `CircleX` + error; `quote.issued` → `Zap` "Quote ×<multiplier.toFixed(2)> for <shortId(buyer)>"; `rule.updated` → `ScrollText`; `policy.paid` → `Coins`; `x402.settled` → `Bot`.
   - Above it, from `useMemoryWrites()`: "<done> of <total> writes saved" and the latest 10 rows (status badge, namespace, purpose, `BlobLink` or error). This part survives reloads; the event lines only show what happened since the page opened.

**States**
- Each block loads and fails on its own (separate queries). A failing memory tab shows `ErrorState` only inside the tab.

**Done when**
- After the backend's `pnpm seed`, the Cases tab shows ≥ 10 memories with working Walruscan links and `indexedCount` matches.
- After a payout, a rule appears or changes (`rule.updated`) and the next quote in that bucket adds a point to the multiplier chart.

---

### 6.8 Agents — `/agents` (`app/agents/page.tsx`)

**Purpose:** show that AI agents can buy cover by paying over **x402**, settled on Sui, and let a judge see a real 402 response.

**Data**
| What | Source |
|---|---|
| Live agent purchases | `useEvents().recent` filtered to `x402.settled` (since the page opened; there is no list endpoint) |
| A real 402 | `api.agentPaymentRequired(input)` → `POST /v1/agent/cover` without a payment header |
| Policy for a settled purchase | `usePolicy(policyId)` on click |

**Layout**
1. **Header**: "Agents can buy cover too". One line: "An agent asks for cover, gets an HTTP 402 with the price, signs the purchase transaction, and sends it back. The payment is the purchase, so cover starts the moment it settles."
2. **The flow** (a real sequence; 3 numbered steps with icons)
   1. `Bot` "Ask": `POST /v1/agent/cover` with the cover request.
   2. `Receipt` "Get the price": `402 Payment Required` with x402 v2 terms: scheme `exact`, network `sui:testnet`, amount = premium, pay to the vault.
   3. `Signature` "Pay": the agent signs the `buy` transaction and resends with header `PAYMENT-SIGNATURE`. The backend checks it and executes it on Testnet; response header `PAYMENT-RESPONSE` has the tx digest.
3. **Try step 1 and 2 here** (card)
   - Small form: asset (SUI/BTC), trigger (default 15% below spot), payout (default 5), days (default 3). Buyer = the connected address. If not connected, show `ConnectButton` (the quote is signed for a buyer).
   - Button "Ask for a price" (`Zap`) → `api.agentPaymentRequired({ buyer, kind: 'price', asset, triggerPriceUsd, payoutUsdc, durationDays })`.
   - Show the result: "HTTP 402" badge, then `accepts[0]`: scheme, network, `fromBase(amount)` DUSDC, payTo `Address`, `maxTimeoutSeconds`; `resource.description`; a collapsed raw JSON view of the whole body.
   - Text under it: "To finish the purchase, run the agent: `pnpm agent` in the backend folder." Show the command with `CopyButton`.
4. **Live agent purchases** (list)
   - Each `x402.settled`: `Bot` icon, payer `Address`, "bought cover", `TxLink` testnet `digest`, link to `/policies/<policyId>`.
   - Empty: "No agent purchases since you opened this page. Run `pnpm agent` to see one arrive."
5. **Spec note** (small, icon `Info`): "Follows the x402 v2 'exact' scheme for Sui. The spec lists `sui:mainnet`; we use `sui:testnet` by the same pattern. Our premium goes into the vault object, not an address, so the contract checks the amount."

**Done when**
- "Ask for a price" shows a real 402 body whose amount equals the quote premium in `accepts[0].extra.quote.premium`.
- Running `pnpm agent` on the backend adds a row to Live agent purchases within seconds.

---

### 6.9 Proof — `/proof` (`app/proof/page.tsx`)

**Purpose:** one page with every ID a judge or the submission form needs, each linked to an explorer.

**Data**: `useProof()`, `useConfig()`, `useHealth()`.

**Layout** (definition list; every value has `CopyButton`, and explorer links where they exist)

| Label | Value | Link |
|---|---|---|
| Memories on Walrus Mainnet | `proof.mainnetMemories` | — |
| Latest memory blobs | `proof.lastBlobIds` | `link.blob` each |
| Underwriter memory account | `proof.underwriterAccountId` | `link.mainnetObject` |
| Agent ID (underwriter delegate public key) | `proof.memwalAgentId` | — |
| Contract package (Testnet) | `proof.packageId` | `link.testnetObject` |
| Vault pool (Testnet) | `proof.poolId` | `link.testnetObject` |
| Nautilus enclave object | `proof.enclaveObjectId` | `link.testnetObject` |
| Quote signing key | `config.pool.quotePubkeyHex` | — |
| Record signing key | `config.recordPubkeyHex` | — |
| Backend workers | `health.workers.*` as small badges (`running`/`stream`/`polling`/`stopped`/`disabled`) | — |
| Live chain heartbeat | `lastCheckpoint.seq` and age, from Tatum's checkpoint stream via the backend | — |

**Done when**: every value matches `GET /v1/proof`, `/v1/config`, `/v1/health`, and every link opens the right object.

---

## 7. SSE event → screen (what refreshes what)

Implemented in `applyToCache` (§3.6) and the page `useOnEvent` hooks.

| Event | Cache action | Pages that change | Toast (§4.4) |
|---|---|---|---|
| `chain.checkpoint` | — (stored as `lastCheckpoint`) | Top bar LiveDot, Proof | — |
| `price.tick` | update `market` spot in place | Top bar, Home, Cover, Policies, Policy detail chart | — |
| `quote.issued` | — | Underwriter activity | — |
| `policy.bought` | set `policy(id)`; invalidate `policies`, `book` | Policies, Underwriter, Home | — |
| `breach.reported` / `breach.reset` | invalidate `policy(id)`, `policies` | Policies, Policy detail | yes (mine) |
| `policy.paid` / `policy.expired` | invalidate `policy(id)`, `policies`, `book` | Policies, Policy detail, Underwriter, Home | paid (mine) |
| `warning.issued` | — | — | yes (mine) |
| `liquidation.seen` | — | Policy detail (liquidation) | — |
| `memory.queued` / `written` / `failed` | invalidate `memoryWrites`, `proof`; `uwMemory` (underwriter) or `history`/`borrower` (borrower address) | Underwriter, Memory, Onboard, Proof, Home | failed (mine) |
| `ledger.anchored` | invalidate `history`, `borrower` for that borrower | Memory, Onboard | yes (mine) |
| `rule.updated` | invalidate `book`, `uwMemory('rules')` | Underwriter | — |
| `hedge.*` | invalidate `policy(id)`, `policies` | Policy detail, Policies | — |
| `x402.settled` | invalidate `policies`, `book` | Agents, Underwriter | — |

---

## 8. Errors: what the user sees

| Source | Example | Shown as |
|---|---|---|
| API `BAD_REQUEST` (400) | "trigger must be below spot" | the backend message, next to the form |
| API `NOT_FOUND` (404) | unknown policy; unregistered liquidation quote | the page's empty state |
| API `CONFLICT` (409) | onboarding reasons; quote used | §6.2 table; "This quote was already used" |
| API `QUOTE_EXPIRED` (410) | | "This quote expired. Get a new quote." |
| API `RATE_LIMITED` (429) | Tatum busy | "The data provider is busy…" + Retry |
| API `CHAIN_ABORT` (422) | abort 16 | `ABORTS[code]` |
| API `UPSTREAM_*` (502) | Walrus / Tatum / enclave down | §3.4 messages + Retry |
| Wallet | user rejected | "You cancelled the request in your wallet." |
| Wallet / chain | Move abort in the buy tx | `ABORTS[code]` when the code can be read, else the raw message |
| Network | backend down | Health banner (§4.3) |

Never swallow an error. Every failed action shows a message and leaves the user a next step (Retry, Get a new quote, Connect wallet, or Set up memory).

---

## 9. Build order and checks

| Step | Build | Check against the real backend |
|---|---|---|
| F0 | Install (§0.2), `.env.local`, provider tree (§3.5), shell with sidebar + top bar (§4) | Page loads, `ConnectButton` connects Slush, top bar shows SUI price and network pills |
| F1 | `types`, `api`, `format`, `errors`, `queries`, `events` (§3.1–3.7) | LiveDot goes green; `price.tick` moves the top-bar price |
| F2 | Proof page (6.9) | All IDs match `curl localhost:8787/v1/proof` |
| F3 | Onboarding (6.2) + `useBorrower` + `memwal.ts` | Fresh wallet completes all 4 steps on Mainnet; `GET /v1/borrowers/<addr>` 200 |
| F4 | Cover (6.3) + `buy.ts` | Quote with citations; buy on Testnet; redirected to the policy |
| F5 | Policies (6.4) + detail (6.5) | Live breach timer and payout in the backend demo setup |
| F6 | Memory (6.6) | Verified banner, records with blob links, revoke on Mainnet |
| F7 | Underwriter (6.7) | Seeded cases visible; rule and multiplier change after a payout |
| F8 | Agents (6.8) | Real 402 body; `pnpm agent` row appears |
| F9 | Home (6.1) | Figures match the API |
| F10 | Pass over all pages: loading, empty and error states; mobile width; keyboard focus | Stop the backend: every page shows the health banner and nothing breaks |

### 9.1 Demo order (matches backend §10)
Home → Onboard (live "Saved"/"Anchored") → Cover (price breakdown + citations) → Buy → Policy detail (breach timer → paid) → Underwriter (new rule, re-quote higher) → Agents (`pnpm agent` row) → Proof (or Policy detail of a liquidation policy for the Nautilus part).

---

## 10. Open items (check while building)

| # | Item | Why it's open | What to do |
|---|---|---|---|
| FE-1 | Signing on Mainnet while the app's default network is Testnet | dApp Kit's `network` option on `signAndExecuteTransaction` is documented; whether each wallet honours the requested chain is up to the wallet | Test with Slush in F3. If the wallet refuses, call `dAppKit.switchNetwork('mainnet')` before the memory steps and `switchNetwork('testnet')` after, and tell the user to match the network in their wallet |
| FE-2 | `createAccount` returning an empty `accountId` | The SDK reads the id from effects and falls back through several shapes | The paste-the-id path in 6.2 covers it. Never guess the id |
| FE-3 | "Already has an account" error text | The contract enforces one account per address; the exact abort text was not checked | 6.2 opens the paste input on any non-cancel error at step 2 |
| FE-4 | Move abort format in wallet errors | Differs by wallet | `abortFromMessage` is best effort; the raw message is shown when it doesn't match |
| FE-5 | `ConnectButton` styling | It's a Web Component wrapper; theming is via dApp Kit's theming docs, not your template's classes | If it clashes, build your own button with `useWallets()` + `dAppKit.connectWallet()` |
| FE-6 | Agents feed after a reload | No list endpoint for x402 purchases; SSE replays only on reconnect | The page says "since you opened this page"; for the demo, open it before running `pnpm agent` |
