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
