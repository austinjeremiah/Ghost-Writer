# Ghostwriter — Backend Build Doc (master)

> AI-underwritten liquidation protection for Sui borrowers, with an underwriter whose memory lives on Walrus Memory (Mainnet), payouts settled by Pyth prices or a Nautilus-attested liquidation, premiums payable by AI agents over x402.
>
> Hackathon: **Total Recall — Tatum × Walrus Memory**. Deadline **10 Nov 2026, 17:00 UTC (22:30 IST)**. Track **03 Consumer Finance Apps**, plus special awards **Best Walrus Memory** and **Best Use of Agent Payments**.
>
> Team (2): **Backend dev** owns everything in this doc (Move, enclave, server). **Frontend dev** owns the frontend doc (written later, built only on the ICD in §5).

---

## 0. Read this first

### 0.0 Changes on 7 Nov 2026 (after checking the open questions)
- **Pyth:** the original Sui contracts stopped working on 26 Aug 2026. New Core Compatible IDs, new Move `rev`, Hermes at `pyth.dourolabs.app/hermes`, new secret `PYTH_API_KEY`, stable feed ids. (§4, P1, P3)
- **Tatum OHLCV:** one candle per call, so `vol.ts` fetches day by day and caches in SQLite; new `pnpm warm:ohlcv`. (P5)
- **x402:** moved to the official v2 Sui "exact" payload `{ signature, transaction }`; header `PAYMENT-SIGNATURE` (also accepts `X-PAYMENT`). (§5.7, P9)
- **DeepBook Predict:** real `planMint` / `enqueuePlan` / `waitForOutcome` signatures. (P10)
- **Pins:** `@mysten-incubation/memwal` 0.1.8, `@pythnetwork/pyth-sui-js` 4.0.0.
- **Logs:** the redactor now also hides the exact value of every secret env var.

### 0.1 How to use this doc
- Phases are small and ordered. Do them in order. Each phase ends with **exit checks**; do not start the next phase until they pass.
- Code blocks are **final file versions**. Copy them whole.
- Anything this doc could not confirm from official docs or package sources is marked **`OPEN-n`**. The list is in §0.3. Each one has a **check** (how to confirm in minutes) and a **fallback** (what to do if the check fails). None of them blocks the core product; the ones that touch an optional feature are behind a flag.

### 0.2 What is real and what runs where

| Piece | Network | Real? |
|---|---|---|
| Walrus Memory writes (underwriter + borrower accounts) | **Sui Mainnet** (hosted relayer `relayer.memory.walrus.xyz`) | Real, required by the hackathon |
| Borrower positions, Suilend liquidation events | **Sui Mainnet**, read through Tatum gRPC | Real data |
| Policies, collateral vault, payouts, ledger anchors | **Sui Testnet**, our Move package | Real contracts, test money (DUSDC) |
| Price trigger | Pyth on Sui Testnet (beta channel; prices track live market) | Real oracle |
| Liquidation trigger | Nautilus enclave on AWS Nitro reads a Mainnet liquidation through Tatum, signs it; our Testnet contract verifies the signature | Real TEE attestation |
| Premium payments by AI agents | x402-style HTTP 402 flow, settled on Sui Testnet | Real transactions |
| Hedge | DeepBook Predict Testnet (BTC only) | Real, behind `HEDGE_ENABLED` (see OPEN-7) |
| Quote explanations | OpenAI | Real; numbers are computed deterministically, the LLM only explains |

Money is test money on purpose: economically this is an insurance/derivative product, so we run it as a demo on testnet. The hackathon rule is about **memory on Mainnet**, which we satisfy.

### 0.3 Open questions (confirm these; GPT can research them)

| ID | Question | Check | Fallback |
|---|---|---|---|
| OPEN-1 | ✅ **Resolved 7 Nov.** `@mysten-incubation/memwal` latest = **0.1.8**. README lists peers `@mysten/sui` (^2.16.2 known good), `@mysten/seal` (^1.1.3), `@mysten/walrus` (^1.1.7), `ai`, `zod` "install as needed". Exact `peerDependencies`/`engines` object not seen | `pnpm install` prints any missing peer | Pinned `0.1.8`. If pnpm warns about a missing peer, add `@mysten/seal@^1.1.3` / `@mysten/walrus@^1.1.7` |
| OPEN-2 | ✅ **Resolved 7 Nov — breaking change.** The original Pyth contracts on Sui **stopped working on 26 Aug 2026**. Use **Pyth Core Compatible**: Testnet state `0x3c48fe39…a073e`, Wormhole state `0x750da8e6…164f0`, package `0xd1ac23e1…74d8fd`; Move dep `rev = "sui-pro-compatible-contract-testnet"`; Wormhole is vendored inside Pyth (no separate dep) | Pyth docs: docs.pyth.network/pro/use-prices-on-blockchain/sui and /pro/contract-addresses | Already applied in §4 and P1 `Move.toml` |
| OPEN-3 | ✅ **Resolved 7 Nov.** `@pythnetwork/pyth-sui-js` **4.0.0** needs `@mysten/sui` ^2 (peer `^2.22.1`) and takes any client with the `.core` API (`SuiJsonRpcClient` or `SuiGrpcClient`). `updatePriceFeeds(tx, updates: Buffer[], feedIds): Promise<string[]>`; `getPriceFeedsUpdateData(ids): Promise<Buffer[]>`. `SuiPriceServiceConnection` extends `HermesClient(endpoint, { accessToken })` | Pyth repo `target_chains/sui/sdk/js` | Pinned `4.0.0`; no overrides needed |
| OPEN-4 | ✅ **Resolved 7 Nov.** Hermes shape matches our parser (`parsed[].price.{price:string, conf:string, expo:int, publish_time:sec}`). **Hermes now needs a Pyth API key** (`Authorization: Bearer`). Host: `https://pyth.dourolabs.app/hermes` (same API as `hermes.pyth.network`). Testnet now uses the **stable** feed IDs (Pyth's testnet example uses SUI/USD `0x23d7…5744`) | Pyth "Core upgrade" page | New secret `PYTH_API_KEY` (free trial at app.pyth.com). `FEED_BTC_USD` default `0xe62d…5b43` is the stable BTC/USD id; smoke step confirms it via `/v2/price_feeds?query=BTC` |
| OPEN-5 | ✅ **Resolved 7 Nov — behaviour differs.** `GET /v4/data/rate/symbol/OHLCV?symbol=&unix=<ms>&interval=1d` returns **one** record closest to the timestamp. No `basePair`, no `limit`, no range. Exact JSON example not published | docs.tatum.io/reference/getsymbolohlcv | `vol.ts` now fetches one day per call, caches every day in SQLite (`ohlcv_daily`), and `pnpm warm:ohlcv` pre-fills it. Parser accepts a bare object, `{data:{…}}` or a one-item array |
| OPEN-6 | ✅ **Resolved 7 Nov.** `LiquidateEvent` fields: `lending_market_id, repay_reserve_id, withdraw_reserve_id, obligation_id, repay_coin_type, withdraw_coin_type, repay_amount, withdraw_amount, protocol_fee_amount, liquidator_bonus_amount` (our constants already match). `DepositEvent`/`RepayEvent` both carry `obligation_id`. `ObligationOwnerCap<P>` is generic | suilend/suilend `docs/suilend/lending_market.md` | For `SUILEND_OBLIGATION_CAP_TYPE` you need the concrete `P`: run `pnpm peek:suilend`, then `sui client object <lending_market_id> --json` on Mainnet and copy the `P` out of `LendingMarket<P>` |
| OPEN-7 | ✅ **Resolved 7 Nov.** `read.planMint(owner, m: MarketDescriptor, opts: { amount, orderFee? } & { slippageCents? })` → `MintPlan` (`accepting`, `refusal`, `order`…); then `tx.enqueuePlan(owner, m, plan)` → `{ transaction, preview }`; `read.waitForOutcome(coords, recordId)` → `{ outcome: 'filled'|'refunded'|'closed'|'gone'|'timeout' }`. Predict also exists on Mainnet now; we stay on Testnet (DUSDC) | MystenLabs/ts-sdks `packages/deepbook-v3/src/predict/client.ts` | P10 code updated; still off by default |
| OPEN-8 | ✅ **Resolved 7 Nov.** `sui_getTransactionBlock` is still listed by Tatum at `https://sui-mainnet.gateway.tatum.io/` (POST, `x-api-key`), but JSON-RPC is deprecated in favour of gRPC `LedgerService/GetTransaction` | Tatum RPC + migration guide | Keep the P7 `curl` check before building the enclave image; fallback unchanged |
| OPEN-9 | ⚠️ **Partly resolved 7 Nov.** Official spec `specs/schemes/exact/scheme_exact_sui.md` (repo now `x402-foundation/x402`) uses **x402Version 2**, payload `{ signature, transaction }` (base64), network `sui:mainnet`. No `sui:testnet` id and no header names on that page | x402-foundation/x402 | We now follow the v2 Sui payload shape and use `sui:testnet` by the same `sui:<network>` pattern. Server accepts the payment in `PAYMENT-SIGNATURE` **or** `X-PAYMENT`. Say in the blog: "spec shape, testnet id by analogy" |
| OPEN-10 | Your Tatum plan's gRPC streaming + RPS | Dashboard | Free = 3 RPS / 1M credits (docs). Code paces to `TATUM_RPS`. Checkpoint stream falls back to polling |
| OPEN-11 | Does `recall({limit:100})` return every record when a namespace has ≤100 records? | P4 exit check compares recall count with `listMemories` count | Code already reports a mismatch as "partial" and calls `restore()` |
| OPEN-12 | OpenAI model id your key can use | OpenAI dashboard | Required env `OPENAI_MODEL`; no default |

### 0.4 Decisions locked (from your answers)
- Team of 2. Backend dev does all of this doc.
- Hosting: **localhost for the demo video**; Railway steps included (P11) if you want a public URL.
- Database: **SQLite** (`better-sqlite3`, WAL mode). Zero setup, fastest, one file. Railway uses a volume.
- AI: **OpenAI** (`openai` npm, Chat Completions).
- Nautilus: **AWS Nitro** (you have $32 credits; Nautilus docs: instance ≈ **$0.19/hour** → stop it when idle; budget ≈ 150 hours).
- Agent payments: **x402** — the payment payload *is* the signed policy-purchase transaction, so paying and getting insured are one atomic step (this is the novel part).
- Tatum plan: start on **Free** (3 RPS). Everything is paced. Upgrade to Pay-as-you-go only if you see sustained 429s.
- Wallets: Slush on Mainnet (you will buy ~0.1 SUI for the Walrus Memory account txs); Testnet SUI ready.

---

## 1. What we are building

### 1.1 One paragraph
A Sui borrower asks Ghostwriter for cover: "if SUI stays below $X for N minutes in the next 7 days, pay me $Y" (price cover), or "if my Suilend obligation is liquidated in the next 7 days, pay me $Y" (liquidation cover). The backend prices it from volatility (Tatum OHLCV), adjusts the price using the underwriter's **Walrus Memory** (similar past cases, learned rules, and the borrower's own portable, tamper-evident history), signs the quote, and the borrower (or an AI agent over x402) buys it in one Testnet transaction that locks collateral in a Move vault. Payouts are automatic: a two-step Pyth price check, or a **Nautilus enclave attestation** of a real Mainnet liquidation. Every outcome is written back to Walrus Memory, so the next quote changes and cites the memory that changed it.

### 1.2 Architecture

```
                    ┌──────────────────────────── Sui MAINNET ────────────────────────────┐
                    │  Walrus Memory (MemWalAccount objects, Walrus blobs)                │
                    │  Suilend: obligations, LiquidateEvent / DepositEvent / RepayEvent    │
                    └──────▲───────────────────────▲──────────────────────────▲───────────┘
                           │ memwal SDK            │ Tatum gRPC (reads)       │ Tatum JSON-RPC
                           │ (relayer)             │                          │ (inside TEE)
 ┌─────────────┐   HTTP    │                       │                 ┌────────┴─────────┐
 │  Frontend   ├──────────►│   BACKEND (Node 24, Fastify, SQLite)    │ Nautilus enclave │
 │  (wallet)   │◄── SSE ───┤   routes · workers · memory queue       │ AWS Nitro        │
 └──────┬──────┘           │   pricing · OpenAI · x402 · hedger      │ signs liquidation│
        │ signs buy tx     └───────┬───────────────────────▲─────────┴────────▲─────────┘
        │                          │ Tatum gRPC (reads +   │ HTTP process_data │
        ▼                          ▼ server txs)           │                   │
   ┌──────────────────────── Sui TESTNET ─────────────────────────────────────┴──────┐
   │  ghostwriter::ghostwriter  (Pool<DUSDC>, Policy, Ledger, AdminCap, Enclave<GHOSTWRITER>) │
   │  Pyth (beta feeds)    DeepBook Predict (hedge, optional)                         │
   └─────────────────────────────────────────────────────────────────────────────────┘
 AI agent ── x402 v2 (HTTP 402 → signed buy tx in PAYMENT-SIGNATURE) ──► backend executes on Testnet
```

### 1.3 The memory design (why Walrus Memory is load-bearing)

| Account (Mainnet) | Owner | Who writes | Namespaces | What it holds |
|---|---|---|---|---|
| **Underwriter** | Team wallet (Slush) | Backend via delegate key | `ghostwriter-cases`, `ghostwriter-rules`, `ghostwriter-quotes`, `ghostwriter-policies` | Backtest aggregates, live payouts / near-misses, learned rules (append-only versions), quote reasoning, policy lifecycle |
| **Borrower** (one per user) | The borrower's own wallet | Backend via a delegate key the borrower adds (and can revoke) | `ghostwriter-history` | Signed, hash-chained records: onboarded, policy bought, warning, response (with Mainnet tx digest evidence), payout |

- **Pricing depends on memory**: case recall (vector search) and rule recall change the multiplier; borrower history changes the discount. Remove Walrus Memory and quotes fall back to the bare model — the product loses its learning and its portability.
- **Tamper evidence**: each borrower record is Ed25519-signed by Ghostwriter and carries the previous record's hash; the latest `(seq, head)` is anchored on Testnet in a `Ledger` object. A borrower cannot forge (no key) or hide records (gap breaks the chain or mismatches the anchor). Any other underwriter the borrower authorizes can verify the same way.

### 1.4 Sponsor requirements → where we satisfy them

| Requirement (official text) | Where | Phase |
|---|---|---|
| Walrus Memory integrated and writing on Mainnet | `memory/*` (queue + worker), mainnet relayer, two account kinds | P4 |
| Tatum RPC used for onchain data where relevant | Tatum Sui gRPC for **all** server reads and server txs on Mainnet and Testnet; Tatum JSON-RPC inside the enclave; Tatum Data API OHLCV for volatility | P3, P5, P7 |
| At least 10 memories stored on Mainnet | `scripts/seed-backtest.ts` writes ~24 backtest cases; live flows add more | P8 |
| Published blog post | §12 checklist (outline included) | P11 |
| Working demo and public repo | §13 demo script | P11 |
| Judging: integration 30% | Memory changes prices + borrower-owned memory; Tatum gRPC + streaming + Data API + enclave | all |
| Judging: technical quality 30% (clean code, Tatum Sui RPC) | Typed ICD, tests (Move + node:test), rate-limited Tatum client | all |
| Best Walrus Memory ("memories that visibly change the product") | Quote breakdown cites blob IDs; rule versions; borrower discount | P5, P8 |
| Best Use of Agent Payments (x402 or MPP, settled on Sui) | `POST /v1/agent/cover` + `scripts/agent-buyer.ts` | P9 |
| Bonus: share on X/LinkedIn | §12 | P11 |

---

## 2. Stack and versions

**Runtime**: Node **24.x** (Walrus Memory SDK requires Node ≥ 22.23.4 or ≥ 24.22.1). Package manager **pnpm ≥ 9.12**. Rust stable (enclave only). Sui CLI (testnet publish). AWS CLI v2.

| Package | Version rule | Source of the rule |
|---|---|---|
| `@mysten/sui` | `^2.37.0` | DeepBook Predict docs require ≥ 2.37.0; gRPC streaming needs ≥ 2.16 |
| `@mysten/deepbook-v3` | `^2.8.0` | DeepBook Predict docs (Mainnet needs ≥ 2.8.0) |
| `@grpc/grpc-js` | `^1.14.0` | Chainstack Sui gRPC guide (older versions break streams) |
| `@protobuf-ts/grpc-transport` | `^2.9.4` | Native gRPC transport documented by Mysten SDK |
| `@mysten-incubation/memwal` | `0.1.8` exact | npm latest, 7 Nov 2026 (OPEN-1) |
| `@pythnetwork/pyth-sui-js` | `4.0.0` exact | npm latest; first version on `@mysten/sui` v2 (OPEN-3) |
| `fastify` `^5`, `@fastify/cors` `^10`, `zod` `^3.23`, `better-sqlite3` `^11`, `openai` `^4`, `@noble/curves` `^1.9`, `@noble/hashes` `^1.8`, `dotenv` `^16`, `tsx` `^4`, `typescript` `^5.6` | caret ranges | **After first install, commit `pnpm-lock.yaml`. The lockfile is the pin.** |

---

## 3. Repo layout

```
ghostwriter/
├── move/ghostwriter/                 # Move package (Sui Testnet)
│   ├── Move.toml
│   ├── sources/ghostwriter.move
│   └── tests/ghostwriter_tests.move
├── enclave/                       # files you copy into a Nautilus repo checkout
│   ├── mod.rs
│   └── allowed_endpoints.yaml
├── backend/
│   ├── package.json  tsconfig.json  .env.example  .gitignore
│   ├── src/
│   │   ├── server.ts  config.ts  log.ts  errors.ts  db.ts  bus.ts  state.ts
│   │   ├── util/{ratelimit,sleep,canon,mutex}.ts
│   │   ├── chain/{clients,pyth,objects,poolCache,ghostwriterTx,suilend,memwalAccount}.ts
│   │   ├── memory/{client,queue,records,cases,rules}.ts
│   │   ├── pricing/{math,vol,quote,explain,buckets}.ts
│   │   ├── enclave/client.ts
│   │   ├── policies/{sync,learning}.ts
│   │   ├── workers/{priceWatcher,liquidationWatcher,checkpointPulse,hedger}.ts
│   │   ├── x402/agent.ts
│   │   └── routes/{meta,borrowers,quotes,policies,underwriter,events,agent}.ts
│   ├── scripts/{gen-keys,create-pool,fund-pool,smoke,seed-backtest,peek-suilend,agent-buyer,hedge-setup}.ts
│   └── test/{math,records,quote-bcs}.test.ts
└── docs/ (this file, frontend doc, blog draft)
```

---

## 4. Environment variables

`backend/.env.example` (copy to `.env`; **never commit `.env`**). "Secret" = backend only, never sent to the browser, never logged.

| Var | Secret | Example / default | Notes |
|---|---|---|---|
| `PORT` | no | `8787` | |
| `CORS_ORIGINS` | no | `http://localhost:5173` | comma list |
| `DB_PATH` | no | `./data/ghostwriter.db` | |
| `ADMIN_TOKEN` | **yes** | 32+ random chars | header `x-admin-token` for admin routes |
| `TATUM_API_KEY` | **yes** | `t-…` | gRPC metadata `x-api-key` |
| `TATUM_RPS` | no | `3` | Free plan = 3 RPS |
| `TATUM_GRPC_MAINNET` | no | `sui-mainnet-grpc.gateway.tatum.io:443` | Tatum docs |
| `TATUM_GRPC_TESTNET` | no | `sui-testnet-grpc.gateway.tatum.io:443` | Tatum docs |
| `TATUM_API_BASE` | no | `https://api.tatum.io` | Data API |
| `TATUM_OHLCV_QUERY` | no | `symbol={symbol}&unix={unix}&interval=1d` | One candle per call (OPEN-5). `{unix}` = day start in ms |
| `SERVER_SUI_PRIVATE_KEY` | **yes** | `suiprivkey1…` | Testnet key; deployer; owns `AdminCap`; pays gas |
| `GHOSTWRITER_PACKAGE_ID` | no | from publish | |
| `GHOSTWRITER_POOL_ID` | no | from `create-pool` | |
| `GHOSTWRITER_ADMIN_CAP_ID` | no | from publish | |
| `COIN_TYPE` | no | `0xc028557a1ed49e42ed091e115aedefd70a442b184c18fbec5c48d5b6c0b8c184::usdc::USDC` | DUSDC (DeepBook Predict Testnet quote coin), 6 decimals |
| `COIN_DECIMALS` | no | `6` | |
| `ENCLAVE_OBJECT_ID` | no | from `register_enclave.sh` | |
| `ENCLAVE_CONFIG_OBJECT_ID` | no | from publish | |
| `ENCLAVE_URL` | no | `http://<ec2-ip>:3000` | |
| `QUOTE_SIGNING_KEY_HEX` | **yes** | 64 hex | Ed25519 seed; pubkey goes on-chain in the Pool |
| `RECORD_SIGNING_KEY_HEX` | **yes** | 64 hex | Ed25519 seed for borrower records |
| `MEMWAL_SERVER_URL` | no | `https://relayer.memory.walrus.xyz` | Mainnet relayer |
| `MEMWAL_UNDERWRITER_ACCOUNT_ID` | no | `0x…` | from memory.walrus.xyz dashboard |
| `MEMWAL_UNDERWRITER_KEY` | **yes** | hex | delegate private key from dashboard |
| `MEMWAL_BORROWER_DELEGATE_KEY` | **yes** | hex | from `gen-keys`; its public key is published so borrowers can add it |
| `MEMWAL_PACKAGE_ID` | no | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` | Mainnet (Walrus docs) |
| `MEMWAL_REGISTRY_ID` | no | `0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f` | Mainnet (Walrus docs) |
| `PYTH_HERMES_URL` | no | `https://pyth.dourolabs.app/hermes` | Pyth Core upgrade page: same API as `hermes.pyth.network` (OPEN-4) |
| `PYTH_API_KEY` | **yes** | from app.pyth.com ("Get API key"; free trial) | Hermes requires it since the Aug 2026 upgrade. Backend only |
| `PYTH_STATE_ID` | no | `0x3c48fe392912de6c18087a2b3f5fdbfbfdb4598e180947feff1f12f8e9ea073e` | Pyth Core Compatible, Sui Testnet (OPEN-2). The old `0x2437…` no longer works |
| `WORMHOLE_STATE_ID` | no | `0x750da8e6d16b6a363a39fe2eaa8295ac224a1e6fce4e47b58845e2e8746164f0` | Pyth Core Compatible, Sui Testnet |
| `FEED_SUI_USD` | no | `0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744` | SUI/USD, from Pyth's current Sui testnet example (stable id) |
| `FEED_BTC_USD` | no | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | Stable BTC/USD id. **Confirm in smoke** (`/v2/price_feeds?query=BTC`) |
| `SUILEND_LIQUIDATE_EVENT_TYPE` | no | `0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LiquidateEvent` | DefiLlama adapter (OPEN-6) |
| `SUILEND_EVENT_MODULE` | no | `0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market` | for Deposit/Repay events |
| `SUILEND_OBLIGATION_CAP_TYPE` | no | empty | `…::lending_market::ObligationOwnerCap<P>` with the concrete `P` (see P7.1). Positions endpoint returns `[]` if empty |
| `OPENAI_API_KEY` | **yes** | `sk-…` | |
| `OPENAI_MODEL` | no | **required** | OPEN-12 |
| `HEDGE_ENABLED` | no | `false` | OPEN-7 |
| `HEDGE_RATIO` | no | `0.5` | fraction of premium spent on hedge |
| `PRICE_POLL_MS` | no | `10000` | |
| `LIQ_POLL_MS` | no | `20000` | |
| `PUBLIC_BASE_URL` | no | `http://localhost:8787` | used in x402 `resource` |

---

## 5. ICD — Interface Contracts (single source of truth)

### 5.1 Conventions
- Base URL: `http://localhost:8787`. JSON bodies, UTF-8. All amounts are **strings of integer base units** (DUSDC has 6 decimals). Prices on the wire: `strikeE8` = USD × 10⁸ as a string; display prices as numbers (`spotUsd`).
- Addresses/object IDs: normalized `0x` + 64 lowercase hex.
- Times: Unix **milliseconds** (number).
- Auth: user actions are authorized **on-chain** (the user's wallet signs the buy tx; the borrower's wallet adds our delegate key). Admin routes need header `x-admin-token`. No cookies, no sessions.
- Error body (every non-2xx except 402):
```json
{ "error": { "code": "BAD_REQUEST", "message": "human readable", "details": {} } }
```

| `code` | HTTP | When |
|---|---|---|
| `BAD_REQUEST` | 400 | zod validation, bad params |
| `UNAUTHORIZED` | 401 | missing/wrong admin token |
| `NOT_FOUND` | 404 | unknown id |
| `CONFLICT` | 409 | state conflict (quote used, delegate missing, ledger exists) |
| `QUOTE_EXPIRED` | 410 | quote past `expiresMs` |
| `RATE_LIMITED` | 429 | upstream limit after retries |
| `CHAIN_ABORT` | 422 | Move abort; `details.abort` has code/name |
| `UPSTREAM_TATUM` | 502 | Tatum gRPC/Data API failure |
| `UPSTREAM_MEMWAL` | 502 | relayer failure |
| `UPSTREAM_ENCLAVE` | 502 | enclave failure |
| `UPSTREAM_OPENAI` | 502 | only from admin tools; quotes never fail on OpenAI |
| `INTERNAL` | 500 | bug |

### 5.2 Enums and state machines

```ts
type PolicyKind = 'price' | 'liquidation';            // on-chain u8: 0 | 1
type Asset = 'SUI' | 'BTC';
type QuoteStatus = 'issued' | 'used' | 'expired';
type PolicyStatus = 'active' | 'breach' | 'paid' | 'expired';   // 'breach' = breach reported, waiting confirm
type MemoryWriteStatus = 'queued' | 'writing' | 'done' | 'failed';
type RecordKind = 'onboarded' | 'policy_bought' | 'warning' | 'response' | 'payout' | 'expired';
type CaseOutcome = 'payout' | 'near_miss' | 'expired' | 'backtest';
type RuleStatus = 'trial' | 'active' | 'retired';
```

Policy state machine (on-chain truth; DB mirrors it):
```
active ──report_breach (price ≤ strike, inside window)──► breach
breach ──reset_breach (price > strike)──► active
breach ──confirm_breach (≥ confirmDelayMs later, price still ≤ strike)──► paid  (path 0)
active ──settle_liquidation (valid enclave signature, ts in window)──► paid     (path 1)
active|breach ──expire (now > endMs + confirmDelayMs)──► expired
```

### 5.3 Constants

| Name | Value | Where enforced |
|---|---|---|
| `QUOTE_DOMAIN` | bytes of `"ghostwriter.quote.v1"` | Move `buy` + backend signer |
| `QUOTE_TTL_MS` | `120000` | backend + Move (`expires_ms`) |
| `LIQUIDATION_INTENT` | `1` | Move + enclave |
| `confirmDelayMs` | Pool field; **demo: 120000**, prod: 1800000 | Move |
| `maxConfBps` | Pool field, `200` (2%) | Move |
| `maxPriceAgeS` | Pool field, `60` | Move |
| `MIN_PREMIUM` | `100000` (0.10 DUSDC) | backend |
| `PAYOUT_RANGE` | 1–1000 DUSDC | backend |
| `DURATION_RANGE` | 1–30 days | backend |
| `LOADING` | `0.15` | backend |
| `MULTIPLIER_CLAMP` | `[0.6, 3.0]` | backend |
| `CASE_MAX_DISTANCE` | `0.35` (cosine distance; lower = closer) | backend |
| `NEAR_MISS_BAND` | price ≤ strike × 1.03 | backend |
| `WARNING_BAND` | price ≤ strike × 1.05 | backend |
| `RESPONSE_WINDOW_MS` | 24 h | backend |
| `MEMWAL_WRITE_GAP_MS` | `3000` per account (≈20 writes/min; reported cap ≈24/min) | backend |
| `RECORD_PREFIX` | `GHOSTWRITER_RECORD_V1 ` | backend |
| `CASE_PREFIX` / `RULE_PREFIX` / `QUOTE_PREFIX` / `POLICY_PREFIX` | `GHOSTWRITER_CASE_V1 ` / `GHOSTWRITER_RULE_V1 ` / `GHOSTWRITER_QUOTE_V1 ` / `GHOSTWRITER_POLICY_V1 ` | backend |

### 5.4 HTTP endpoints

#### `GET /v1/health`
200 `{ ok: true, version: string, uptimeS: number, workers: { priceWatcher: 'running'|'stopped', liquidationWatcher: ..., checkpointPulse: 'stream'|'polling'|'stopped', memoryQueue: ..., hedger: 'disabled'|'running' } }`

#### `GET /v1/config`
200 — everything the frontend needs, all public:
```ts
{
  network: { policies: 'testnet', memory: 'mainnet' },
  packageId: string, poolId: string, coinType: string, coinDecimals: 6,
  clockId: '0x6',
  feeds: { SUI: string /*0x…*/, BTC: string },
  pool: { confirmDelayMs: number, maxConfBps: number, maxPriceAgeS: number, quotePubkeyHex: string, paused: boolean },
  memwal: { packageId: string, registryId: string, serverUrl: string,
            borrowerDelegatePublicKeyHex: string, borrowerDelegateLabel: 'Ghostwriter underwriter',
            underwriterAccountId: string, historyNamespace: 'ghostwriter-history' },
  recordPubkeyHex: string,
  enclave: { objectId: string, configId: string },
  limits: { payoutMin: '1000000', payoutMax: '1000000000', durationDaysMin: 1, durationDaysMax: 30, quoteTtlMs: 120000 },
  explorers: { testnetObject: 'https://suiscan.xyz/testnet/object/', testnetTx: 'https://suiscan.xyz/testnet/tx/', mainnetObject: 'https://suiscan.xyz/mainnet/object/', mainnetTx: 'https://suiscan.xyz/mainnet/tx/', walrusBlob: 'https://walruscan.com/mainnet/blob/' }
}
```

#### `GET /v1/market`
200 `{ assets: Array<{ asset: Asset, feedId: string, spotUsd: number, publishMs: number, volAnnual: number, volBucket: 'low'|'mid'|'high' }> }`
Errors: `UPSTREAM_TATUM` (vol), 502 with code `UPSTREAM_TATUM` also used for Hermes failure (message says Hermes).

#### `PUT /v1/borrowers/:address`
Registers a borrower **after** their wallet created a MemWalAccount on Mainnet and added `borrowerDelegatePublicKeyHex` as a delegate.
Body `{ memwalAccountId: string }`
200 `BorrowerDTO`
Errors: 400; 409 `CONFLICT` with `details.reason` = `'NOT_OWNER' | 'DELEGATE_NOT_REGISTERED'`; 502 `UPSTREAM_TATUM | UPSTREAM_MEMWAL`.
Idempotent: a second call with the same pair returns 200.

```ts
type BorrowerDTO = {
  address: string, memwalAccountId: string, ledgerId: string | null,
  records: number, anchoredSeq: number,
  score: { verified: boolean, warnings: number, responses: number, payouts: number, discountFactor: number }
};
```

#### `GET /v1/borrowers/:address`
200 `BorrowerDTO` · 404.

#### `GET /v1/borrowers/:address/history`
200 `HistoryDTO` (re-verified from Walrus + chain, cached 30 s)
```ts
type HistoryDTO = {
  address: string, memwalAccountId: string, ledgerId: string,
  verification: { valid: boolean, reasons: string[], recalled: number, indexed: number | null,
                  anchoredSeq: number, anchoredHead: string, partial: boolean },
  records: Array<{ seq: number, kind: RecordKind, at: number, data: Record<string, unknown>,
                   evidence: string[], hash: string, prev: string, blobId: string | null, sigValid: boolean }>
};
```

#### `GET /v1/borrowers/:address/positions`
200 `{ obligations: Array<{ obligationId: string, raw: unknown }> , note?: string }` (best-effort, Mainnet Suilend; `[]` + note when `SUILEND_OBLIGATION_CAP_TYPE` unset).

#### `POST /v1/quotes`
Body:
```ts
{ buyer: string, kind: PolicyKind, asset: Asset, triggerPriceUsd: number, payoutUsdc: number,
  durationDays: number, obligationId?: string /* required when kind = 'liquidation' */ }
```
Rules: `triggerPriceUsd < spotUsd`; `payoutUsdc` 1–1000; `durationDays` integer 1–30.
200 `QuoteDTO`:
```ts
type QuoteDTO = {
  quoteId: string /*32 hex*/, buyer: string, kind: PolicyKind, kindU8: 0 | 1, asset: Asset,
  feedId: string, strikeE8: string, obligationId: string /*0x0…0 for price*/,
  payout: string, premium: string, startMs: number, endMs: number, expiresMs: number,
  signatureHex: string,
  pricing: { spotUsd: number, volAnnual: number, probability: number, basePremium: string,
             multiplier: number, factors: { cases: number, rules: number, borrower: number } },
  citations: Array<{ namespace: string, blobId: string, kind: 'case'|'rule'|'record', summary: string, distance?: number }>,
  explanation: string, explanationSource: 'openai' | 'fallback',
  moveCall: { target: string, typeArguments: [string],
              argOrder: ['pool','kind','feedId','strikeE8','obligationId','payout','premium','startMs','endMs','quoteId','expiresMs','signature','payment','clock'] }
};
```
Errors: 400 (incl. `trigger must be below spot`), 404 `NOT_FOUND` if liquidation kind and borrower not registered, 502 upstream.

#### `GET /v1/quotes/:id`
200 `QuoteDTO & { status: QuoteStatus }` · 404.

#### `POST /v1/policies/confirm`
Called by the frontend right after the buy tx succeeds.
Body `{ digest: string, quoteId: string }`
200 `PolicyDTO` · 404 (no Policy in tx) · 409 (quote/policy mismatch) · 502.

```ts
type PolicyDTO = {
  policyId: string, quoteId: string, holder: string, kind: PolicyKind, asset: Asset,
  feedId: string, strikeE8: string, obligationId: string, payout: string, premium: string,
  startMs: number, endMs: number, status: PolicyStatus, breachStartedMs: number,
  buyDigest: string | null, settleDigest: string | null, settlePath: 'price'|'liquidation'|null,
  hedge: { status: 'none'|'queued'|'filled'|'refunded'|'failed', detail?: string }
};
```

#### `GET /v1/policies?holder=0x…&status=active`
200 `{ policies: PolicyDTO[] }` (both query params optional; max 200, newest first).

#### `GET /v1/policies/:id`
200 `PolicyDTO` · 404.

#### `POST /v1/policies/:id/claim-liquidation`
Body `{ txDigest: string }` — a **Mainnet** transaction digest containing a Suilend `LiquidateEvent` for this policy's obligation.
200 `{ status: 'paid', settleDigest: string }` · 409 (wrong kind / not active) · 422 `CHAIN_ABORT` · 502 `UPSTREAM_ENCLAVE`.
(The liquidation watcher does this automatically; this route exists for the demo and as a manual retry.)

#### `GET /v1/underwriter/book`
200:
```ts
{ vault: string, locked: string, free: string, premiumsCollected: string, payoutsMade: string,
  lossRatio: number, activePolicies: number,
  rules: Array<{ ruleId: string, asset: Asset, volBucket: string, moneyBucket: string,
                 multiplier: number, status: RuleStatus, lesson: string, payouts: number, quietExpiries: number }>,
  multiplierHistory: Array<{ at: number, quoteId: string, multiplier: number }> }
```

#### `GET /v1/underwriter/memory?namespace=cases|rules|quotes|policies&limit=20`
200:
```ts
{ namespace: string, indexedCount: number,
  items: Array<{ blobId: string, createdAt: string | null, endEpoch: number | null, expiresAt: string | null, text: string | null }> }
```
(`endEpoch`/`expiresAt` come from `listMemories`; `text` from `recall`.)

#### `GET /v1/memory/writes?limit=50`
200 `{ total: number, done: number, items: Array<{ id: number, account: 'underwriter'|string, namespace: string, purpose: string, status: MemoryWriteStatus, blobId: string|null, error: string|null, createdAt: number }> }`

#### `GET /v1/proof`
200 `{ memwalAgentId: string /* underwriter delegate public key hex */, underwriterAccountId: string, mainnetMemories: number, lastBlobIds: string[], packageId: string, poolId: string, enclaveObjectId: string }`

#### `POST /v1/agent/cover` (x402)
See §5.7.

#### `GET /v1/events` (SSE)
See §5.5.

#### Admin (header `x-admin-token`)
- `POST /v1/admin/restore` body `{ namespace: string }` → `{ restored, skipped, failed, total }` (calls memwal `restore`).
- `POST /v1/admin/pause` body `{ paused: boolean }` → `{ digest }`.

### 5.5 SSE events (`GET /v1/events`)
- Headers: `Content-Type: text/event-stream`. Supports `Last-Event-ID` (replays up to 200 stored events after that id). Heartbeat comment `: ping` every 15 s.
- Frame: `id: <n>\nevent: <type>\ndata: <json>\n\n`.

| `event` | `data` |
|---|---|
| `chain.checkpoint` | `{ network: 'testnet', seq: string, at: number }` (throttled to 1 per 5 s) |
| `price.tick` | `{ prices: Array<{ asset, spotUsd, publishMs }> }` (every price-watcher run) |
| `quote.issued` | `{ quoteId, buyer, premium, multiplier }` |
| `policy.bought` | `PolicyDTO` |
| `breach.reported` | `{ policyId, priceE8: string, digest }` |
| `breach.reset` | `{ policyId, priceE8: string, digest }` |
| `policy.paid` | `{ policyId, holder, payout, path: 'price'|'liquidation', digest }` |
| `policy.expired` | `{ policyId, digest }` |
| `warning.issued` | `{ policyId, borrower, spotUsd, strikeUsd }` |
| `liquidation.seen` | `{ obligationId, txDigest, matchedPolicyId: string | null }` |
| `memory.queued` | `{ id, account, namespace, purpose }` |
| `memory.written` | `{ id, account, namespace, purpose, blobId }` |
| `memory.failed` | `{ id, account, namespace, purpose, error }` |
| `ledger.anchored` | `{ borrower, seq, head, digest }` |
| `rule.updated` | `{ ruleId, multiplier, status }` |
| `hedge.placed` / `hedge.filled` / `hedge.failed` | `{ policyId, detail }` |
| `x402.settled` | `{ quoteId, payer, digest, policyId }` |

### 5.6 On-chain schemas (Move, Testnet) — BCS field order matters

```move
public struct Pool<phantom C> has key {
  id: UID, vault: Balance<C>, locked: u64, quote_pubkey: vector<u8>,
  premiums_collected: u64, payouts_made: u64, confirm_delay_ms: u64,
  max_conf_bps: u64, max_price_age_s: u64, paused: bool, used_quotes: Table<vector<u8>, bool>,
}
public struct Policy<phantom C> has key {
  id: UID, pool_id: ID, holder: address, kind: u8, feed_id: vector<u8>, strike_e8: u64,
  obligation_id: address, payout: u64, premium: u64, start_ms: u64, end_ms: u64,
  quote_id: vector<u8>, status: u8, breach_started_ms: u64,
}
public struct Ledger has key { id: UID, borrower: address, memwal_account: address, seq: u64, head: vector<u8> }
public struct QuoteMessage has copy, drop {           // ed25519-signed by backend, verified in buy()
  domain: vector<u8>, pool_id: ID, buyer: address, kind: u8, feed_id: vector<u8>, strike_e8: u64,
  obligation_id: address, payout: u64, premium: u64, start_ms: u64, end_ms: u64,
  quote_id: vector<u8>, expires_ms: u64,
}
public struct LiquidationAttestation has copy, drop {  // signed by the enclave inside IntentMessage<T>
  obligation_id: address, tx_digest: vector<u8> /* UTF-8 bytes of the base58 digest */,
  repay_amount: u64, withdraw_amount: u64,
}
```
`feed_id` = 32 raw bytes of the Pyth feed id (no `0x`). `quote_id` = 16 raw bytes. Events: `PoolCreated`, `PolicyBought`, `BreachReported`, `BreachReset`, `PolicyPaid{path: 0|1}`, `PolicyExpired`, `LedgerCreated`, `Anchored`.

Abort codes (returned in `CHAIN_ABORT.details.abort`):
`1 EPaused, 2 EQuoteExpired, 3 EBadQuoteSig, 4 EQuoteUsed, 5 EInsufficientPayment, 6 EInsufficientCapacity, 7 ENotActive, 8 EWrongKind, 9 EOutsideWindow, 10 EWrongFeed, 11 EPriceTooUncertain, 12 ENotBreached, 13 EBreachAlreadyReported, 14 ENoBreach, 15 ETooEarly, 16 EBadAttestation, 17 EWrongPool, 18 EStaleEnclave, 19 ENotExpired, 20 EBadSeq, 21 EBadParams, 22 ENegativePrice, 23 EInsufficientFree, 24 EPriceAbove`.

### 5.7 x402 contract (`POST /v1/agent/cover`)

Request body = same as `POST /v1/quotes`. Payment header optional: `PAYMENT-SIGNATURE` (x402 v2 name) or `X-PAYMENT` (v1 name); the server reads either.

Shapes follow the official Sui "exact" scheme (`x402-foundation/x402`, `specs/schemes/exact/scheme_exact_sui.md`, **x402Version 2**). The spec only shows `sui:mainnet`; we use `sui:testnet` by the same pattern (OPEN-9).

**Without a payment header** → `402 Payment Required`, same JSON also base64-encoded in header `PAYMENT-REQUIRED`:
```json
{
  "x402Version": 2,
  "error": "payment required",
  "resource": { "url": "<PUBLIC_BASE_URL>/v1/agent/cover", "description": "Ghostwriter cover: <kind> <asset> below $<trigger> until <iso>, payout <payout> DUSDC", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "sui:testnet",
    "amount": "<premium base units>",
    "asset": "<COIN_TYPE>",
    "payTo": "<poolId>",
    "maxTimeoutSeconds": 120,
    "extra": { "quote": <QuoteDTO>, "how": "Build a PTB calling quote.moveCall.target with args in quote.moveCall.argOrder; sign; send base64 JSON in PAYMENT-SIGNATURE" }
  }]
}
```
**With the payment header** = base64 of (spec PaymentPayload):
```json
{ "x402Version": 2,
  "resource": { "url": "…" },
  "accepted": { "scheme": "exact", "network": "sui:testnet", "amount": "…", "asset": "…", "payTo": "<poolId>", "maxTimeoutSeconds": 120, "extra": {} },
  "payload": { "signature": "<base64 Sui signature>", "transaction": "<base64 tx bytes>" } }
```
Server checks (spec facilitator steps, adapted): network matches; tx sender = quote buyer; tx contains exactly one MoveCall to `<pkg>::ghostwriter::buy`; its `quote_id` pure arg names an issued, unexpired quote; then it executes the signed tx on Testnet (execution fails if the signature is bad or the tx already ran).
**One honest difference from the spec:** the spec's last check is "payTo address receives the amount". Our premium goes into the shared `Pool` object inside `buy`, not to an address, so instead we check the `buy` call itself and the Move contract enforces `premium ≥ quoted premium` (abort 5). Say this in the blog.
200 body `PolicyDTO`, header `PAYMENT-RESPONSE` (and `X-PAYMENT-RESPONSE`) = base64 `{ "success": true, "transaction": "<digest>", "network": "sui:testnet", "payer": "<address>" }`.
Failure after a valid header: `402` with the same `accepts` plus `"error": "<reason>"`.

---

## 6. Phases

### P0 — Accounts, wallets, tools (no code)

**Goal:** every external account exists before writing code.

| # | Do | Result |
|---|---|---|
| 1 | Install Node 24, pnpm (`corepack enable`), Sui CLI, Rust stable, AWS CLI v2, `grpcurl` | tools on PATH |
| 2 | Tatum: sign up at dashboard.tatum.io, create API key (Mainnet-capable). Note the **dashboard account ID** (submission form) | `TATUM_API_KEY` |
| 3 | Sui CLI testnet key for the server: `sui client new-address ed25519` → `sui client switch --env testnet` → faucet (`sui client faucet`) → export with `sui keytool export --key-identity <address>` | `SERVER_SUI_PRIVATE_KEY` (`suiprivkey1…`) |
| 4 | DUSDC: request from the DeepBook Predict Testnet form (https://tally.so/r/Xx102L) to the server address **and** to your own Slush testnet address | coins for pool collateral and buying |
| 5 | Walrus Memory underwriter account: open https://memory.walrus.xyz with the team Slush wallet on **Mainnet** (needs a little SUI), create the account and a delegate key labelled `ghostwriter-server` | `MEMWAL_UNDERWRITER_ACCOUNT_ID`, `MEMWAL_UNDERWRITER_KEY`, delegate **public** key = `MEMWAL_AGENT_ID` for the form |
| 6 | OpenAI key + model you can use | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| 6b | Pyth API key: app.pyth.com → "Get API key" (free trial; Hermes refuses requests without it since Aug 2026) | `PYTH_API_KEY` |
| 7 | AWS: account with Nitro Enclaves in `us-east-1`; `aws configure sso` (Nautilus docs, Step 2) | ready for P7 |

**Exit checks**
- `grpcurl -H "x-api-key: $TATUM_API_KEY" sui-mainnet-grpc.gateway.tatum.io:443 sui.rpc.v2.LedgerService/GetServiceInfo` returns JSON (server reflection; if reflection is off, use the proto-file command from Tatum docs).
- Same for `sui-testnet-grpc.gateway.tatum.io:443`.
- `sui client balance` on testnet shows SUI and DUSDC.
- Walrus Memory dashboard shows the account and one delegate key.

**Commit:** `chore: P0 accounts ready (no code)`

---

### P1 — Move package (Sui Testnet)

**Goal:** publish `ghostwriter::ghostwriter` with Pool, Policy, Ledger, price + liquidation settlement, and the Nautilus enclave config.

**`move/ghostwriter/Move.toml`**
```toml
[package]
name = "ghostwriter"
edition = "2024"

[dependencies]
# Pyth Core Compatible, Testnet (Pyth docs, Sui guide; OPEN-2). Wormhole is vendored inside this Pyth package, so no Wormhole line.
# Our Move code imports `pyth::…` modules; this package keeps those module paths.
pyth = { git = "https://github.com/pyth-network/pyth-crosschain.git", subdir = "target_chains/sui/contracts", rev = "sui-pro-compatible-contract-testnet" }
# Same Sui framework rev that Pyth's own testnet Move.toml pins (avoids a framework conflict).
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "041c5f2bae2fe52079e44b70514333532d69f4e6" }
# Local path to a Nautilus clone that sits NEXT TO this repo (…/work/ghostwriter and …/work/nautilus).
# The enclave package is published first (Nautilus docs flow), so this dependency resolves to its published address.
enclave = { local = "../../../nautilus/move/enclave" }

[addresses]
ghostwriter = "0x0"
```

**`move/ghostwriter/sources/ghostwriter.move`**
```move
// Ghostwriter: AI-underwritten liquidation protection (Sui Testnet).
module ghostwriter::ghostwriter;

use std::bcs;
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::ed25519;
use sui::event;
use sui::table::{Self, Table};
use pyth::pyth;
use pyth::price;
use pyth::i64;
use pyth::price_info::{Self, PriceInfoObject};
use pyth::price_identifier;
use enclave::enclave::{Self, Enclave, EnclaveConfig};

// ---------- errors ----------
const EPaused: u64 = 1;
const EQuoteExpired: u64 = 2;
const EBadQuoteSig: u64 = 3;
const EQuoteUsed: u64 = 4;
const EInsufficientPayment: u64 = 5;
const EInsufficientCapacity: u64 = 6;
const ENotActive: u64 = 7;
const EWrongKind: u64 = 8;
const EOutsideWindow: u64 = 9;
const EWrongFeed: u64 = 10;
const EPriceTooUncertain: u64 = 11;
const ENotBreached: u64 = 12;
const EBreachAlreadyReported: u64 = 13;
const ENoBreach: u64 = 14;
const ETooEarly: u64 = 15;
const EBadAttestation: u64 = 16;
const EWrongPool: u64 = 17;
const EStaleEnclave: u64 = 18;
const ENotExpired: u64 = 19;
const EBadSeq: u64 = 20;
const EBadParams: u64 = 21;
const ENegativePrice: u64 = 22;
const EInsufficientFree: u64 = 23;
const EPriceAbove: u64 = 24;

// ---------- constants ----------
const KIND_PRICE: u8 = 0;
const KIND_LIQ: u8 = 1;
const STATUS_ACTIVE: u8 = 0;
const STATUS_PAID: u8 = 1;
const STATUS_EXPIRED: u8 = 2;
const LIQUIDATION_INTENT: u8 = 1;
const QUOTE_DOMAIN: vector<u8> = b"ghostwriter.quote.v1";

// ---------- types ----------
/// One-time witness; also the type tag for Enclave<GHOSTWRITER>.
public struct GHOSTWRITER has drop {}

public struct AdminCap has key, store { id: UID }

public struct Pool<phantom C> has key {
    id: UID,
    vault: Balance<C>,
    locked: u64,
    quote_pubkey: vector<u8>,
    premiums_collected: u64,
    payouts_made: u64,
    confirm_delay_ms: u64,
    max_conf_bps: u64,
    max_price_age_s: u64,
    paused: bool,
    used_quotes: Table<vector<u8>, bool>,
}

public struct Policy<phantom C> has key {
    id: UID,
    pool_id: ID,
    holder: address,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    status: u8,
    breach_started_ms: u64,
}

public struct Ledger has key {
    id: UID,
    borrower: address,
    memwal_account: address,
    seq: u64,
    head: vector<u8>,
}

public struct QuoteMessage has copy, drop {
    domain: vector<u8>,
    pool_id: ID,
    buyer: address,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    expires_ms: u64,
}

/// Must match the Rust struct in the enclave field-for-field (BCS is order sensitive).
public struct LiquidationAttestation has copy, drop {
    obligation_id: address,
    tx_digest: vector<u8>,
    repay_amount: u64,
    withdraw_amount: u64,
}

// ---------- events ----------
public struct PoolCreated has copy, drop { pool_id: ID }
public struct PolicyBought has copy, drop {
    policy_id: ID, pool_id: ID, holder: address, kind: u8, payout: u64, premium: u64,
    start_ms: u64, end_ms: u64, quote_id: vector<u8>,
}
public struct BreachReported has copy, drop { policy_id: ID, price_e8: u64, at_ms: u64 }
public struct BreachReset has copy, drop { policy_id: ID, price_e8: u64, at_ms: u64 }
public struct PolicyPaid has copy, drop { policy_id: ID, holder: address, payout: u64, path: u8, evidence: vector<u8> }
public struct PolicyExpired has copy, drop { policy_id: ID }
public struct LedgerCreated has copy, drop { ledger_id: ID, borrower: address, memwal_account: address }
public struct Anchored has copy, drop { ledger_id: ID, borrower: address, seq: u64, head: vector<u8>, at_ms: u64 }

// ---------- init ----------
fun init(otw: GHOSTWRITER, ctx: &mut TxContext) {
    let cap = enclave::new_cap(otw, ctx);
    // Placeholder PCRs; replace with real ones via enclave::update_pcrs after building the enclave.
    cap.create_enclave_config(
        b"ghostwriter liquidation enclave".to_string(),
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        ctx,
    );
    transfer::public_transfer(cap, ctx.sender());
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// ---------- admin ----------
public fun create_pool<C>(
    _: &AdminCap,
    quote_pubkey: vector<u8>,
    confirm_delay_ms: u64,
    max_conf_bps: u64,
    max_price_age_s: u64,
    ctx: &mut TxContext,
) {
    assert!(quote_pubkey.length() == 32, EBadParams);
    assert!(max_conf_bps > 0 && max_conf_bps <= 10_000 && max_price_age_s > 0, EBadParams);
    let pool = Pool<C> {
        id: object::new(ctx),
        vault: balance::zero(),
        locked: 0,
        quote_pubkey,
        premiums_collected: 0,
        payouts_made: 0,
        confirm_delay_ms,
        max_conf_bps,
        max_price_age_s,
        paused: false,
        used_quotes: table::new(ctx),
    };
    event::emit(PoolCreated { pool_id: object::id(&pool) });
    transfer::share_object(pool);
}

public fun deposit<C>(pool: &mut Pool<C>, _: &AdminCap, coin: Coin<C>) {
    pool.vault.join(coin.into_balance());
}

public fun withdraw<C>(pool: &mut Pool<C>, _: &AdminCap, amount: u64, ctx: &mut TxContext): Coin<C> {
    assert!(free(pool) >= amount, EInsufficientFree);
    coin::from_balance(pool.vault.split(amount), ctx)
}

public fun set_paused<C>(pool: &mut Pool<C>, _: &AdminCap, paused: bool) { pool.paused = paused; }

public fun set_quote_pubkey<C>(pool: &mut Pool<C>, _: &AdminCap, pk: vector<u8>) {
    assert!(pk.length() == 32, EBadParams);
    pool.quote_pubkey = pk;
}

fun free<C>(pool: &Pool<C>): u64 { pool.vault.value() - pool.locked }

// ---------- buy ----------
public fun buy<C>(
    pool: &mut Pool<C>,
    kind: u8,
    feed_id: vector<u8>,
    strike_e8: u64,
    obligation_id: address,
    payout: u64,
    premium: u64,
    start_ms: u64,
    end_ms: u64,
    quote_id: vector<u8>,
    expires_ms: u64,
    signature: vector<u8>,
    mut payment: Coin<C>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!pool.paused, EPaused);
    let now = clock.timestamp_ms();
    assert!(now <= expires_ms, EQuoteExpired);
    assert!(kind == KIND_PRICE || kind == KIND_LIQ, EWrongKind);
    assert!(end_ms > start_ms && end_ms > now && payout > 0, EBadParams);
    assert!(!pool.used_quotes.contains(quote_id), EQuoteUsed);

    let msg = QuoteMessage {
        domain: QUOTE_DOMAIN,
        pool_id: object::id(pool),
        buyer: ctx.sender(),
        kind,
        feed_id,
        strike_e8,
        obligation_id,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
        expires_ms,
    };
    let bytes = bcs::to_bytes(&msg);
    assert!(ed25519::ed25519_verify(&signature, &pool.quote_pubkey, &bytes), EBadQuoteSig);

    assert!(payment.value() >= premium, EInsufficientPayment);
    let paid = payment.split(premium, ctx);
    if (payment.value() == 0) { payment.destroy_zero() } else { transfer::public_transfer(payment, ctx.sender()) };
    pool.vault.join(paid.into_balance());
    pool.premiums_collected = pool.premiums_collected + premium;

    assert!(free(pool) >= payout, EInsufficientCapacity);
    pool.locked = pool.locked + payout;
    pool.used_quotes.add(quote_id, true);

    let policy = Policy<C> {
        id: object::new(ctx),
        pool_id: object::id(pool),
        holder: ctx.sender(),
        kind,
        feed_id,
        strike_e8,
        obligation_id,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
        status: STATUS_ACTIVE,
        breach_started_ms: 0,
    };
    event::emit(PolicyBought {
        policy_id: object::id(&policy),
        pool_id: object::id(pool),
        holder: ctx.sender(),
        kind,
        payout,
        premium,
        start_ms,
        end_ms,
        quote_id,
    });
    transfer::share_object(policy);
}

// ---------- price path ----------
fun pow10(n: u64): u64 {
    let mut r = 1;
    let mut i = 0;
    while (i < n) { r = r * 10; i = i + 1; };
    r
}

/// Converts a Pyth magnitude with expo -neg_expo to USD * 1e8.
public fun scale_to_e8(v: u64, neg_expo: u64): u64 {
    if (neg_expo == 8) v
    else if (neg_expo < 8) v * pow10(8 - neg_expo)
    else v / pow10(neg_expo - 8)
}

fun price_e8<C>(pool: &Pool<C>, policy: &Policy<C>, pio: &PriceInfoObject, clock: &Clock): u64 {
    let info = price_info::get_price_info_from_price_info_object(pio);
    let id = price_identifier::get_bytes(&price_info::get_price_identifier(&info));
    assert!(id == policy.feed_id, EWrongFeed);
    let p = pyth::get_price_no_older_than(pio, clock, pool.max_price_age_s);
    let raw = price::get_price(&p);
    assert!(!i64::get_is_negative(&raw), ENegativePrice);
    let mag = i64::get_magnitude_if_positive(&raw);
    let conf = price::get_conf(&p);
    assert!(mag > 0 && conf * 10_000 <= mag * pool.max_conf_bps, EPriceTooUncertain);
    let expo = price::get_expo(&p);
    assert!(i64::get_is_negative(&expo), EBadParams);
    scale_to_e8(mag, i64::get_magnitude_if_negative(&expo))
}

fun assert_live<C>(pool: &Pool<C>, policy: &Policy<C>, kind: u8) {
    assert!(policy.pool_id == object::id(pool), EWrongPool);
    assert!(policy.status == STATUS_ACTIVE, ENotActive);
    assert!(policy.kind == kind, EWrongKind);
}

public fun report_breach<C>(pool: &Pool<C>, policy: &mut Policy<C>, pio: &PriceInfoObject, clock: &Clock) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms == 0, EBreachAlreadyReported);
    let now = clock.timestamp_ms();
    assert!(now >= policy.start_ms && now <= policy.end_ms, EOutsideWindow);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p <= policy.strike_e8, ENotBreached);
    policy.breach_started_ms = now;
    event::emit(BreachReported { policy_id: object::id(policy), price_e8: p, at_ms: now });
}

public fun reset_breach<C>(pool: &Pool<C>, policy: &mut Policy<C>, pio: &PriceInfoObject, clock: &Clock) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms != 0, ENoBreach);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p > policy.strike_e8, EPriceAbove);
    policy.breach_started_ms = 0;
    event::emit(BreachReset { policy_id: object::id(policy), price_e8: p, at_ms: clock.timestamp_ms() });
}

public fun confirm_breach<C>(
    pool: &mut Pool<C>,
    policy: &mut Policy<C>,
    pio: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_live(pool, policy, KIND_PRICE);
    assert!(policy.breach_started_ms != 0, ENoBreach);
    let now = clock.timestamp_ms();
    assert!(now >= policy.breach_started_ms + pool.confirm_delay_ms, ETooEarly);
    let p = price_e8(pool, policy, pio, clock);
    assert!(p <= policy.strike_e8, ENotBreached);
    pay(pool, policy, 0, vector[], ctx);
}

// ---------- liquidation path ----------
public fun settle_liquidation<C>(
    pool: &mut Pool<C>,
    policy: &mut Policy<C>,
    enclave: &Enclave<GHOSTWRITER>,
    config: &EnclaveConfig<GHOSTWRITER>,
    tx_digest: vector<u8>,
    repay_amount: u64,
    withdraw_amount: u64,
    timestamp_ms: u64,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_live(pool, policy, KIND_LIQ);
    assert!(enclave.config_version() == config.version(), EStaleEnclave);
    assert!(timestamp_ms >= policy.start_ms && timestamp_ms <= policy.end_ms, EOutsideWindow);
    let att = LiquidationAttestation {
        obligation_id: policy.obligation_id,
        tx_digest,
        repay_amount,
        withdraw_amount,
    };
    assert!(enclave.verify_signature(LIQUIDATION_INTENT, timestamp_ms, att, &signature), EBadAttestation);
    pay(pool, policy, 1, tx_digest, ctx);
}

// ---------- shared payout / expiry ----------
fun pay<C>(pool: &mut Pool<C>, policy: &mut Policy<C>, path: u8, evidence: vector<u8>, ctx: &mut TxContext) {
    let amount = policy.payout;
    pool.locked = pool.locked - amount;
    pool.payouts_made = pool.payouts_made + amount;
    policy.status = STATUS_PAID;
    let c = coin::from_balance(pool.vault.split(amount), ctx);
    transfer::public_transfer(c, policy.holder);
    event::emit(PolicyPaid { policy_id: object::id(policy), holder: policy.holder, payout: amount, path, evidence });
}

public fun expire<C>(pool: &mut Pool<C>, policy: &mut Policy<C>, clock: &Clock) {
    assert!(policy.pool_id == object::id(pool), EWrongPool);
    assert!(policy.status == STATUS_ACTIVE, ENotActive);
    assert!(clock.timestamp_ms() > policy.end_ms + pool.confirm_delay_ms, ENotExpired);
    pool.locked = pool.locked - policy.payout;
    policy.status = STATUS_EXPIRED;
    event::emit(PolicyExpired { policy_id: object::id(policy) });
}

// ---------- borrower ledger anchors ----------
public fun create_ledger(_: &AdminCap, borrower: address, memwal_account: address, ctx: &mut TxContext) {
    let l = Ledger { id: object::new(ctx), borrower, memwal_account, seq: 0, head: vector[] };
    event::emit(LedgerCreated { ledger_id: object::id(&l), borrower, memwal_account });
    transfer::share_object(l);
}

public fun anchor(_: &AdminCap, ledger: &mut Ledger, seq: u64, head: vector<u8>, clock: &Clock) {
    assert!(seq == ledger.seq + 1 && head.length() == 32, EBadSeq);
    ledger.seq = seq;
    ledger.head = head;
    event::emit(Anchored { ledger_id: object::id(ledger), borrower: ledger.borrower, seq, head, at_ms: clock.timestamp_ms() });
}

// ---------- views ----------
public fun policy_status<C>(p: &Policy<C>): u8 { p.status }
public fun pool_free<C>(p: &Pool<C>): u64 { free(p) }

#[test_only]
public fun name_for_testing(): String { b"ghostwriter".to_string() }
```

> Notes for the builder: `pool.vault.join(...)` returns the new balance (`u64`, droppable) — an expression statement is fine. `report_breach` and `reset_breach` take `&Pool` (read only), `confirm_breach` / `settle_liquidation` / `expire` take `&mut Pool`.

**`move/ghostwriter/tests/ghostwriter_tests.move`**
```move
#[test_only]
module ghostwriter::ghostwriter_tests;

use ghostwriter::ghostwriter;

#[test]
fun scale_matches_e8() {
    assert!(ghostwriter::scale_to_e8(68005477, 8) == 68005477, 0);
    assert!(ghostwriter::scale_to_e8(6800, 4) == 68000000, 1);
    assert!(ghostwriter::scale_to_e8(6800547700, 10) == 68005477, 2);
}

#[test]
fun test_name() {
    assert!(ghostwriter::name_for_testing() == b"ghostwriter".to_string(), 0);
}
```

**Commands**
```bash
# 1) Nautilus clone next to the repo; publish its enclave library first (Nautilus docs, Step 11)
cd ..            # parent of the ghostwriter repo
git clone https://github.com/MystenLabs/nautilus.git
cd nautilus && git rev-parse HEAD        # write this commit hash into docs/PINS.md
cd move/enclave
sui client switch --env testnet
sui move build && sui client publish --gas-budget 500000000
# record ENCLAVE_PACKAGE_ID from the output

# 2) Our package
cd ../../../ghostwriter/move/ghostwriter
sui move build
sui move test
sui client publish --gas-budget 500000000
```
From the publish output record:
- `GHOSTWRITER_PACKAGE_ID` (Published package)
- `GHOSTWRITER_ADMIN_CAP_ID` (object type `…::ghostwriter::AdminCap`)
- `ENCLAVE_CONFIG_OBJECT_ID` (shared, type `…enclave::EnclaveConfig<…::ghostwriter::GHOSTWRITER>`)
- `ENCLAVE_CAP_ID` (owned, type `…enclave::Cap<…::ghostwriter::GHOSTWRITER>`) — needed in P7.

The publisher address must be the same as `SERVER_SUI_PRIVATE_KEY` (import it with `sui keytool import`), because the server signs with `AdminCap`.

**Exit checks**
- `sui move test` passes 2 tests.
- `sui client object $GHOSTWRITER_ADMIN_CAP_ID` shows owner = server address.
- `sui client object $ENCLAVE_CONFIG_OBJECT_ID` shows `Shared`.

**Commit:** `feat(move): P1 ghostwriter pool, policy, ledger, settlement`

---

### P2 — Backend skeleton

**Goal:** Fastify server with config validation, SQLite, event bus, error format, `GET /v1/health`, `GET /v1/events` (SSE).

**`backend/package.json`**
```json
{
  "name": "ghostwriter-backend",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/*.test.ts",
    "keys": "tsx scripts/gen-keys.ts",
    "smoke": "tsx scripts/smoke.ts",
    "pool:create": "tsx scripts/create-pool.ts",
    "pool:fund": "tsx scripts/fund-pool.ts",
    "seed": "tsx scripts/seed-backtest.ts",
    "peek:suilend": "tsx scripts/peek-suilend.ts",
    "warm:ohlcv": "tsx scripts/warm-ohlcv.ts",
    "agent": "tsx scripts/agent-buyer.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@grpc/grpc-js": "^1.14.0",
    "@mysten-incubation/memwal": "0.1.8",
    "@mysten/deepbook-v3": "^2.8.0",
    "@mysten/sui": "^2.37.0",
    "@noble/curves": "^1.9.0",
    "@noble/hashes": "^1.8.0",
    "@protobuf-ts/grpc-transport": "^2.9.4",
    "@pythnetwork/pyth-sui-js": "4.0.0",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "fastify": "^5.0.0",
    "openai": "^4.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```
Run `pnpm install` and commit `pnpm-lock.yaml`. If pnpm warns that `@mysten-incubation/memwal` is missing a peer, add exactly the one it names (`@mysten/seal@^1.1.3` or `@mysten/walrus@^1.1.7`, the README's known-good versions).

**`backend/tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "scripts", "test"]
}
```

**`backend/.gitignore`**
```
node_modules
.env
data/
*.log
```

**`backend/.env.example`**
```bash
PORT=8787
CORS_ORIGINS=http://localhost:5173
DB_PATH=./data/ghostwriter.db
ADMIN_TOKEN=change-me-to-32-random-characters-min
TATUM_API_KEY=
TATUM_RPS=3
TATUM_GRPC_MAINNET=sui-mainnet-grpc.gateway.tatum.io:443
TATUM_GRPC_TESTNET=sui-testnet-grpc.gateway.tatum.io:443
TATUM_API_BASE=https://api.tatum.io
TATUM_OHLCV_QUERY=symbol={symbol}&unix={unix}&interval=1d
SERVER_SUI_PRIVATE_KEY=
GHOSTWRITER_PACKAGE_ID=
GHOSTWRITER_POOL_ID=
GHOSTWRITER_ADMIN_CAP_ID=
COIN_TYPE=0xc028557a1ed49e42ed091e115aedefd70a442b184c18fbec5c48d5b6c0b8c184::usdc::USDC
COIN_DECIMALS=6
ENCLAVE_OBJECT_ID=
ENCLAVE_CONFIG_OBJECT_ID=
ENCLAVE_URL=
QUOTE_SIGNING_KEY_HEX=
RECORD_SIGNING_KEY_HEX=
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
MEMWAL_UNDERWRITER_ACCOUNT_ID=
MEMWAL_UNDERWRITER_KEY=
MEMWAL_BORROWER_DELEGATE_KEY=
MEMWAL_PACKAGE_ID=0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5
MEMWAL_REGISTRY_ID=0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f
PYTH_HERMES_URL=https://pyth.dourolabs.app/hermes
PYTH_API_KEY=
PYTH_STATE_ID=0x3c48fe392912de6c18087a2b3f5fdbfbfdb4598e180947feff1f12f8e9ea073e
WORMHOLE_STATE_ID=0x750da8e6d16b6a363a39fe2eaa8295ac224a1e6fce4e47b58845e2e8746164f0
FEED_SUI_USD=0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744
FEED_BTC_USD=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
SUILEND_LIQUIDATE_EVENT_TYPE=0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LiquidateEvent
SUILEND_EVENT_MODULE=0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market
SUILEND_OBLIGATION_CAP_TYPE=
OPENAI_API_KEY=
OPENAI_MODEL=
HEDGE_ENABLED=false
HEDGE_RATIO=0.5
PRICE_POLL_MS=10000
LIQ_POLL_MS=20000
PUBLIC_BASE_URL=http://localhost:8787
```

**`backend/src/config.ts`**
```ts
import 'dotenv/config';
import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex chars');
const objId = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'must be 0x-hex object id');
const optObjId = z.union([objId, z.literal('')]).default('');

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DB_PATH: z.string().default('./data/ghostwriter.db'),
  ADMIN_TOKEN: z.string().min(24),
  TATUM_API_KEY: z.string().min(8),
  TATUM_RPS: z.coerce.number().positive().default(3),
  TATUM_GRPC_MAINNET: z.string().default('sui-mainnet-grpc.gateway.tatum.io:443'),
  TATUM_GRPC_TESTNET: z.string().default('sui-testnet-grpc.gateway.tatum.io:443'),
  TATUM_API_BASE: z.string().url().default('https://api.tatum.io'),
  TATUM_OHLCV_QUERY: z.string().default('symbol={symbol}&unix={unix}&interval=1d'),
  SERVER_SUI_PRIVATE_KEY: z.string().startsWith('suiprivkey1'),
  GHOSTWRITER_PACKAGE_ID: optObjId,
  GHOSTWRITER_POOL_ID: optObjId,
  GHOSTWRITER_ADMIN_CAP_ID: optObjId,
  COIN_TYPE: z.string().includes('::'),
  COIN_DECIMALS: z.coerce.number().int().default(6),
  ENCLAVE_OBJECT_ID: optObjId,
  ENCLAVE_CONFIG_OBJECT_ID: optObjId,
  ENCLAVE_URL: z.union([z.string().url(), z.literal('')]).default(''),
  QUOTE_SIGNING_KEY_HEX: hex32,
  RECORD_SIGNING_KEY_HEX: hex32,
  MEMWAL_SERVER_URL: z.string().url().default('https://relayer.memory.walrus.xyz'),
  MEMWAL_UNDERWRITER_ACCOUNT_ID: objId,
  MEMWAL_UNDERWRITER_KEY: z.string().min(32),
  MEMWAL_BORROWER_DELEGATE_KEY: z.string().min(32),
  MEMWAL_PACKAGE_ID: objId,
  MEMWAL_REGISTRY_ID: objId,
  PYTH_HERMES_URL: z.string().url(),
  PYTH_API_KEY: z.string().min(8),
  PYTH_STATE_ID: objId,
  WORMHOLE_STATE_ID: objId,
  FEED_SUI_USD: z.string().regex(/^0x[0-9a-f]{64}$/),
  FEED_BTC_USD: z.string().regex(/^0x[0-9a-f]{64}$/),
  SUILEND_LIQUIDATE_EVENT_TYPE: z.string().includes('::'),
  SUILEND_EVENT_MODULE: z.string().includes('::'),
  SUILEND_OBLIGATION_CAP_TYPE: z.string().default(''),
  OPENAI_API_KEY: z.string().min(10),
  OPENAI_MODEL: z.string().min(1),
  HEDGE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  HEDGE_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  PRICE_POLL_MS: z.coerce.number().int().min(2000).default(10000),
  LIQ_POLL_MS: z.coerce.number().int().min(5000).default(20000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // Print names only; never print values (they may be secrets).
  console.error('Invalid environment:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  process.exit(1);
}
export const env = parsed.data;

export const ASSETS = ['SUI', 'BTC'] as const;
export type Asset = (typeof ASSETS)[number];
export const FEED_BY_ASSET: Record<Asset, string> = { SUI: env.FEED_SUI_USD, BTC: env.FEED_BTC_USD };
export const ASSET_BY_FEED: Record<string, Asset> = { [env.FEED_SUI_USD]: 'SUI', [env.FEED_BTC_USD]: 'BTC' };

export const C = {
  QUOTE_DOMAIN: 'ghostwriter.quote.v1',
  QUOTE_TTL_MS: 120_000,
  MIN_PREMIUM: 100_000n,
  PAYOUT_MIN: 1_000_000n,
  PAYOUT_MAX: 1_000_000_000n,
  LOADING: 0.15,
  MULT_MIN: 0.6,
  MULT_MAX: 3.0,
  CASE_MAX_DISTANCE: 0.35,
  NEAR_MISS_BAND: 1.03,
  WARNING_BAND: 1.05,
  RESPONSE_WINDOW_MS: 24 * 3600_000,
  MEMWAL_WRITE_GAP_MS: 3000,
  NS: {
    cases: 'ghostwriter-cases',
    rules: 'ghostwriter-rules',
    quotes: 'ghostwriter-quotes',
    policies: 'ghostwriter-policies',
    history: 'ghostwriter-history',
  },
  PREFIX: {
    record: 'GHOSTWRITER_RECORD_V1 ',
    case: 'GHOSTWRITER_CASE_V1 ',
    rule: 'GHOSTWRITER_RULE_V1 ',
    quote: 'GHOSTWRITER_QUOTE_V1 ',
    policy: 'GHOSTWRITER_POLICY_V1 ',
  },
  ZERO_ADDRESS: '0x' + '0'.repeat(64),
} as const;

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
```

**`backend/src/log.ts`**
```ts
const REDACT = /(suiprivkey1[0-9a-z]+|sk-[A-Za-z0-9_-]{10,}|[0-9a-fA-F]{64})/g;
// API keys have no fixed shape, so also hide the exact values of every secret env var.
// Read at log time (not import time) so it works whatever order dotenv and this module load in.
const SECRET_NAMES = ['TATUM_API_KEY', 'PYTH_API_KEY', 'OPENAI_API_KEY', 'MEMWAL_UNDERWRITER_KEY', 'MEMWAL_BORROWER_DELEGATE_KEY', 'SERVER_SUI_PRIVATE_KEY', 'QUOTE_SIGNING_KEY_HEX', 'RECORD_SIGNING_KEY_HEX', 'ADMIN_TOKEN'];
function clean(v: unknown): string {
  let s = (typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) ?? '';
  for (const name of SECRET_NAMES) { const secret = process.env[name]; if (secret && secret.length >= 8) s = s.split(secret).join('[redacted]'); }
  return s.replace(REDACT, '[redacted]');
}
export const log = {
  info: (msg: string, data?: unknown) => console.log(`[info] ${msg}`, data === undefined ? '' : clean(data)),
  warn: (msg: string, data?: unknown) => console.warn(`[warn] ${msg}`, data === undefined ? '' : clean(data)),
  error: (msg: string, data?: unknown) => console.error(`[error] ${msg}`, data === undefined ? '' : clean(data)),
};
```
> The redactor hides every 64-hex run, which covers raw keys **and** full object IDs. That is intentional: logs never need full IDs (the API and SSE carry them), and it guarantees a key can never leak through a log line.

**`backend/src/errors.ts`**
```ts
export type ErrorCode =
  | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'QUOTE_EXPIRED' | 'RATE_LIMITED'
  | 'CHAIN_ABORT' | 'UPSTREAM_TATUM' | 'UPSTREAM_MEMWAL' | 'UPSTREAM_ENCLAVE' | 'UPSTREAM_OPENAI' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, CONFLICT: 409, QUOTE_EXPIRED: 410,
  RATE_LIMITED: 429, CHAIN_ABORT: 422, UPSTREAM_TATUM: 502, UPSTREAM_MEMWAL: 502,
  UPSTREAM_ENCLAVE: 502, UPSTREAM_OPENAI: 502, INTERNAL: 500,
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
```

**`backend/src/util/sleep.ts`**
```ts
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

**`backend/src/util/mutex.ts`**
```ts
/** Serializes async work. Used so the server key never submits two txs at once (gas coin equivocation). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
```

**`backend/src/util/canon.ts`**
```ts
/** Deterministic JSON: object keys sorted recursively, bigint → string. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}
function sortDeep(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortDeep((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
```

**`backend/src/util/ratelimit.ts`**
```ts
import { sleep } from './sleep.js';

export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rps: number) { this.tokens = rps; }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.last) / 1000) * this.rps);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(Math.ceil(((1 - this.tokens) / this.rps) * 1000));
    }
  }
}
```

**`backend/src/db.ts`**
```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(env.DB_PATH)), { recursive: true });
export const db = new Database(env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS borrowers (
  address TEXT PRIMARY KEY, memwal_account_id TEXT NOT NULL, ledger_id TEXT, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS ledger_records (
  borrower TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL, prev TEXT NOT NULL,
  text TEXT NOT NULL, write_id INTEGER, blob_id TEXT, anchor_digest TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (borrower, seq));

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, buyer TEXT NOT NULL, kind INTEGER NOT NULL, asset TEXT NOT NULL, feed_id TEXT NOT NULL,
  strike_e8 TEXT NOT NULL, obligation_id TEXT NOT NULL, payout TEXT NOT NULL, premium TEXT NOT NULL,
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, signature TEXT NOT NULL,
  dto TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL, holder TEXT NOT NULL, kind INTEGER NOT NULL,
  asset TEXT NOT NULL, feed_id TEXT NOT NULL, strike_e8 TEXT NOT NULL, obligation_id TEXT NOT NULL,
  payout TEXT NOT NULL, premium TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  status TEXT NOT NULL, breach_started_ms INTEGER NOT NULL DEFAULT 0, buy_digest TEXT, settle_digest TEXT,
  settle_path TEXT, near_miss INTEGER NOT NULL DEFAULT 0, warned_at INTEGER, responded INTEGER NOT NULL DEFAULT 0,
  hedge_status TEXT NOT NULL DEFAULT 'none', hedge_detail TEXT, learned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS memory_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, account_id TEXT NOT NULL, namespace TEXT NOT NULL,
  text TEXT NOT NULL, purpose TEXT NOT NULL, ref TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  blob_id TEXT, error TEXT, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS rules (
  rule_id TEXT PRIMARY KEY, asset TEXT NOT NULL, vol_bucket TEXT NOT NULL, money_bucket TEXT NOT NULL,
  multiplier REAL NOT NULL, status TEXT NOT NULL, lesson TEXT NOT NULL, payouts INTEGER NOT NULL DEFAULT 0,
  quiet_expiries INTEGER NOT NULL DEFAULT 0, blob_id TEXT, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS payments (
  digest TEXT PRIMARY KEY, quote_id TEXT NOT NULL, payer TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_holder ON policies(holder);
CREATE INDEX IF NOT EXISTS idx_mw_status ON memory_writes(status, next_at);
`);

export function kvGet(key: string): string | null {
  const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function kvSet(key: string, value: string): void {
  db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
```

**`backend/src/bus.ts`**
```ts
import { EventEmitter } from 'node:events';
import { db } from './db.js';

export type BusEvent = { id: number; type: string; payload: unknown; at: number };
export const bus = new EventEmitter();
bus.setMaxListeners(1000);

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export function emit(type: string, payload: unknown): void {
  const at = Date.now();
  const info = db.prepare('INSERT INTO events(type, payload, created_at) VALUES (?, ?, ?)').run(type, toJson(payload), at);
  const ev: BusEvent = { id: Number(info.lastInsertRowid), type, payload, at };
  bus.emit('event', ev);
}

/** Non-persisted, high-frequency events (ticks). */
export function emitTransient(type: string, payload: unknown): void {
  bus.emit('event', { id: 0, type, payload, at: Date.now() } satisfies BusEvent);
}

export function eventsAfter(lastId: number, limit = 200): BusEvent[] {
  const rows = db.prepare('SELECT id, type, payload, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT ?').all(lastId, limit) as
    Array<{ id: number; type: string; payload: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), at: r.created_at }));
}
```

**`backend/src/routes/events.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { bus, eventsAfter, type BusEvent } from '../bus.js';
import { corsOrigins } from '../config.js';

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export async function eventRoutes(app: FastifyInstance) {
  app.get('/v1/events', (req, reply) => {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (origin && corsOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    reply.hijack();
    reply.raw.writeHead(200, headers);

    const write = (ev: BusEvent) => {
      const idLine = ev.id ? `id: ${ev.id}\n` : '';
      reply.raw.write(`${idLine}event: ${ev.type}\ndata: ${toJson(ev.payload)}\n\n`);
    };

    const lastIdHeader = req.headers['last-event-id'];
    const lastId = Number(Array.isArray(lastIdHeader) ? lastIdHeader[0] : lastIdHeader ?? 0);
    if (Number.isFinite(lastId) && lastId > 0) for (const ev of eventsAfter(lastId)) write(ev);

    bus.on('event', write);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', write);
    });
  });
}
```

**`backend/src/state.ts`** (shared worker status; its own module so workers never import route files — avoids ESM import cycles)
```ts
export const workerState: Record<string, string> = {
  priceWatcher: 'stopped', liquidationWatcher: 'stopped', checkpointPulse: 'stopped', memoryQueue: 'stopped', hedger: 'disabled',
};
```

**`backend/src/routes/meta.ts`** (health only in P2; `config`, `market`, `proof` are added in P5 — this is the P2 version, replaced in P5)
```ts
import type { FastifyInstance } from 'fastify';
import { workerState } from '../state.js';

const started = Date.now();

export async function metaRoutes(app: FastifyInstance) {
  app.get('/v1/health', async () => ({ ok: true, version: '1.0.0', uptimeS: Math.round((Date.now() - started) / 1000), workers: workerState }));
}
```

**`backend/src/server.ts`** (P2 version; replaced in P9 with the final one)
```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env, corsOrigins } from './config.js';
import { AppError } from './errors.js';
import { log } from './log.js';
import { metaRoutes } from './routes/meta.js';
import { eventRoutes } from './routes/events.js';

const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
await app.register(cors, { origin: corsOrigins, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['content-type', 'x-payment', 'x-admin-token', 'last-event-id'], exposedHeaders: ['x-payment-response'] });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) return reply.status(err.status).send(err.toBody());
  if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'invalid request', details: { issues: err.issues } } });
  log.error('unhandled', { message: err.message });
  return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error', details: {} } });
});

await app.register(metaRoutes);
await app.register(eventRoutes);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
log.info(`ghostwriter backend on :${env.PORT}`);
```

**`backend/scripts/gen-keys.ts`**
```ts
// Generates the backend's signing keys and the borrower delegate key. Prints to stdout ONCE; paste into .env.
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { generateDelegateKey } from '@mysten-incubation/memwal/account';

const quote = randomBytes(32);
const record = randomBytes(32);
const delegate = await generateDelegateKey();

console.log('# --- paste into backend/.env (secrets) ---');
console.log(`QUOTE_SIGNING_KEY_HEX=${quote.toString('hex')}`);
console.log(`RECORD_SIGNING_KEY_HEX=${record.toString('hex')}`);
console.log(`MEMWAL_BORROWER_DELEGATE_KEY=${delegate.privateKey}`);
console.log('# --- public values (safe to share) ---');
console.log(`quote pubkey hex:   ${bytesToHex(ed25519.getPublicKey(quote))}`);
console.log(`record pubkey hex:  ${bytesToHex(ed25519.getPublicKey(record))}`);
console.log(`borrower delegate pubkey hex: ${bytesToHex(delegate.publicKey)}`);
console.log(`borrower delegate sui address: ${delegate.suiAddress}`);
```

**Commands**
```bash
cd backend
pnpm install
pnpm install                     # versions are pinned in package.json (OPEN-1, OPEN-3 resolved)
cp .env.example .env
pnpm keys          # paste output into .env
pnpm typecheck
pnpm dev
curl -s localhost:8787/v1/health
curl -N localhost:8787/v1/events     # stays open, prints ": ping" every 15 s
```

**Exit checks**
- `pnpm typecheck` clean. `GET /v1/health` → `{ ok: true, … }`.
- SSE prints `: ping` within 15 s; closing curl does not crash the server.
- Starting with a missing `TATUM_API_KEY` prints `Invalid environment: TATUM_API_KEY: …` and exits (no secret values printed).

**Commit:** `feat(backend): P2 skeleton, config, sqlite, sse`

---

### P3 — Chain layer (Tatum gRPC, Pyth, object readers, tx builders) + pool scripts + smoke test

**Goal:** typed, rate-limited access to Mainnet and Testnet through Tatum; server transactions serialized; Pool created and funded.

**`backend/src/chain/clients.ts`**
```ts
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { env } from '../config.js';
import { TokenBucket } from '../util/ratelimit.js';
import { sleep } from '../util/sleep.js';
import { Mutex } from '../util/mutex.js';
import { AppError, chainAbort } from '../errors.js';

/** Native gRPC over HTTP/2 to Tatum, x-api-key as gRPC metadata (Tatum + Mysten SDK docs). */
function tatumGrpc(network: 'mainnet' | 'testnet', host: string) {
  const transport = new GrpcTransport({
    host,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': env.TATUM_API_KEY },
  });
  return new SuiGrpcClient({ network, transport });
}

export const mainnet = tatumGrpc('mainnet', env.TATUM_GRPC_MAINNET);
export const testnet = tatumGrpc('testnet', env.TATUM_GRPC_TESTNET);
export const serverKeypair = Ed25519Keypair.fromSecretKey(env.SERVER_SUI_PRIVATE_KEY);
export const serverAddress = serverKeypair.toSuiAddress();

const bucket = new TokenBucket(env.TATUM_RPS);
const RETRYABLE = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']);

function grpcCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && (e as { name?: string }).name === 'RpcError') {
    return String((e as { code: unknown }).code);
  }
  return null;
}

/** Every Tatum call goes through here: paced to TATUM_RPS, retried on transient gRPC codes. */
export async function tatum<T>(fn: () => Promise<T>, label = 'tatum', retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await bucket.take();
    try {
      return await fn();
    } catch (e) {
      const code = grpcCode(e);
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      if (e instanceof AppError) throw e;
      if (code === 'NOT_FOUND') throw new AppError('NOT_FOUND', `${label}: not found (pruned or wrong id)`, { code });
      if (code === 'RESOURCE_EXHAUSTED') throw new AppError('RATE_LIMITED', `${label}: Tatum rate limit`, { code });
      if (code) throw new AppError('UPSTREAM_TATUM', `${label}: ${code}`, { code });
      throw e;
    }
  }
}

export async function txObjectTypes(client: SuiGrpcClient, digest: string): Promise<Record<string, string>> {
  const r = await tatum(() => client.getTransaction({ digest, include: { effects: true, objectTypes: true } }), 'getTransaction');
  const t = r.Transaction ?? r.FailedTransaction;
  return ((t as unknown as { objectTypes?: Record<string, string> }).objectTypes) ?? {};
}

export function idsOfType(types: Record<string, string>, needle: string): string[] {
  return Object.entries(types).filter(([, ty]) => ty.includes(needle)).map(([id]) => id);
}

const serverTx = new Mutex();

/** Signs with the server key on Testnet. Serialized; never retried (execution is not idempotent from our side). */
export async function execServer(tx: Transaction, label: string): Promise<{ digest: string; objectTypes: Record<string, string> }> {
  return serverTx.run(async () => {
    let result;
    try {
      result = await tatum(() => serverKeypair.signAndExecuteTransaction({ transaction: tx, client: testnet }), label, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg)) throw chainAbort(msg);
      throw e;
    }
    const t = result.Transaction ?? result.FailedTransaction;
    if (!t.status.success) throw chainAbort(t.status.error?.message ?? `${label} failed`);
    await tatum(() => testnet.waitForTransaction({ digest: t.digest }), `${label}:wait`);
    const objectTypes = await txObjectTypes(testnet, t.digest);
    return { digest: t.digest, objectTypes };
  });
}
```

**`backend/src/chain/pyth.ts`**
```ts
import { SuiPythClient, SuiPriceServiceConnection } from '@pythnetwork/pyth-sui-js';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import type { Transaction } from '@mysten/sui/transactions';
import { env } from '../config.js';
import { AppError } from '../errors.js';

/**
 * pyth-sui-js 4.0.0 accepts any client with the `.core` API (SuiJsonRpcClient or SuiGrpcClient) — OPEN-3.
 * We give it the public Testnet fullnode for its read-only object lookups, so those reads don't eat the Tatum RPS budget.
 * If the public JSON-RPC ever fails, pass `testnet` from ./clients.js instead (Tatum gRPC).
 * All execution still goes through Tatum (execServer).
 */
const pythRpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const pythClient = new SuiPythClient(pythRpc, env.PYTH_STATE_ID, env.WORMHOLE_STATE_ID);
/** Hermes needs the Pyth API key since Aug 2026; HermesClient sends it as `Authorization: Bearer`. */
const hermes = new SuiPriceServiceConnection(env.PYTH_HERMES_URL, { accessToken: env.PYTH_API_KEY, timeout: 8000 });

const strip = (id: string) => id.toLowerCase().replace(/^0x/, '');

/** Adds the Pyth update calls for one feed to `tx`; returns the PriceInfoObject id to pass to our Move call. */
export async function addPriceUpdate(tx: Transaction, feedId: string): Promise<string> {
  const updateData = await hermes.getPriceFeedsUpdateData([feedId]);
  const ids = await pythClient.updatePriceFeeds(tx, updateData, [feedId]);
  if (!ids?.[0]) throw new AppError('UPSTREAM_TATUM', 'pyth: no PriceInfoObject for feed', { feedId });
  return ids[0];
}

export type Spot = { feedId: string; priceE8: bigint; spotUsd: number; publishMs: number };

function toE8(price: bigint, expo: number): bigint {
  const neg = -expo;
  if (neg === 8) return price;
  if (neg < 8) return price * 10n ** BigInt(8 - neg);
  return price / 10n ** BigInt(neg - 8);
}

/** Hermes v2 REST (shape confirmed, OPEN-4). Only this function knows the shape. */
export async function hermesLatest(feedIds: string[]): Promise<Map<string, Spot>> {
  const qs = feedIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  const res = await fetch(`${env.PYTH_HERMES_URL}/v2/updates/price/latest?${qs}&parsed=true`, {
    headers: { authorization: `Bearer ${env.PYTH_API_KEY}` }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new AppError('UPSTREAM_TATUM', `hermes: HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (check PYTH_API_KEY)' : ''}`);
  const body = (await res.json()) as { parsed?: Array<{ id: string; price: { price: string; expo: number; publish_time: number } }> };
  const out = new Map<string, Spot>();
  for (const p of body.parsed ?? []) {
    const feedId = '0x' + strip(p.id);
    const raw = BigInt(p.price.price);
    const expo = Number(p.price.expo);
    out.set(feedId, { feedId, priceE8: toE8(raw, expo), spotUsd: Number(raw) * 10 ** expo, publishMs: Number(p.price.publish_time) * 1000 });
  }
  for (const id of feedIds) if (!out.has('0x' + strip(id))) throw new AppError('UPSTREAM_TATUM', 'hermes: feed missing in response', { id });
  return out;
}
```

**`backend/src/chain/objects.ts`**
```ts
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { testnet, tatum } from './clients.js';
import { env } from '../config.js';
import { AppError } from '../errors.js';

const PoolBcs = bcs.struct('Pool', {
  id: bcs.Address,
  vault: bcs.struct('Balance', { value: bcs.u64() }),
  locked: bcs.u64(),
  quote_pubkey: bcs.vector(bcs.u8()),
  premiums_collected: bcs.u64(),
  payouts_made: bcs.u64(),
  confirm_delay_ms: bcs.u64(),
  max_conf_bps: bcs.u64(),
  max_price_age_s: bcs.u64(),
  paused: bcs.bool(),
  used_quotes: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
});

const PolicyBcs = bcs.struct('Policy', {
  id: bcs.Address,
  pool_id: bcs.Address,
  holder: bcs.Address,
  kind: bcs.u8(),
  feed_id: bcs.vector(bcs.u8()),
  strike_e8: bcs.u64(),
  obligation_id: bcs.Address,
  payout: bcs.u64(),
  premium: bcs.u64(),
  start_ms: bcs.u64(),
  end_ms: bcs.u64(),
  quote_id: bcs.vector(bcs.u8()),
  status: bcs.u8(),
  breach_started_ms: bcs.u64(),
});

const LedgerBcs = bcs.struct('Ledger', {
  id: bcs.Address,
  borrower: bcs.Address,
  memwal_account: bcs.Address,
  seq: bcs.u64(),
  head: bcs.vector(bcs.u8()),
});

const hex = (b: number[]) => Buffer.from(b).toString('hex');

async function content(objectId: string): Promise<{ type: string; bytes: Uint8Array }> {
  const { object } = await tatum(() => testnet.getObject({ objectId, include: { content: true } }), 'getObject');
  if (!object.content) throw new AppError('NOT_FOUND', 'object has no content', { objectId });
  return { type: object.type, bytes: object.content };
}

export type PoolState = {
  vault: bigint; locked: bigint; free: bigint; quotePubkeyHex: string; premiumsCollected: bigint; payoutsMade: bigint;
  confirmDelayMs: number; maxConfBps: number; maxPriceAgeS: number; paused: boolean;
};
export async function readPool(): Promise<PoolState> {
  const { type, bytes } = await content(env.GHOSTWRITER_POOL_ID);
  if (!type.includes('::ghostwriter::Pool<')) throw new AppError('INTERNAL', 'GHOSTWRITER_POOL_ID is not a Pool', { type });
  const p = PoolBcs.parse(bytes);
  const vault = BigInt(p.vault.value);
  const locked = BigInt(p.locked);
  return {
    vault, locked, free: vault - locked, quotePubkeyHex: hex(p.quote_pubkey),
    premiumsCollected: BigInt(p.premiums_collected), payoutsMade: BigInt(p.payouts_made),
    confirmDelayMs: Number(p.confirm_delay_ms), maxConfBps: Number(p.max_conf_bps), maxPriceAgeS: Number(p.max_price_age_s), paused: p.paused,
  };
}

export type PolicyState = {
  id: string; poolId: string; holder: string; kind: 0 | 1; feedId: string; strikeE8: bigint; obligationId: string;
  payout: bigint; premium: bigint; startMs: number; endMs: number; quoteId: string; status: 0 | 1 | 2; breachStartedMs: number;
};
export async function readPolicy(objectId: string): Promise<PolicyState> {
  const { type, bytes } = await content(objectId);
  if (!type.includes('::ghostwriter::Policy<')) throw new AppError('NOT_FOUND', 'not a Policy object', { objectId });
  const p = PolicyBcs.parse(bytes);
  return {
    id: normalizeSuiAddress(p.id), poolId: normalizeSuiAddress(p.pool_id), holder: normalizeSuiAddress(p.holder),
    kind: p.kind as 0 | 1, feedId: '0x' + hex(p.feed_id), strikeE8: BigInt(p.strike_e8),
    obligationId: normalizeSuiAddress(p.obligation_id), payout: BigInt(p.payout), premium: BigInt(p.premium),
    startMs: Number(p.start_ms), endMs: Number(p.end_ms), quoteId: hex(p.quote_id),
    status: p.status as 0 | 1 | 2, breachStartedMs: Number(p.breach_started_ms),
  };
}

export type LedgerState = { id: string; borrower: string; memwalAccount: string; seq: number; headHex: string };
export async function readLedger(objectId: string): Promise<LedgerState> {
  const { type, bytes } = await content(objectId);
  if (!type.includes('::ghostwriter::Ledger')) throw new AppError('NOT_FOUND', 'not a Ledger object', { objectId });
  const l = LedgerBcs.parse(bytes);
  return { id: normalizeSuiAddress(l.id), borrower: normalizeSuiAddress(l.borrower), memwalAccount: normalizeSuiAddress(l.memwal_account), seq: Number(l.seq), headHex: hex(l.head) };
}
```

**`backend/src/chain/ghostwriterTx.ts`**
```ts
import { Transaction } from '@mysten/sui/transactions';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../config.js';
import { addPriceUpdate } from './pyth.js';
import { execServer, idsOfType } from './clients.js';
import { AppError } from '../errors.js';

const T = () => `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter`;
const bytes = (hex: string) => Array.from(hexToBytes(hex.replace(/^0x/, '')));

async function priceCall(fn: 'report_breach' | 'reset_breach' | 'confirm_breach', policyId: string, feedId: string) {
  const tx = new Transaction();
  const pio = await addPriceUpdate(tx, feedId);
  tx.moveCall({
    target: `${T()}::${fn}`,
    typeArguments: [env.COIN_TYPE],
    arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(policyId), tx.object(pio), tx.object.clock()],
  });
  return execServer(tx, fn);
}

export const reportBreach = (policyId: string, feedId: string) => priceCall('report_breach', policyId, feedId);
export const resetBreach = (policyId: string, feedId: string) => priceCall('reset_breach', policyId, feedId);
export const confirmBreach = (policyId: string, feedId: string) => priceCall('confirm_breach', policyId, feedId);

export async function expirePolicy(policyId: string) {
  const tx = new Transaction();
  tx.moveCall({ target: `${T()}::expire`, typeArguments: [env.COIN_TYPE], arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(policyId), tx.object.clock()] });
  return execServer(tx, 'expire');
}

export async function settleLiquidation(args: {
  policyId: string; txDigest: string; repayAmount: bigint; withdrawAmount: bigint; timestampMs: number; signatureHex: string;
}) {
  if (!env.ENCLAVE_OBJECT_ID || !env.ENCLAVE_CONFIG_OBJECT_ID) throw new AppError('UPSTREAM_ENCLAVE', 'enclave not registered (ENCLAVE_OBJECT_ID empty)');
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::settle_liquidation`,
    typeArguments: [env.COIN_TYPE],
    arguments: [
      tx.object(env.GHOSTWRITER_POOL_ID),
      tx.object(args.policyId),
      tx.object(env.ENCLAVE_OBJECT_ID),
      tx.object(env.ENCLAVE_CONFIG_OBJECT_ID),
      tx.pure.vector('u8', Array.from(Buffer.from(args.txDigest, 'utf8'))),
      tx.pure.u64(args.repayAmount),
      tx.pure.u64(args.withdrawAmount),
      tx.pure.u64(args.timestampMs),
      tx.pure.vector('u8', bytes(args.signatureHex)),
    ],
  });
  return execServer(tx, 'settle_liquidation');
}

export async function createLedger(borrower: string, memwalAccount: string): Promise<{ ledgerId: string; digest: string }> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::create_ledger`,
    arguments: [tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.pure.address(borrower), tx.pure.address(memwalAccount)],
  });
  const r = await execServer(tx, 'create_ledger');
  const [ledgerId] = idsOfType(r.objectTypes, '::ghostwriter::Ledger');
  if (!ledgerId) throw new AppError('INTERNAL', 'create_ledger: Ledger not found in effects', { digest: r.digest });
  return { ledgerId, digest: r.digest };
}

export async function anchor(ledgerId: string, seq: number, headHex: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::anchor`,
    arguments: [tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.object(ledgerId), tx.pure.u64(seq), tx.pure.vector('u8', bytes(headHex)), tx.object.clock()],
  });
  return execServer(tx, 'anchor');
}

export async function setPaused(paused: boolean) {
  const tx = new Transaction();
  tx.moveCall({ target: `${T()}::set_paused`, typeArguments: [env.COIN_TYPE], arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.pure.bool(paused)] });
  return execServer(tx, 'set_paused');
}
```

**`backend/scripts/create-pool.ts`**
```ts
// Usage: pnpm pool:create [confirmDelayMs=120000]
import { Transaction } from '@mysten/sui/transactions';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../src/config.js';
import { execServer, idsOfType } from '../src/chain/clients.js';

const confirmDelayMs = Number(process.argv[2] ?? 120000);
const quotePub = ed25519.getPublicKey(hexToBytes(env.QUOTE_SIGNING_KEY_HEX));
const tx = new Transaction();
tx.moveCall({
  target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::create_pool`,
  typeArguments: [env.COIN_TYPE],
  arguments: [
    tx.object(env.GHOSTWRITER_ADMIN_CAP_ID),
    tx.pure.vector('u8', Array.from(quotePub)),
    tx.pure.u64(confirmDelayMs),
    tx.pure.u64(200),   // max_conf_bps = 2%
    tx.pure.u64(60),    // max_price_age_s
  ],
});
const r = await execServer(tx, 'create_pool');
console.log('digest', r.digest);
console.log('GHOSTWRITER_POOL_ID=' + idsOfType(r.objectTypes, '::ghostwriter::Pool<')[0]);
```

**`backend/scripts/fund-pool.ts`**
```ts
// Usage: pnpm pool:fund <amount DUSDC, e.g. 500>
import { Transaction } from '@mysten/sui/transactions';
import { env } from '../src/config.js';
import { execServer, serverAddress, testnet, tatum } from '../src/chain/clients.js';

const amount = BigInt(Math.round(Number(process.argv[2] ?? '0') * 10 ** env.COIN_DECIMALS));
if (amount <= 0n) throw new Error('give an amount, e.g. pnpm pool:fund 500');
const page = await tatum(() => testnet.listCoins({ owner: serverAddress, coinType: env.COIN_TYPE, limit: 50 }));
const coins = page.objects;
if (coins.length === 0) throw new Error('server address holds no DUSDC (P0 step 4)');
const tx = new Transaction();
const primary = tx.object(coins[0].objectId);
if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c) => tx.object(c.objectId)));
const [part] = tx.splitCoins(primary, [amount]);
tx.moveCall({
  target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::deposit`,
  typeArguments: [env.COIN_TYPE],
  arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), part],
});
const r = await execServer(tx, 'deposit');
console.log('funded', amount.toString(), 'digest', r.digest);
```

**`backend/scripts/smoke.ts`** (run after P3; it also confirms the feed ids, prints one real OHLCV body, and settles OPEN-10/OPEN-12)
```ts
import OpenAI from 'openai';
import { MemWal } from '@mysten-incubation/memwal';
import { env } from '../src/config.js';
import { mainnet, testnet, tatum, serverAddress } from '../src/chain/clients.js';
import { hermesLatest } from '../src/chain/pyth.js';

const ok = (name: string, v: unknown) => console.log(`✔ ${name}`, v ?? '');
const bad = (name: string, e: unknown) => console.log(`✘ ${name}`, e instanceof Error ? e.message : e);

try { const { object } = await tatum(() => mainnet.getObject({ objectId: '0x6' })); ok('tatum mainnet gRPC getObject(0x6)', object.type); } catch (e) { bad('tatum mainnet', e); }
try { const { object } = await tatum(() => testnet.getObject({ objectId: '0x6' })); ok('tatum testnet gRPC getObject(0x6)', object.type); } catch (e) { bad('tatum testnet', e); }
try { const { balance } = await tatum(() => testnet.getBalance({ owner: serverAddress, coinType: env.COIN_TYPE })); ok('server DUSDC', balance.balance); } catch (e) { bad('server DUSDC', e); }
try { const m = await hermesLatest([env.FEED_SUI_USD, env.FEED_BTC_USD]); ok('hermes', [...m.values()].map((s) => [s.feedId.slice(0, 10), s.spotUsd])); } catch (e) { bad('hermes (OPEN-4)', e); }
try {
  // Confirms FEED_BTC_USD / FEED_SUI_USD are the ids Hermes knows (OPEN-4).
  for (const sym of ['BTC', 'SUI']) {
    const r = await fetch(`${env.PYTH_HERMES_URL}/v2/price_feeds?query=${sym}&asset_type=crypto`, { headers: { authorization: `Bearer ${env.PYTH_API_KEY}` } });
    const list = (await r.json()) as Array<{ id: string; attributes?: { symbol?: string } }>;
    ok(`hermes feeds ${sym}/USD`, list.filter((f) => f.attributes?.symbol === `Crypto.${sym}/USD`).map((f) => '0x' + f.id));
  }
} catch (e) { bad('hermes price_feeds', e); }
try {
  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 86_400_000;
  const q = env.TATUM_OHLCV_QUERY.replace('{symbol}', 'SUI').replace('{unix}', String(day));
  const res = await fetch(`${env.TATUM_API_BASE}/v4/data/rate/symbol/OHLCV?${q}`, { headers: { 'x-api-key': env.TATUM_API_KEY } });
  ok(`tatum OHLCV HTTP ${res.status} body:`, (await res.text()).slice(0, 400));
} catch (e) { bad('tatum OHLCV', e); }
try {
  const m = MemWal.create({ key: env.MEMWAL_UNDERWRITER_KEY, accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL });
  ok('memwal health', await m.health());
  ok('memwal signed call listNamespaces', (await m.listNamespaces({ limit: 5 })).namespaces.map((n) => n.name));
} catch (e) { bad('memwal (delegate key / account id?)', e); }
try {
  const c = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const r = await c.chat.completions.create({ model: env.OPENAI_MODEL, messages: [{ role: 'user', content: 'Reply with OK' }] });
  ok('openai', r.choices[0]?.message?.content);
} catch (e) { bad('openai (OPEN-12)', e); }
```

**Commands**
```bash
pnpm smoke
pnpm pool:create 120000          # demo confirm delay = 2 minutes; copy GHOSTWRITER_POOL_ID into .env
pnpm pool:fund 500
pnpm smoke
```

**Exit checks**
- Smoke: both Tatum gRPC lines ✔; hermes ✔ with SUI ≈ market price; `hermes feeds BTC/USD` and `SUI/USD` each print the same id as your `.env` (if not, copy the printed id into `.env`); OHLCV prints HTTP 200 and a body with a close price (if the close field is not one of `close`/`c`/`Close`/`closePrice`, add its name in `vol.ts` `num(...)`); memwal ✔ both lines; openai ✔.
- `sui client object $GHOSTWRITER_POOL_ID` → shared `Pool<…USDC>`, vault 500000000.

**Commit:** `feat(backend): P3 tatum chain layer, pyth, pool scripts`

---

### P4 — Walrus Memory layer: queue, borrower records, onboarding

**Goal:** paced, retried Mainnet writes; signed hash-chained borrower records anchored on-chain; `PUT/GET /v1/borrowers…`.

**`backend/src/memory/client.ts`**
```ts
import { MemWal } from '@mysten-incubation/memwal';
import { env, C } from '../config.js';
import { AppError } from '../errors.js';
import { sleep } from '../util/sleep.js';

export type Mem = ReturnType<typeof MemWal.create>;

export const underwriter: Mem = MemWal.create({
  key: env.MEMWAL_UNDERWRITER_KEY,
  accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
  serverUrl: env.MEMWAL_SERVER_URL,
  namespace: C.NS.cases,
});

const borrowerClients = new Map<string, Mem>();
/** One delegate key (ours) is registered by each borrower on THEIR account. */
export function borrowerMem(accountId: string): Mem {
  let m = borrowerClients.get(accountId);
  if (!m) {
    m = MemWal.create({ key: env.MEMWAL_BORROWER_DELEGATE_KEY, accountId, serverUrl: env.MEMWAL_SERVER_URL, namespace: C.NS.history });
    borrowerClients.set(accountId, m);
  }
  return m;
}

export function memFor(account: string, accountId: string): Mem {
  return account === 'underwriter' ? underwriter : borrowerMem(accountId);
}

export const memStatus = (e: unknown): number | undefined =>
  e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : undefined;

/** Recall right after a write can fail for ~20 s (MemWal issue #1120); retry reads. */
export async function withMemRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const s = memStatus(e);
      if (s === 401) throw new AppError('CONFLICT', `${label}: delegate key not registered on this account`, { reason: 'DELEGATE_NOT_REGISTERED' });
      await sleep(1500 * (i + 1));
    }
  }
  throw new AppError('UPSTREAM_MEMWAL', `${label}: ${last instanceof Error ? last.message : String(last)}`, { status: memStatus(last) ?? null });
}

export type RecallHit = { blob_id: string; text: string; distance: number; created_at?: string };

export async function recall(mem: Mem, namespace: string, query: string, limit: number, sort?: 'relevance' | 'recent'): Promise<RecallHit[]> {
  const r = await withMemRetry(() => mem.recall({ query, limit, namespace, ...(sort ? { sort } : {}) }), `recall:${namespace}`);
  return r.results as RecallHit[];
}

export type MemMeta = { memory_id: string; blob_id: string; created_at: string; end_epoch: number | null; expires_at: string | null };

/** Exact listing (metadata only). Paginates on has_more; restarts once on must_resync. */
export async function listAll(mem: Mem, namespace: string, max = 2000): Promise<MemMeta[]> {
  const out: MemMeta[] = [];
  let cursor: string | undefined;
  let resynced = false;
  for (let guard = 0; guard < 50 && out.length < max; guard++) {
    const page = await withMemRetry(() => mem.listMemories({ cursor, namespace, limit: 500 }), `list:${namespace}`);
    if (page.must_resync && !resynced) { resynced = true; cursor = undefined; out.length = 0; continue; }
    for (const m of page.memories) if (m.namespace_id === namespace) out.push(m as MemMeta);
    if (!page.has_more) break;
    cursor = page.next_cursor ?? undefined;
  }
  return out;
}
```

**`backend/src/memory/queue.ts`**
```ts
import { db } from '../db.js';
import { C } from '../config.js';
import { emit } from '../bus.js';
import { log } from '../log.js';
import { memFor, memStatus } from './client.js';
import { workerState } from '../state.js';

export type WriteRow = {
  id: number; account: string; account_id: string; namespace: string; text: string; purpose: string; ref: string | null;
  status: string; attempts: number; blob_id: string | null; error: string | null; next_at: number;
};
type Hook = (row: WriteRow & { blob_id: string }) => Promise<void> | void;
const hooks: Array<{ prefix: string; fn: Hook }> = [];

export function onMemoryWritten(purposePrefix: string, fn: Hook) { hooks.push({ prefix: purposePrefix, fn }); }

export function enqueueMemory(input: { account: string; accountId: string; namespace: string; text: string; purpose: string; ref?: string }): number {
  if (input.text.length > 4000) throw new Error('memory text too long (>4000 chars)');
  const now = Date.now();
  const info = db.prepare(`INSERT INTO memory_writes(account, account_id, namespace, text, purpose, ref, status, attempts, next_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`).run(input.account, input.accountId, input.namespace, input.text, input.purpose, input.ref ?? null, now, now, now);
  const id = Number(info.lastInsertRowid);
  emit('memory.queued', { id, account: input.account, namespace: input.namespace, purpose: input.purpose });
  return id;
}

const lastWriteAt = new Map<string, number>();
let running = false;

async function processOne(): Promise<boolean> {
  const now = Date.now();
  const rows = db.prepare(`SELECT * FROM memory_writes WHERE status = 'queued' AND next_at <= ? ORDER BY id ASC LIMIT 20`).all(now) as WriteRow[];
  const row = rows.find((r) => now - (lastWriteAt.get(r.account_id) ?? 0) >= C.MEMWAL_WRITE_GAP_MS);
  if (!row) return false;
  db.prepare(`UPDATE memory_writes SET status='writing', attempts=attempts+1, updated_at=? WHERE id=?`).run(now, row.id);
  lastWriteAt.set(row.account_id, now);
  try {
    const res = await memFor(row.account, row.account_id).rememberAndWait(row.text, row.namespace);
    db.prepare(`UPDATE memory_writes SET status='done', blob_id=?, error=NULL, updated_at=? WHERE id=?`).run(res.blob_id, Date.now(), row.id);
    emit('memory.written', { id: row.id, account: row.account, namespace: row.namespace, purpose: row.purpose, blobId: res.blob_id });
    for (const h of hooks) if (row.purpose.startsWith(h.prefix)) {
      try { await h.fn({ ...row, blob_id: res.blob_id }); } catch (e) { log.error('memory hook failed', { purpose: row.purpose, message: (e as Error).message }); }
    }
  } catch (e) {
    const attempts = row.attempts + 1;
    const status = memStatus(e);
    const fatal = status === 401 || status === 400 || attempts >= 6;
    const backoff = Math.min(300_000, 5000 * 2 ** attempts);
    db.prepare(`UPDATE memory_writes SET status=?, error=?, next_at=?, updated_at=? WHERE id=?`)
      .run(fatal ? 'failed' : 'queued', (e as Error).message?.slice(0, 500) ?? 'error', Date.now() + backoff, Date.now(), row.id);
    if (fatal) emit('memory.failed', { id: row.id, account: row.account, namespace: row.namespace, purpose: row.purpose, error: (e as Error).message });
    else log.warn('memory write retry', { id: row.id, attempts, status });
  }
  return true;
}

export function startMemoryWorker() {
  if (running) return;
  running = true;
  // Crash recovery: rows left 'writing' go back to the queue (a duplicate write is harmless; records dedupe by seq+hash).
  db.prepare(`UPDATE memory_writes SET status='queued' WHERE status='writing'`).run();
  workerState.memoryQueue = 'running';
  const loop = async () => {
    try { const did = await processOne(); setTimeout(loop, did ? 50 : 1000); }
    catch (e) { log.error('memory worker', { message: (e as Error).message }); setTimeout(loop, 2000); }
  };
  void loop();
}

export function writesSummary(limit: number) {
  const items = db.prepare(`SELECT id, account, namespace, purpose, status, blob_id, error, created_at FROM memory_writes ORDER BY id DESC LIMIT ?`).all(limit) as
    Array<{ id: number; account: string; namespace: string; purpose: string; status: string; blob_id: string | null; error: string | null; created_at: number }>;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM memory_writes`).get() as { n: number }).n;
  const done = (db.prepare(`SELECT COUNT(*) AS n FROM memory_writes WHERE status='done'`).get() as { n: number }).n;
  return {
    total, done,
    items: items.map((r) => ({ id: r.id, account: r.account, namespace: r.namespace, purpose: r.purpose, status: r.status, blobId: r.blob_id, error: r.error, createdAt: r.created_at })),
  };
}
```

**`backend/src/memory/records.ts`**
```ts
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { db } from '../db.js';
import { env, C } from '../config.js';
import { canonical } from '../util/canon.js';
import { enqueueMemory, onMemoryWritten } from './queue.js';
import { borrowerMem, recall, listAll } from './client.js';
import { anchor } from '../chain/ghostwriterTx.js';
import { readLedger } from '../chain/objects.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export type RecordKind = 'onboarded' | 'policy_bought' | 'warning' | 'response' | 'payout' | 'expired';
type Body = { v: 1; borrower: string; seq: number; prev: string; kind: RecordKind; at: number; data: Record<string, unknown>; evidence: string[] };
export type Parsed = Body & { hash: string; sig: string; pub: string };

const recordPriv = hexToBytes(env.RECORD_SIGNING_KEY_HEX);
export const recordPubHex = bytesToHex(ed25519.getPublicKey(recordPriv));
const GENESIS = '0'.repeat(64);

function hashBody(b: Body): string {
  return bytesToHex(sha256(utf8ToBytes(canonical(b))));
}

export function buildRecord(b: Body): { hash: string; text: string } {
  const hash = hashBody(b);
  const sig = bytesToHex(ed25519.sign(hexToBytes(hash), recordPriv));
  return { hash, text: C.PREFIX.record + JSON.stringify({ ...b, hash, sig, pub: recordPubHex }) };
}

export function parseRecord(text: string): Parsed | null {
  if (!text.startsWith(C.PREFIX.record)) return null;
  try { return JSON.parse(text.slice(C.PREFIX.record.length)) as Parsed; } catch { return null; }
}

export function checkRecord(r: Parsed, trustedPubHex: string): { hashOk: boolean; sigOk: boolean } {
  const { hash, sig, pub, ...body } = r;
  const hashOk = hashBody(body as Body) === hash;
  let sigOk = false;
  try { sigOk = pub === trustedPubHex && ed25519.verify(hexToBytes(sig), hexToBytes(hash), hexToBytes(pub)); } catch { sigOk = false; }
  return { hashOk, sigOk };
}

type BorrowerRow = { address: string; memwal_account_id: string; ledger_id: string | null };
export function getBorrower(address: string): BorrowerRow | undefined {
  return db.prepare('SELECT address, memwal_account_id, ledger_id FROM borrowers WHERE address = ?').get(address) as BorrowerRow | undefined;
}

/** Appends a signed, chained record and queues its Mainnet write. No-op for unregistered borrowers. */
export function appendRecord(borrower: string, kind: RecordKind, data: Record<string, unknown>, evidence: string[] = []): { seq: number; hash: string } | null {
  const b = getBorrower(borrower);
  if (!b) return null;
  const tx = db.transaction(() => {
    const last = db.prepare('SELECT seq, hash FROM ledger_records WHERE borrower = ? ORDER BY seq DESC LIMIT 1').get(borrower) as { seq: number; hash: string } | undefined;
    const body: Body = { v: 1, borrower, seq: (last?.seq ?? 0) + 1, prev: last?.hash ?? GENESIS, kind, at: Date.now(), data, evidence };
    const { hash, text } = buildRecord(body);
    db.prepare(`INSERT INTO ledger_records(borrower, seq, kind, hash, prev, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(borrower, body.seq, kind, hash, body.prev, text, body.at);
    const writeId = enqueueMemory({ account: borrower, accountId: b.memwal_account_id, namespace: C.NS.history, text, purpose: `record:${body.seq}`, ref: `${borrower}:${body.seq}` });
    db.prepare('UPDATE ledger_records SET write_id = ? WHERE borrower = ? AND seq = ?').run(writeId, borrower, body.seq);
    return { seq: body.seq, hash };
  });
  return tx();
}

const anchoring = new Set<string>();
/** Anchors stored-but-unanchored records strictly in order. */
export async function anchorPending(borrower: string): Promise<void> {
  if (anchoring.has(borrower)) return;
  anchoring.add(borrower);
  try {
    const b = getBorrower(borrower);
    if (!b?.ledger_id) return;
    for (;;) {
      const anchoredSeq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM ledger_records WHERE borrower = ? AND anchor_digest IS NOT NULL').get(borrower) as { s: number }).s;
      const next = db.prepare('SELECT seq, hash, blob_id FROM ledger_records WHERE borrower = ? AND seq = ?').get(borrower, anchoredSeq + 1) as { seq: number; hash: string; blob_id: string | null } | undefined;
      if (!next || !next.blob_id) return;
      const { digest } = await anchor(b.ledger_id, next.seq, next.hash);
      db.prepare('UPDATE ledger_records SET anchor_digest = ? WHERE borrower = ? AND seq = ?').run(digest, borrower, next.seq);
      emit('ledger.anchored', { borrower, seq: next.seq, head: next.hash, digest });
    }
  } catch (e) {
    log.error('anchor failed', { message: (e as Error).message });
  } finally {
    anchoring.delete(borrower);
  }
}

onMemoryWritten('record:', async (row) => {
  const [borrower, seq] = (row.ref ?? '').split(':');
  db.prepare('UPDATE ledger_records SET blob_id = ? WHERE borrower = ? AND seq = ?').run(row.blob_id, borrower, Number(seq));
  await anchorPending(borrower);
});

export type Verification = { valid: boolean; reasons: string[]; recalled: number; indexed: number | null; anchoredSeq: number; anchoredHead: string; partial: boolean };
export type Score = { verified: boolean; warnings: number; responses: number; payouts: number; policies: number; discountFactor: number };

const cache = new Map<string, { at: number; value: { verification: Verification; records: Array<Parsed & { blobId: string; sigValid: boolean }> } }>();

/** Verifies a borrower's history exactly as another underwriter would: from Walrus + the on-chain anchor. */
export async function verifyHistory(address: string, maxAgeMs = 30_000) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const b = getBorrower(address);
  if (!b?.ledger_id) throw new Error('borrower not registered');
  const mem = borrowerMem(b.memwal_account_id);
  const [ledger, hits, indexedList] = await Promise.all([
    readLedger(b.ledger_id),
    recall(mem, C.NS.history, 'ghostwriter record history', 100),
    listAll(mem, C.NS.history).catch(() => null),
  ]);
  const reasons: string[] = [];
  const bySeq = new Map<number, Parsed & { blobId: string; sigValid: boolean }>();
  for (const h of hits) {
    const r = parseRecord(h.text);
    if (!r || r.borrower !== address) continue;
    const { hashOk, sigOk } = checkRecord(r, recordPubHex);
    if (!hashOk) reasons.push(`seq ${r.seq}: hash mismatch`);
    if (!sigOk) reasons.push(`seq ${r.seq}: signature invalid or untrusted key`);
    const prev = bySeq.get(r.seq);
    if (prev && prev.hash !== r.hash) reasons.push(`seq ${r.seq}: two different records`);
    bySeq.set(r.seq, { ...r, blobId: h.blob_id, sigValid: hashOk && sigOk });
  }
  const records = [...bySeq.values()].sort((a, c) => a.seq - c.seq);
  records.forEach((r, i) => {
    if (r.seq !== i + 1) reasons.push(`gap before seq ${r.seq}`);
    const expectedPrev = i === 0 ? GENESIS : records[i - 1].hash;
    if (r.prev !== expectedPrev) reasons.push(`seq ${r.seq}: prev hash does not link`);
  });
  const lastAnchored = records.find((r) => r.seq === ledger.seq);
  if (ledger.seq > 0 && (!lastAnchored || lastAnchored.hash !== ledger.headHex)) reasons.push(`anchored head (seq ${ledger.seq}) not matched by Walrus records`);
  const indexed = indexedList ? indexedList.length : null;
  const partial = indexed !== null && indexed > records.length;
  if (partial) reasons.push(`recall returned ${records.length} of ${indexed} indexed records (OPEN-11)`);
  const verification: Verification = { valid: reasons.length === 0, reasons, recalled: records.length, indexed, anchoredSeq: ledger.seq, anchoredHead: ledger.headHex, partial };
  const value = { verification, records };
  cache.set(address, { at: Date.now(), value });
  return value;
}

export function scoreFrom(records: Parsed[], valid: boolean): Score {
  const count = (k: RecordKind) => records.filter((r) => r.kind === k).length;
  const warnings = count('warning'), responses = count('response'), payouts = count('payout'), policies = count('policy_bought');
  let f: number;
  if (!valid) f = 1.10;
  else if (warnings === 0) f = 1.0 - Math.min(0.05, 0.01 * policies);
  else { const resp = Math.min(1, responses / warnings); f = 1.0 - 0.2 * resp + 0.1 * (1 - resp); }
  f += Math.min(0.2, 0.05 * payouts);
  return { verified: valid, warnings, responses, payouts, policies, discountFactor: Math.max(0.75, Math.min(1.3, Number(f.toFixed(4)))) };
}

export function invalidateHistory(address: string) { cache.delete(address); }
```

**`backend/src/chain/memwalAccount.ts`**
```ts
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { mainnet, tatum } from './clients.js';
import { AppError } from '../errors.js';
import { borrowerMem } from '../memory/client.js';
import { memStatus } from '../memory/client.js';

/** Owner check from the Mainnet MemWalAccount object; delegate check by making a signed relayer call with OUR delegate key. */
export async function verifyBorrowerAccount(address: string, accountId: string): Promise<void> {
  const { object } = await tatum(() => mainnet.getObject({ objectId: accountId, include: { json: true } }), 'memwalAccount');
  if (!object.type.includes('::account::MemWalAccount')) throw new AppError('BAD_REQUEST', 'not a MemWalAccount object', { type: object.type });
  const owner = (object.json as { owner?: string } | null | undefined)?.owner;
  if (!owner) throw new AppError('UPSTREAM_TATUM', 'MemWalAccount json has no owner field');
  if (normalizeSuiAddress(owner) !== normalizeSuiAddress(address)) throw new AppError('CONFLICT', 'account is not owned by this address', { reason: 'NOT_OWNER' });
  try {
    await borrowerMem(accountId).listNamespaces({ limit: 1 });
  } catch (e) {
    if (memStatus(e) === 401) throw new AppError('CONFLICT', 'Ghostwriter delegate key is not registered on this account', { reason: 'DELEGATE_NOT_REGISTERED' });
    throw new AppError('UPSTREAM_MEMWAL', (e as Error).message);
  }
}
```
> The relayer caches a successful delegate check for up to 30 s (Walrus docs); a just-added key may need a few seconds before the first signed call succeeds. The frontend retries `PUT /v1/borrowers/:address` once after 5 s on `DELEGATE_NOT_REGISTERED`.

**`backend/src/routes/borrowers.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { verifyBorrowerAccount } from '../chain/memwalAccount.js';
import { createLedger } from '../chain/ghostwriterTx.js';
import { appendRecord, getBorrower, verifyHistory, scoreFrom, invalidateHistory } from '../memory/records.js';
import { listObligations } from '../chain/suilend.js';

const Addr = z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a));

async function borrowerDTO(address: string) {
  const b = getBorrower(address);
  if (!b) throw new AppError('NOT_FOUND', 'borrower not registered');
  const counts = db.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN anchor_digest IS NOT NULL THEN seq END), 0) AS a FROM ledger_records WHERE borrower = ?`).get(address) as { n: number; a: number };
  let score = { verified: false, warnings: 0, responses: 0, payouts: 0, discountFactor: 1 };
  try {
    const h = await verifyHistory(address);
    const s = scoreFrom(h.records, h.verification.valid);
    score = { verified: s.verified, warnings: s.warnings, responses: s.responses, payouts: s.payouts, discountFactor: s.discountFactor };
  } catch { /* memory read failed: neutral score */ }
  return { address, memwalAccountId: b.memwal_account_id, ledgerId: b.ledger_id, records: counts.n, anchoredSeq: counts.a, score };
}

export async function borrowerRoutes(app: FastifyInstance) {
  app.put('/v1/borrowers/:address', async (req) => {
    const address = Addr.parse((req.params as { address: string }).address);
    const { memwalAccountId } = z.object({ memwalAccountId: Addr }).parse(req.body);
    const existing = getBorrower(address);
    if (existing && existing.memwal_account_id !== memwalAccountId) throw new AppError('CONFLICT', 'borrower already registered with another account', { reason: 'ALREADY_REGISTERED' });
    await verifyBorrowerAccount(address, memwalAccountId);
    if (!existing) {
      db.prepare('INSERT INTO borrowers(address, memwal_account_id, ledger_id, created_at) VALUES (?, ?, NULL, ?)').run(address, memwalAccountId, Date.now());
    }
    const row = getBorrower(address)!;
    if (!row.ledger_id) {
      const { ledgerId } = await createLedger(address, memwalAccountId);
      db.prepare('UPDATE borrowers SET ledger_id = ? WHERE address = ?').run(ledgerId, address);
      appendRecord(address, 'onboarded', { memwalAccountId, ledgerId });
    }
    invalidateHistory(address);
    return borrowerDTO(address);
  });

  app.get('/v1/borrowers/:address', async (req) => borrowerDTO(Addr.parse((req.params as { address: string }).address)));

  app.get('/v1/borrowers/:address/history', async (req) => {
    const address = Addr.parse((req.params as { address: string }).address);
    const b = getBorrower(address);
    if (!b?.ledger_id) throw new AppError('NOT_FOUND', 'borrower not registered');
    const h = await verifyHistory(address);
    return {
      address, memwalAccountId: b.memwal_account_id, ledgerId: b.ledger_id, verification: h.verification,
      records: h.records.map((r) => ({ seq: r.seq, kind: r.kind, at: r.at, data: r.data, evidence: r.evidence, hash: r.hash, prev: r.prev, blobId: r.blobId, sigValid: r.sigValid })),
    };
  });

  app.get('/v1/borrowers/:address/positions', async (req) => listObligations(Addr.parse((req.params as { address: string }).address)));
}
```

`borrowers.ts` imports `listObligations` from `chain/suilend.ts`, which is written in P7. **Create this stub now** so P4 compiles; P7 replaces it:

**`backend/src/chain/suilend.ts`** (P4 stub)
```ts
export async function listObligations(_owner: string): Promise<{ obligations: Array<{ obligationId: string; raw: unknown }>; note?: string }> {
  return { obligations: [], note: 'positions are added in P7' };
}
```

Register in `server.ts` (P2 version) — add after `eventRoutes`:
```ts
import { borrowerRoutes } from './routes/borrowers.js';
import { startMemoryWorker } from './memory/queue.js';
import './memory/records.js'; // registers the record:* hook
// …
await app.register(borrowerRoutes);
startMemoryWorker();
```

**Test — `backend/test/records.test.ts`**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { buildRecord, parseRecord, checkRecord, recordPubHex } = await import('../src/memory/records.js');

test('record round-trips and verifies', () => {
  const body = { v: 1 as const, borrower: '0x' + '1'.repeat(64), seq: 1, prev: '0'.repeat(64), kind: 'onboarded' as const, at: 1, data: { b: 2, a: 1 }, evidence: [] };
  const { text, hash } = buildRecord(body);
  const p = parseRecord(text)!;
  assert.equal(p.hash, hash);
  assert.deepEqual(checkRecord(p, recordPubHex), { hashOk: true, sigOk: true });
});

test('tampered data fails hash', () => {
  const { text } = buildRecord({ v: 1, borrower: '0x' + '1'.repeat(64), seq: 2, prev: 'a'.repeat(64), kind: 'warning', at: 2, data: { x: 1 }, evidence: [] });
  const p = parseRecord(text)!;
  (p.data as Record<string, unknown>).x = 2;
  assert.equal(checkRecord(p, recordPubHex).hashOk, false);
});
```
(The test imports real config; run it with a filled `.env`.)

**Commands**
```bash
pnpm typecheck && pnpm test
pnpm dev
# Manual onboarding with your own Slush wallet (Mainnet): until the frontend exists, use
# https://memory.walrus.xyz → create account → "Add key" with the borrower delegate PUBLIC key printed by `pnpm keys`.
curl -X PUT localhost:8787/v1/borrowers/<your-address> -H 'content-type: application/json' -d '{"memwalAccountId":"<your-account-id>"}'
curl localhost:8787/v1/borrowers/<your-address>/history
```

**Exit checks**
- PUT returns `BorrowerDTO` with a `ledgerId`; SSE shows `memory.queued` → `memory.written` (blobId) → `ledger.anchored` (seq 1).
- `GET …/history` → `verification.valid: true`, `recalled: 1`, `anchoredSeq: 1`; `indexed` equals `recalled` (resolves OPEN-11 for small counts).
- Using a wallet that did not add the delegate key → 409 `DELEGATE_NOT_REGISTERED`.
- `pnpm test` → records tests pass.

**Commit:** `feat(backend): P4 walrus memory queue, signed borrower ledger, onboarding`

---

### P5 — Pricing, memory-driven quotes, policy confirmation, config/market/proof

**Goal:** `POST /v1/quotes` returns a signed quote whose price is visibly changed by memory (cases, rules, borrower history), with OpenAI explanation; `POST /v1/policies/confirm` records a bought policy.

**`backend/src/pricing/math.ts`**
```ts
/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). Max error ~1.5e-7. */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Probability that a zero-drift GBM price starting at S touches barrier B (< S) within T years, volatility sigma.
 * Log-price drift = -sigma^2/2. Reflection formula for the running minimum.
 * Conservative for our product: it ignores the "must stay below for confirmDelay" condition (over-prices slightly).
 */
export function firstPassageProb(S: number, B: number, sigma: number, T: number): number {
  if (!(S > 0 && B > 0 && sigma > 0 && T > 0)) return 0;
  if (B >= S) return 1;
  const b = Math.log(B / S);
  const s = sigma * Math.sqrt(T);
  const h = (sigma * sigma * T) / 2;
  const p = normCdf((b + h) / s) + (S / B) * normCdf((b - h) / s);
  return Math.min(1, Math.max(0, p));
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
```

**`backend/src/pricing/buckets.ts`**
```ts
export type VolBucket = 'low' | 'mid' | 'high';
export type MoneyBucket = '0-5' | '5-10' | '10-15' | '15-25' | '25+';
export type DurBucket = '1-3d' | '4-7d' | '8-30d';

export const volBucket = (sigmaAnnual: number): VolBucket => (sigmaAnnual < 0.5 ? 'low' : sigmaAnnual < 0.9 ? 'mid' : 'high');
export function moneyBucket(spot: number, trigger: number): MoneyBucket {
  const d = 1 - trigger / spot;
  return d < 0.05 ? '0-5' : d < 0.10 ? '5-10' : d < 0.15 ? '10-15' : d < 0.25 ? '15-25' : '25+';
}
export const durBucket = (days: number): DurBucket => (days <= 3 ? '1-3d' : days <= 7 ? '4-7d' : '8-30d');
```

**`backend/src/pricing/vol.ts`**
```ts
import { env, type Asset } from '../config.js';
import { AppError } from '../errors.js';
import { db } from '../db.js';
import { tatum } from '../chain/clients.js';
import { sleep } from '../util/sleep.js';

type Candle = { t: number; close: number };
const DAY = 86_400_000;

// Past days never change, so each (asset, day) is fetched once and kept. close = 0 marks "Tatum had no record".
db.exec(`CREATE TABLE IF NOT EXISTS ohlcv_daily (asset TEXT NOT NULL, day_ms INTEGER NOT NULL, close REAL NOT NULL, PRIMARY KEY (asset, day_ms))`);

function num(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) { const v = o[k]; if (v !== undefined && v !== null && !Number.isNaN(Number(v))) return Number(v); }
  return null;
}

/** Tatum returns ONE record per call. Accept a bare object, `{ data: {…} }`, or a one-item array (exact example not published). */
function pickRecord(body: unknown): Record<string, unknown> | null {
  let b: unknown = body;
  if (b && typeof b === 'object' && !Array.isArray(b) && 'data' in b) b = (b as { data: unknown }).data;
  if (Array.isArray(b)) b = b[0];
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
}

/**
 * OPEN-5 (resolved): GET /v4/data/rate/symbol/OHLCV?symbol=SUI&unix=<ms>&interval=1d
 * returns the record closest to `unix`. We ask for each day's start (00:00 UTC).
 */
async function fetchDay(asset: Asset, dayMs: number): Promise<number> {
  const q = env.TATUM_OHLCV_QUERY.replace('{symbol}', asset).replace('{unix}', String(dayMs));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await tatum(() => fetch(`${env.TATUM_API_BASE}/v4/data/rate/symbol/OHLCV?${q}`, {
      headers: { 'x-api-key': env.TATUM_API_KEY }, signal: AbortSignal.timeout(10_000),
    }), 'ohlcv');
    if (res.status === 429) { await sleep(1000 * 2 ** attempt); continue; }
    if (res.status === 404) return 0;
    if (!res.ok) throw new AppError('UPSTREAM_TATUM', `tatum OHLCV HTTP ${res.status}`);
    const r = pickRecord(await res.json());
    if (!r) return 0;
    // "Closest record" can be far away for a day Tatum lacks; reject anything more than 2 days off.
    let t = num(r, ['timestamp', 'time', 't', 'unix', 'openTime', 'timeOpen']);
    if (t === null && typeof r.date === 'string') t = Date.parse(r.date);
    if (t !== null && Math.abs((t < 1e12 ? t * 1000 : t) - dayMs) > 2 * DAY) return 0;
    const close = num(r, ['close', 'c', 'Close', 'closePrice']);
    return close !== null && close > 0 ? close : 0;
  }
  throw new AppError('RATE_LIMITED', 'tatum OHLCV: rate limited after retries');
}

/** Daily closes for the last `days` full days (oldest first), one Tatum call per day not yet cached. */
export async function fetchCloses(asset: Asset, days: number): Promise<Candle[]> {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const want = Array.from({ length: days }, (_, i) => today - (days - i) * DAY); // … yesterday
  const rows = db.prepare('SELECT day_ms, close FROM ohlcv_daily WHERE asset = ? AND day_ms >= ?').all(asset, want[0]) as Array<{ day_ms: number; close: number }>;
  const have = new Map(rows.map((r) => [r.day_ms, r.close]));
  const ins = db.prepare('INSERT OR REPLACE INTO ohlcv_daily(asset, day_ms, close) VALUES (?, ?, ?)');
  for (const d of want) {
    if (have.has(d)) continue;
    const c = await fetchDay(asset, d);
    ins.run(asset, d, c);
    have.set(d, c);
  }
  const candles = want.filter((d) => (have.get(d) ?? 0) > 0).map((d) => ({ t: d, close: have.get(d)! }));
  if (candles.length < Math.min(10, days)) throw new AppError('UPSTREAM_TATUM', `tatum OHLCV: only ${candles.length} usable daily closes for ${asset} (see smoke output)`);
  return candles;
}

export function annualizedVol(closes: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const varr = r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1);
  return Math.sqrt(varr) * Math.sqrt(365);
}

export async function annualVol(asset: Asset): Promise<number> {
  const c = await fetchCloses(asset, 45);
  return annualizedVol(c.slice(-31).map((x) => x.close));
}
```

**`backend/scripts/warm-ohlcv.ts`** (run once after P3, before the first quote: fills the daily cache so quotes don't wait)
```ts
// Usage: pnpm warm:ohlcv          (≈ 800 Tatum calls at TATUM_RPS → about 5 minutes on 3 RPS; later runs only fetch new days)
import { ASSETS } from '../src/config.js';
import { fetchCloses } from '../src/pricing/vol.js';

for (const asset of ASSETS) {
  const c = await fetchCloses(asset, 400);
  console.log(`✔ ${asset}: ${c.length} daily closes, ${new Date(c[0].t).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1].t).toISOString().slice(0, 10)}`);
}
```
> Each call costs Tatum credits. 800 calls is far below the free 1M credits, and past days are never fetched twice.

**`backend/src/pricing/explain.ts`**
```ts
import OpenAI from 'openai';
import { env } from '../config.js';
import { log } from '../log.js';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const QUOTE_SYSTEM = `You explain an insurance quote to a crypto borrower in at most 90 words.
Use only the facts provided. Name each memory that changed the price by its short id (first 8 chars) and say whether it raised or lowered the price.
Do not give financial advice. Plain English.`;

const LESSON_SYSTEM = `You write a one-sentence underwriting lesson (max 30 words) from a loss on a liquidation-protection policy.
Use only the facts provided. Start with the bucket, e.g. "SUI, high vol, 10-15% below spot:".`;

async function complete(system: string, facts: unknown): Promise<string | null> {
  try {
    const r = await client.chat.completions.create(
      { model: env.OPENAI_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(facts) }] },
      { timeout: 8000 },
    );
    return r.choices[0]?.message?.content?.trim() || null;
  } catch (e) {
    log.warn('openai failed; using fallback text', { message: (e as Error).message });
    return null;
  }
}

export async function explainQuote(facts: Record<string, unknown>): Promise<{ text: string; source: 'openai' | 'fallback' }> {
  const t = await complete(QUOTE_SYSTEM, facts);
  if (t) return { text: t, source: 'openai' };
  const f = facts as { probability: number; multiplier: number; factors: Record<string, number> };
  return {
    source: 'fallback',
    text: `Model probability ${(f.probability * 100).toFixed(1)}%. Memory multiplier ×${f.multiplier.toFixed(2)} (cases ×${f.factors.cases.toFixed(2)}, rules ×${f.factors.rules.toFixed(2)}, your history ×${f.factors.borrower.toFixed(2)}).`,
  };
}

export async function writeLesson(facts: Record<string, unknown>): Promise<string> {
  const t = await complete(LESSON_SYSTEM, facts);
  const f = facts as { asset: string; volBucket: string; moneyBucket: string };
  return t ?? `${f.asset}, ${f.volBucket} vol, ${f.moneyBucket}% below spot: a covered drop happened; price this bucket higher.`;
}
```

**`backend/src/memory/cases.ts`**
```ts
import { C, type Asset } from '../config.js';
import { enqueueMemory } from './queue.js';
import { underwriter, recall } from './client.js';
import { env } from '../config.js';
import type { VolBucket, MoneyBucket, DurBucket } from '../pricing/buckets.js';

export type CaseOutcome = 'payout' | 'near_miss' | 'expired' | 'backtest';
export type CaseRec = {
  v: 1; asset: Asset; volBucket: VolBucket; moneyBucket: MoneyBucket; durBucket: DurBucket; outcome: CaseOutcome;
  source: 'live' | 'backtest'; n?: number; hits?: number; policyId?: string; note?: string; at: number;
};

export const caseQuery = (c: Pick<CaseRec, 'asset' | 'volBucket' | 'moneyBucket' | 'durBucket'>) =>
  `liquidation cover case asset=${c.asset} vol=${c.volBucket} distance=${c.moneyBucket}% duration=${c.durBucket}`;

/** Text starts with the semantic query words (helps vector recall), then the machine-readable JSON. */
export function caseText(c: CaseRec): string {
  return `${caseQuery(c)} outcome=${c.outcome} ${C.PREFIX.case}${JSON.stringify(c)}`;
}

export function parseCase(text: string): CaseRec | null {
  const i = text.indexOf(C.PREFIX.case);
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i + C.PREFIX.case.length)) as CaseRec; } catch { return null; }
}

export function enqueueCase(c: CaseRec, purpose: string): number {
  return enqueueMemory({ account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.cases, text: caseText(c), purpose });
}

export type CaseHit = { rec: CaseRec; blobId: string; distance: number };
export async function similarCases(q: Pick<CaseRec, 'asset' | 'volBucket' | 'moneyBucket' | 'durBucket'>): Promise<CaseHit[]> {
  const hits = await recall(underwriter, C.NS.cases, caseQuery(q), 20);
  const out: CaseHit[] = [];
  for (const h of hits) {
    const rec = parseCase(h.text);
    if (rec && rec.asset === q.asset && h.distance < C.CASE_MAX_DISTANCE) out.push({ rec, blobId: h.blob_id, distance: h.distance });
  }
  return out;
}
```

**`backend/src/memory/rules.ts`**
```ts
import { db } from '../db.js';
import { C, env, type Asset } from '../config.js';
import { enqueueMemory, onMemoryWritten } from './queue.js';
import { underwriter, recall } from './client.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export type RuleStatus = 'trial' | 'active' | 'retired';
export type Rule = { ruleId: string; asset: Asset; volBucket: string; moneyBucket: string; multiplier: number; status: RuleStatus; lesson: string; payouts: number; quietExpiries: number; blobId: string | null; updatedAt: number };
type Row = { rule_id: string; asset: string; vol_bucket: string; money_bucket: string; multiplier: number; status: string; lesson: string; payouts: number; quiet_expiries: number; blob_id: string | null; updated_at: number };

const toRule = (r: Row): Rule => ({ ruleId: r.rule_id, asset: r.asset as Asset, volBucket: r.vol_bucket, moneyBucket: r.money_bucket, multiplier: r.multiplier, status: r.status as RuleStatus, lesson: r.lesson, payouts: r.payouts, quietExpiries: r.quiet_expiries, blobId: r.blob_id, updatedAt: r.updated_at });
export const ruleId = (asset: string, vol: string, money: string) => `${asset}:${vol}:${money}`;

export function allRules(): Rule[] { return (db.prepare('SELECT * FROM rules ORDER BY updated_at DESC').all() as Row[]).map(toRule); }
export function matchRule(asset: string, vol: string, money: string): Rule | null {
  const r = db.prepare(`SELECT * FROM rules WHERE rule_id = ? AND status != 'retired'`).get(ruleId(asset, vol, money)) as Row | undefined;
  return r ? toRule(r) : null;
}

function ruleText(r: Rule): string {
  const { blobId: _b, ...pub } = r;
  return `underwriting rule asset=${r.asset} vol=${r.volBucket} distance=${r.moneyBucket}% ${C.PREFIX.rule}${JSON.stringify(pub)}`;
}

export function saveRule(r: Rule): void {
  db.prepare(`INSERT INTO rules(rule_id, asset, vol_bucket, money_bucket, multiplier, status, lesson, payouts, quiet_expiries, blob_id, updated_at)
    VALUES (@ruleId, @asset, @volBucket, @moneyBucket, @multiplier, @status, @lesson, @payouts, @quietExpiries, NULL, @updatedAt)
    ON CONFLICT(rule_id) DO UPDATE SET multiplier=excluded.multiplier, status=excluded.status, lesson=excluded.lesson,
      payouts=excluded.payouts, quiet_expiries=excluded.quiet_expiries, updated_at=excluded.updated_at`).run(r);
  enqueueMemory({ account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.rules, text: ruleText(r), purpose: `rule:${r.ruleId}`, ref: r.ruleId });
  emit('rule.updated', { ruleId: r.ruleId, multiplier: r.multiplier, status: r.status });
}

onMemoryWritten('rule:', (row) => {
  db.prepare('UPDATE rules SET blob_id = ? WHERE rule_id = ?').run(row.blob_id, row.ref);
});

/** Memory is canonical: if the local cache is empty (fresh machine), rebuild rules from Walrus. */
export async function rebuildRulesFromMemory(): Promise<number> {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n;
  if (n > 0) return n;
  try {
    const hits = await recall(underwriter, C.NS.rules, 'underwriting rule', 100, 'recent');
    const latest = new Map<string, Rule & { blobId: string }>();
    for (const h of hits) {
      const i = h.text.indexOf(C.PREFIX.rule);
      if (i < 0) continue;
      const r = JSON.parse(h.text.slice(i + C.PREFIX.rule.length)) as Rule;
      const cur = latest.get(r.ruleId);
      if (!cur || r.updatedAt > cur.updatedAt) latest.set(r.ruleId, { ...r, blobId: h.blob_id });
    }
    for (const r of latest.values()) {
      db.prepare(`INSERT OR REPLACE INTO rules(rule_id, asset, vol_bucket, money_bucket, multiplier, status, lesson, payouts, quiet_expiries, blob_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.ruleId, r.asset, r.volBucket, r.moneyBucket, r.multiplier, r.status, r.lesson, r.payouts, r.quietExpiries, r.blobId, r.updatedAt);
    }
    return latest.size;
  } catch (e) {
    log.warn('rules rebuild from memory failed', { message: (e as Error).message });
    return 0;
  }
}
```

**`backend/src/pricing/quote.ts`**
```ts
import { randomBytes } from 'node:crypto';
import { bcs } from '@mysten/sui/bcs';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { db } from '../db.js';
import { env, C, FEED_BY_ASSET, type Asset } from '../config.js';
import { AppError } from '../errors.js';
import { hermesLatest } from '../chain/pyth.js';
import { annualVol } from './vol.js';
import { firstPassageProb, clamp } from './math.js';
import { volBucket, moneyBucket, durBucket } from './buckets.js';
import { similarCases, type CaseHit } from '../memory/cases.js';
import { matchRule } from '../memory/rules.js';
import { getBorrower, verifyHistory, scoreFrom } from '../memory/records.js';
import { explainQuote } from './explain.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export const QuoteMessageBcs = bcs.struct('QuoteMessage', {
  domain: bcs.vector(bcs.u8()),
  pool_id: bcs.Address,
  buyer: bcs.Address,
  kind: bcs.u8(),
  feed_id: bcs.vector(bcs.u8()),
  strike_e8: bcs.u64(),
  obligation_id: bcs.Address,
  payout: bcs.u64(),
  premium: bcs.u64(),
  start_ms: bcs.u64(),
  end_ms: bcs.u64(),
  quote_id: bcs.vector(bcs.u8()),
  expires_ms: bcs.u64(),
});

export type QuoteFields = {
  poolId: string; buyer: string; kind: 0 | 1; feedId: string; strikeE8: bigint; obligationId: string;
  payout: bigint; premium: bigint; startMs: number; endMs: number; quoteId: string; expiresMs: number;
};

export function quoteBytes(q: QuoteFields): Uint8Array {
  return QuoteMessageBcs.serialize({
    domain: Array.from(utf8ToBytes(C.QUOTE_DOMAIN)),
    pool_id: q.poolId, buyer: q.buyer, kind: q.kind,
    feed_id: Array.from(hexToBytes(q.feedId.replace(/^0x/, ''))),
    strike_e8: q.strikeE8, obligation_id: q.obligationId, payout: q.payout, premium: q.premium,
    start_ms: q.startMs, end_ms: q.endMs,
    quote_id: Array.from(hexToBytes(q.quoteId)), expires_ms: q.expiresMs,
  }).toBytes();
}

const quotePriv = hexToBytes(env.QUOTE_SIGNING_KEY_HEX);
export const quotePubHex = bytesToHex(ed25519.getPublicKey(quotePriv));
export const signQuote = (q: QuoteFields) => bytesToHex(ed25519.sign(quoteBytes(q), quotePriv));

const Addr = z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a));
export const QuoteInput = z.object({
  buyer: Addr,
  kind: z.enum(['price', 'liquidation']),
  asset: z.enum(['SUI', 'BTC']),
  triggerPriceUsd: z.number().positive(),
  payoutUsdc: z.number().min(1).max(1000),
  durationDays: z.number().int().min(1).max(30),
  obligationId: Addr.optional(),
}).refine((v) => v.kind === 'price' || !!v.obligationId, { message: 'obligationId is required for liquidation cover', path: ['obligationId'] });
export type QuoteInputT = z.infer<typeof QuoteInput>;

export type Citation = { namespace: string; blobId: string; kind: 'case' | 'rule' | 'record'; summary: string; distance?: number };

function caseFactor(hits: CaseHit[], p: number): { f: number; cites: Citation[] } {
  const cites: Citation[] = [];
  let f = 1;
  const bt = hits.filter((h) => h.rec.source === 'backtest' && h.rec.n && h.rec.n > 0).sort((a, b) => a.distance - b.distance)[0];
  if (bt) {
    const n = bt.rec.n!, k = bt.rec.hits ?? 0;
    const ratio = ((k + 1) / (n + 2)) / Math.max(p, 1e-4);
    const w = Math.min(n, 50) / 50;
    const g = clamp(ratio, 0.7, 1.8) ** w;
    f *= g;
    cites.push({ namespace: C.NS.cases, blobId: bt.blobId, kind: 'case', distance: bt.distance, summary: `backtest ${bt.rec.asset} ${bt.rec.moneyBucket}%: ${k}/${n} hits → ×${g.toFixed(2)}` });
  }
  const live = hits.filter((h) => h.rec.source === 'live');
  const payouts = live.filter((h) => h.rec.outcome === 'payout');
  const near = live.filter((h) => h.rec.outcome === 'near_miss');
  const liveF = Math.min(3, 1.15 ** payouts.length * 1.05 ** near.length);
  f *= liveF;
  for (const h of [...payouts, ...near].slice(0, 5)) {
    cites.push({ namespace: C.NS.cases, blobId: h.blobId, kind: 'case', distance: h.distance, summary: `${h.rec.outcome} on ${h.rec.policyId?.slice(0, 10) ?? 'policy'} (${h.rec.moneyBucket}%)` });
  }
  return { f, cites };
}

export type QuoteDTO = ReturnType<typeof toDTO>;
function toDTO(x: {
  q: QuoteFields; asset: Asset; signatureHex: string; spotUsd: number; vol: number; probability: number; base: bigint;
  mult: number; factors: { cases: number; rules: number; borrower: number }; citations: Citation[]; explanation: { text: string; source: 'openai' | 'fallback' };
}) {
  return {
    quoteId: x.q.quoteId, buyer: x.q.buyer, kind: (x.q.kind === 0 ? 'price' : 'liquidation') as 'price' | 'liquidation', kindU8: x.q.kind, asset: x.asset,
    feedId: x.q.feedId, strikeE8: x.q.strikeE8.toString(), obligationId: x.q.obligationId,
    payout: x.q.payout.toString(), premium: x.q.premium.toString(), startMs: x.q.startMs, endMs: x.q.endMs, expiresMs: x.q.expiresMs,
    signatureHex: x.signatureHex,
    pricing: { spotUsd: x.spotUsd, volAnnual: Number(x.vol.toFixed(4)), probability: Number(x.probability.toFixed(6)), basePremium: x.base.toString(), multiplier: Number(x.mult.toFixed(4)), factors: x.factors },
    citations: x.citations, explanation: x.explanation.text, explanationSource: x.explanation.source,
    moveCall: {
      target: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::buy`, typeArguments: [env.COIN_TYPE] as [string],
      argOrder: ['pool', 'kind', 'feedId', 'strikeE8', 'obligationId', 'payout', 'premium', 'startMs', 'endMs', 'quoteId', 'expiresMs', 'signature', 'payment', 'clock'] as const,
    },
  };
}

export async function makeQuote(input: QuoteInputT): Promise<QuoteDTO> {
  if (input.kind === 'liquidation' && !getBorrower(input.buyer)) throw new AppError('NOT_FOUND', 'register your Walrus Memory account before buying liquidation cover');
  const feedId = FEED_BY_ASSET[input.asset];
  const spot = (await hermesLatest([feedId])).get(feedId)!;
  if (input.triggerPriceUsd >= spot.spotUsd) throw new AppError('BAD_REQUEST', `trigger must be below spot ($${spot.spotUsd.toFixed(4)})`);
  const vol = await annualVol(input.asset);
  const T = input.durationDays / 365;
  const p = firstPassageProb(spot.spotUsd, input.triggerPriceUsd, vol, T);
  const payout = BigInt(Math.round(input.payoutUsdc * 10 ** env.COIN_DECIMALS));
  const base = BigInt(Math.round(Number(payout) * p * (1 + C.LOADING)));
  const buckets = { asset: input.asset, volBucket: volBucket(vol), moneyBucket: moneyBucket(spot.spotUsd, input.triggerPriceUsd), durBucket: durBucket(input.durationDays) };

  const citations: Citation[] = [];
  let fCases = 1;
  try {
    const cf = caseFactor(await similarCases(buckets), p);
    fCases = cf.f; citations.push(...cf.cites);
  } catch (e) { log.warn('case recall failed; neutral factor', { message: (e as Error).message }); }

  let fRules = 1;
  const rule = matchRule(buckets.asset, buckets.volBucket, buckets.moneyBucket);
  if (rule) {
    fRules = rule.multiplier;
    if (rule.blobId) citations.push({ namespace: C.NS.rules, blobId: rule.blobId, kind: 'rule', summary: `${rule.status} rule ×${rule.multiplier.toFixed(2)}: ${rule.lesson}` });
  }

  let fBorrower = 1;
  if (getBorrower(input.buyer)) {
    try {
      const h = await verifyHistory(input.buyer);
      const s = scoreFrom(h.records, h.verification.valid);
      fBorrower = s.discountFactor;
      for (const r of h.records.slice(-3)) if (r.blobId) citations.push({ namespace: C.NS.history, blobId: r.blobId, kind: 'record', summary: `your record #${r.seq}: ${r.kind}` });
    } catch (e) { log.warn('history verify failed; neutral factor', { message: (e as Error).message }); }
  }

  const mult = clamp(fCases * fRules * fBorrower, C.MULT_MIN, C.MULT_MAX);
  let premium = BigInt(Math.round(Number(base) * mult));
  if (premium < C.MIN_PREMIUM) premium = C.MIN_PREMIUM;
  if (premium >= payout) throw new AppError('BAD_REQUEST', 'cover is too likely to pay out at this trigger; choose a lower trigger or shorter duration');

  const now = Date.now();
  const q: QuoteFields = {
    poolId: normalizeSuiAddress(env.GHOSTWRITER_POOL_ID), buyer: input.buyer, kind: input.kind === 'price' ? 0 : 1, feedId,
    strikeE8: BigInt(Math.round(input.triggerPriceUsd * 1e8)),
    obligationId: input.kind === 'liquidation' ? input.obligationId! : C.ZERO_ADDRESS,
    payout, premium, startMs: now, endMs: now + input.durationDays * 86_400_000,
    quoteId: randomBytes(16).toString('hex'), expiresMs: now + C.QUOTE_TTL_MS,
  };
  const signatureHex = signQuote(q);
  const factors = { cases: Number(fCases.toFixed(4)), rules: Number(fRules.toFixed(4)), borrower: Number(fBorrower.toFixed(4)) };
  const explanation = await explainQuote({
    asset: input.asset, spotUsd: spot.spotUsd, triggerUsd: input.triggerPriceUsd, days: input.durationDays, volAnnual: vol,
    probability: p, payoutUsdc: input.payoutUsdc, premiumUsdc: Number(premium) / 10 ** env.COIN_DECIMALS, multiplier: mult, factors,
    memories: citations.map((c) => ({ id: c.blobId.slice(0, 8), kind: c.kind, summary: c.summary })),
  });
  const dto = toDTO({ q, asset: input.asset, signatureHex, spotUsd: spot.spotUsd, vol, probability: p, base, mult, factors, citations, explanation });

  db.prepare(`INSERT INTO quotes(id, buyer, kind, asset, feed_id, strike_e8, obligation_id, payout, premium, start_ms, end_ms, expires_ms, signature, dto, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`).run(
    q.quoteId, q.buyer, q.kind, input.asset, feedId, q.strikeE8.toString(), q.obligationId, payout.toString(), premium.toString(),
    q.startMs, q.endMs, q.expiresMs, signatureHex, JSON.stringify(dto), now);
  emit('quote.issued', { quoteId: q.quoteId, buyer: q.buyer, premium: premium.toString(), multiplier: dto.pricing.multiplier });
  return dto;
}

export function getQuote(id: string): (QuoteDTO & { status: 'issued' | 'used' | 'expired' }) | null {
  const r = db.prepare('SELECT dto, status, expires_ms FROM quotes WHERE id = ?').get(id) as { dto: string; status: string; expires_ms: number } | undefined;
  if (!r) return null;
  const status = r.status === 'issued' && Date.now() > r.expires_ms ? 'expired' : (r.status as 'issued' | 'used' | 'expired');
  return { ...(JSON.parse(r.dto) as QuoteDTO), status };
}
```

**`backend/test/math.test.ts`**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, firstPassageProb } from '../src/pricing/math.js';

test('normCdf anchors', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-3);
});

test('first passage: barrier at or above spot is certain, monotone in vol and time', () => {
  assert.equal(firstPassageProb(1, 1, 0.8, 0.02), 1);
  const a = firstPassageProb(1, 0.9, 0.5, 7 / 365);
  const b = firstPassageProb(1, 0.9, 0.9, 7 / 365);
  const c = firstPassageProb(1, 0.9, 0.9, 14 / 365);
  assert.ok(a < b && b < c, `${a} ${b} ${c}`);
  assert.ok(Math.abs(firstPassageProb(1, 0.9, 0.8, 7 / 365) - 0.36) < 0.02);
});
```
(This file imports only `math.ts`, so it runs without `.env`.)

**`backend/test/quote-bcs.test.ts`**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
const { quoteBytes, signQuote, quotePubHex } = await import('../src/pricing/quote.js');

test('quote signature verifies over the BCS bytes Move rebuilds', () => {
  const q = {
    poolId: '0x' + 'a'.repeat(64), buyer: '0x' + 'b'.repeat(64), kind: 0 as const, feedId: '0x' + 'c'.repeat(64),
    strikeE8: 50_000_000n, obligationId: '0x' + '0'.repeat(64), payout: 10_000_000n, premium: 500_000n,
    startMs: 1, endMs: 2, quoteId: 'd'.repeat(32), expiresMs: 3,
  };
  const bytes = quoteBytes(q);
  // domain(1+17) + pool 32 + buyer 32 + kind 1 + feed(1+32) + strike 8 + obligation 32 + payout 8 + premium 8 + start 8 + end 8 + quote(1+16) + expires 8
  assert.equal(bytes.length, 18 + 32 + 32 + 1 + 33 + 8 + 32 + 8 + 8 + 8 + 8 + 17 + 8);
  assert.ok(ed25519.verify(hexToBytes(signQuote(q)), bytes, hexToBytes(quotePubHex)));
});
```

**`backend/src/policies/sync.ts`**
```ts
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { db, kvGet, kvSet } from '../db.js';
import { env, C, ASSET_BY_FEED } from '../config.js';
import { AppError } from '../errors.js';
import { readPolicy, type PolicyState } from '../chain/objects.js';
import { testnet, tatum, txObjectTypes, idsOfType } from '../chain/clients.js';
import { emit } from '../bus.js';
import { appendRecord } from '../memory/records.js';
import { enqueueMemory } from '../memory/queue.js';
import { log } from '../log.js';

type PolicyRow = {
  id: string; quote_id: string; holder: string; kind: number; asset: string; feed_id: string; strike_e8: string; obligation_id: string;
  payout: string; premium: string; start_ms: number; end_ms: number; status: string; breach_started_ms: number; buy_digest: string | null;
  settle_digest: string | null; settle_path: string | null; near_miss: number; warned_at: number | null; responded: number;
  hedge_status: string; hedge_detail: string | null; learned: number;
};
export type { PolicyRow };

export function policyDTO(r: PolicyRow) {
  return {
    policyId: r.id, quoteId: r.quote_id, holder: r.holder, kind: (r.kind === 0 ? 'price' : 'liquidation') as 'price' | 'liquidation',
    asset: r.asset as 'SUI' | 'BTC', feedId: r.feed_id, strikeE8: r.strike_e8, obligationId: r.obligation_id, payout: r.payout, premium: r.premium,
    startMs: r.start_ms, endMs: r.end_ms, status: r.status as 'active' | 'breach' | 'paid' | 'expired', breachStartedMs: r.breach_started_ms,
    buyDigest: r.buy_digest, settleDigest: r.settle_digest, settlePath: r.settle_path as 'price' | 'liquidation' | null,
    hedge: { status: r.hedge_status as 'none' | 'queued' | 'filled' | 'refunded' | 'failed', ...(r.hedge_detail ? { detail: r.hedge_detail } : {}) },
  };
}
export type PolicyDTO = ReturnType<typeof policyDTO>;

const statusOf = (s: PolicyState) => (s.status === 1 ? 'paid' : s.status === 2 ? 'expired' : s.breachStartedMs > 0 ? 'breach' : 'active');

export function getPolicyRow(id: string): PolicyRow | undefined {
  return db.prepare('SELECT * FROM policies WHERE id = ?').get(normalizeSuiAddress(id)) as PolicyRow | undefined;
}

type NewPolicyListener = (dto: PolicyDTO) => void;
const newListeners: NewPolicyListener[] = [];
export const onNewPolicy = (fn: NewPolicyListener) => { newListeners.push(fn); };

/** Reads the Policy from chain and upserts it. First sighting → events, borrower record, underwriter memory. */
export async function upsertPolicyFromChain(policyId: string, buyDigest?: string, settle?: { digest: string; path: 'price' | 'liquidation' }): Promise<PolicyDTO> {
  const st = await readPolicy(policyId);
  if (st.poolId !== normalizeSuiAddress(env.GHOSTWRITER_POOL_ID)) throw new AppError('CONFLICT', 'policy belongs to another pool');
  const existing = getPolicyRow(st.id);
  const now = Date.now();
  const status = statusOf(st);
  if (!existing) {
    const asset = ASSET_BY_FEED[st.feedId] ?? 'SUI';
    db.prepare(`INSERT INTO policies(id, quote_id, holder, kind, asset, feed_id, strike_e8, obligation_id, payout, premium, start_ms, end_ms, status,
      breach_started_ms, buy_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      st.id, st.quoteId, st.holder, st.kind, asset, st.feedId, st.strikeE8.toString(), st.obligationId, st.payout.toString(), st.premium.toString(),
      st.startMs, st.endMs, status, st.breachStartedMs, buyDigest ?? null, now, now);
    db.prepare(`UPDATE quotes SET status = 'used' WHERE id = ?`).run(st.quoteId);
    const dto = policyDTO(getPolicyRow(st.id)!);
    emit('policy.bought', dto);
    appendRecord(st.holder, 'policy_bought', { policyId: st.id, kind: dto.kind, asset, strikeE8: dto.strikeE8, payout: dto.payout, premium: dto.premium, endMs: st.endMs }, buyDigest ? [buyDigest] : []);
    const q = db.prepare('SELECT dto FROM quotes WHERE id = ?').get(st.quoteId) as { dto: string } | undefined;
    const reasoning = q ? JSON.parse(q.dto) as { pricing: unknown; citations: Array<{ blobId: string; kind: string }> } : null;
    enqueueMemory({
      account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies, purpose: `policy:${st.id}:bought`,
      text: `policy bought ${asset} ${dto.kind} ${C.PREFIX.policy}${JSON.stringify({ policyId: st.id, quoteId: st.quoteId, holder: st.holder, asset, kind: dto.kind, strikeE8: dto.strikeE8, payout: dto.payout, premium: dto.premium, startMs: st.startMs, endMs: st.endMs, pricing: reasoning?.pricing ?? null, citedBlobs: reasoning?.citations.map((c) => c.blobId) ?? [], buyDigest: buyDigest ?? null })}`,
    });
    for (const l of newListeners) { try { l(dto); } catch (e) { log.error('onNewPolicy listener', { message: (e as Error).message }); } }
    return dto;
  }
  db.prepare(`UPDATE policies SET status = ?, breach_started_ms = ?, settle_digest = COALESCE(?, settle_digest), settle_path = COALESCE(?, settle_path),
    buy_digest = COALESCE(buy_digest, ?), updated_at = ? WHERE id = ?`).run(status, st.breachStartedMs, settle?.digest ?? null, settle?.path ?? null, buyDigest ?? null, now, st.id);
  return policyDTO(getPolicyRow(st.id)!);
}

export async function confirmFromDigest(digest: string, quoteId: string): Promise<PolicyDTO> {
  const types = await txObjectTypes(testnet, digest);
  const ids = idsOfType(types, `${normalizeSuiAddress(env.GHOSTWRITER_PACKAGE_ID)}::ghostwriter::Policy<`)
    .concat(idsOfType(types, `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::Policy<`));
  for (const id of [...new Set(ids)]) {
    const st = await readPolicy(id);
    if (st.quoteId === quoteId) return upsertPolicyFromChain(id, digest);
  }
  throw new AppError('NOT_FOUND', 'no Policy for this quote in that transaction', { digest, quoteId });
}

/** Safety net: discovers purchases even if the client never called /confirm (e.g. closed tab). */
export function startPolicyDiscovery(intervalMs = 15_000) {
  const seenKey = 'policyDiscovery:seen';
  const seen = new Set<string>(JSON.parse(kvGet(seenKey) ?? '[]') as string[]);
  const tick = async () => {
    try {
      const page = await tatum(() => testnet.listEvents({ filter: { eventType: `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter::PolicyBought` }, order: 'descending', limit: 50 }), 'listEvents:PolicyBought');
      for (const ev of page.events) {
        const id = (ev.json as { policy_id?: string } | null)?.policy_id;
        if (!id || seen.has(id)) continue;
        if (!getPolicyRow(id)) await upsertPolicyFromChain(id, ev.transactionDigest);
        seen.add(id);
      }
      kvSet(seenKey, JSON.stringify([...seen].slice(-500)));
    } catch (e) { log.warn('policy discovery', { message: (e as Error).message }); }
    setTimeout(tick, intervalMs);
  };
  void tick();
}
```

**`backend/src/routes/quotes.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { makeQuote, getQuote, QuoteInput } from '../pricing/quote.js';

export async function quoteRoutes(app: FastifyInstance) {
  app.post('/v1/quotes', async (req) => makeQuote(QuoteInput.parse(req.body)));
  app.get('/v1/quotes/:id', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) }).parse(req.params);
    const q = getQuote(id);
    if (!q) throw new AppError('NOT_FOUND', 'quote not found');
    return q;
  });
}
```

**`backend/src/routes/policies.ts`** (P5 version; P7 adds the claim route)
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { confirmFromDigest, getPolicyRow, policyDTO, type PolicyRow } from '../policies/sync.js';

const Addr = z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a));

export async function policyRoutes(app: FastifyInstance) {
  app.post('/v1/policies/confirm', async (req) => {
    const { digest, quoteId } = z.object({ digest: z.string().min(20), quoteId: z.string().regex(/^[0-9a-f]{32}$/) }).parse(req.body);
    return confirmFromDigest(digest, quoteId);
  });

  app.get('/v1/policies', async (req) => {
    const q = z.object({ holder: Addr.optional(), status: z.enum(['active', 'breach', 'paid', 'expired']).optional() }).parse(req.query);
    const where: string[] = []; const args: unknown[] = [];
    if (q.holder) { where.push('holder = ?'); args.push(q.holder); }
    if (q.status) { where.push('status = ?'); args.push(q.status); }
    const rows = db.prepare(`SELECT * FROM policies ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args) as PolicyRow[];
    return { policies: rows.map(policyDTO) };
  });

  app.get('/v1/policies/:id', async (req) => {
    const { id } = z.object({ id: Addr }).parse(req.params);
    const r = getPolicyRow(id);
    if (!r) throw new AppError('NOT_FOUND', 'policy not found');
    return policyDTO(r);
  });
}
```

**`backend/src/routes/meta.ts`** (final; replaces the P2 version)
```ts
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { env, C, FEED_BY_ASSET, ASSETS } from '../config.js';
import { readPool, type PoolState } from '../chain/objects.js';
import { hermesLatest } from '../chain/pyth.js';
import { annualVol } from '../pricing/vol.js';
import { volBucket } from '../pricing/buckets.js';
import { quotePubHex } from '../pricing/quote.js';
import { recordPubHex } from '../memory/records.js';
import { delegateKeyToPublicKey } from '@mysten-incubation/memwal';
import { workerState } from '../state.js';
import { poolCached } from '../chain/poolCache.js';

const started = Date.now();

const hexOf = (u: Uint8Array) => Buffer.from(u).toString('hex');

export async function metaRoutes(app: FastifyInstance) {
  app.get('/v1/health', async () => ({ ok: true, version: '1.0.0', uptimeS: Math.round((Date.now() - started) / 1000), workers: workerState }));

  app.get('/v1/config', async () => {
    const pool = await poolCached();
    return {
      network: { policies: 'testnet', memory: 'mainnet' },
      packageId: env.GHOSTWRITER_PACKAGE_ID, poolId: env.GHOSTWRITER_POOL_ID, coinType: env.COIN_TYPE, coinDecimals: env.COIN_DECIMALS, clockId: '0x6',
      feeds: { SUI: env.FEED_SUI_USD, BTC: env.FEED_BTC_USD },
      pool: { confirmDelayMs: pool.confirmDelayMs, maxConfBps: pool.maxConfBps, maxPriceAgeS: pool.maxPriceAgeS, quotePubkeyHex: pool.quotePubkeyHex, paused: pool.paused },
      quotePubkeyMatches: pool.quotePubkeyHex === quotePubHex,
      memwal: {
        packageId: env.MEMWAL_PACKAGE_ID, registryId: env.MEMWAL_REGISTRY_ID, serverUrl: env.MEMWAL_SERVER_URL,
        borrowerDelegatePublicKeyHex: hexOf(delegateKeyToPublicKey(env.MEMWAL_BORROWER_DELEGATE_KEY)),
        borrowerDelegateLabel: 'Ghostwriter underwriter', underwriterAccountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, historyNamespace: C.NS.history,
      },
      recordPubkeyHex: recordPubHex,
      enclave: { objectId: env.ENCLAVE_OBJECT_ID, configId: env.ENCLAVE_CONFIG_OBJECT_ID },
      limits: { payoutMin: C.PAYOUT_MIN.toString(), payoutMax: C.PAYOUT_MAX.toString(), durationDaysMin: 1, durationDaysMax: 30, quoteTtlMs: C.QUOTE_TTL_MS },
      explorers: {
        testnetObject: 'https://suiscan.xyz/testnet/object/', testnetTx: 'https://suiscan.xyz/testnet/tx/',
        mainnetObject: 'https://suiscan.xyz/mainnet/object/', mainnetTx: 'https://suiscan.xyz/mainnet/tx/', walrusBlob: 'https://walruscan.com/mainnet/blob/',
      },
    };
  });

  app.get('/v1/market', async () => {
    const spots = await hermesLatest(ASSETS.map((a) => FEED_BY_ASSET[a]));
    const assets = [];
    for (const a of ASSETS) {
      const s = spots.get(FEED_BY_ASSET[a])!;
      const v = await annualVol(a);
      assets.push({ asset: a, feedId: s.feedId, spotUsd: s.spotUsd, publishMs: s.publishMs, volAnnual: Number(v.toFixed(4)), volBucket: volBucket(v) });
    }
    return { assets };
  });

  app.get('/v1/proof', async () => {
    const done = db.prepare(`SELECT blob_id FROM memory_writes WHERE status='done' ORDER BY id DESC LIMIT 10`).all() as Array<{ blob_id: string }>;
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM memory_writes WHERE status='done'`).get() as { n: number }).n;
    return {
      memwalAgentId: hexOf(delegateKeyToPublicKey(env.MEMWAL_UNDERWRITER_KEY)), underwriterAccountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
      mainnetMemories: n, lastBlobIds: done.map((d) => d.blob_id), packageId: env.GHOSTWRITER_PACKAGE_ID, poolId: env.GHOSTWRITER_POOL_ID, enclaveObjectId: env.ENCLAVE_OBJECT_ID,
    };
  });
}
```
**`backend/src/chain/poolCache.ts`**
```ts
import { readPool, type PoolState } from './objects.js';

let poolCache: { at: number; v: PoolState } | null = null;
export async function poolCached(maxAgeMs = 30_000): Promise<PoolState> {
  if (!poolCache || Date.now() - poolCache.at > maxAgeMs) poolCache = { at: Date.now(), v: await readPool() };
  return poolCache.v;
}
```

> `delegateKeyToPublicKey` is a documented SDK utility (Walrus Memory API reference, "Utility functions"). If its return type turns out to be a hex string instead of `Uint8Array`, change `hexOf(...)` to use the string directly.

Add to `server.ts`: register `quoteRoutes`, `policyRoutes`; call `startPolicyDiscovery()` and `await rebuildRulesFromMemory()` at startup (final `server.ts` in P9).

**Commands**
```bash
pnpm typecheck && pnpm test
pnpm dev
curl -s localhost:8787/v1/config | jq '.quotePubkeyMatches'     # must be true
curl -s localhost:8787/v1/market | jq
curl -s -X POST localhost:8787/v1/quotes -H 'content-type: application/json' \
  -d '{"buyer":"<your testnet address>","kind":"price","asset":"SUI","triggerPriceUsd":<spot*0.9>,"payoutUsdc":10,"durationDays":7}' | jq
```

**Exit checks**
- `math` and `quote-bcs` tests pass.
- `/v1/config.quotePubkeyMatches === true` (the Pool holds our quote key).
- A quote returns `pricing.probability` between 0 and 1, `premium < payout`, `explanationSource: "openai"`.
- Buy that quote on Testnet with a quick script or `sui client ptb` (frontend does this later), then `POST /v1/policies/confirm` → `PolicyDTO` with `status: "active"`; SSE shows `policy.bought`, `memory.queued`, `memory.written` (namespace `ghostwriter-policies`).
- A second buy with the same quote aborts with `EQuoteUsed` (code 4).

**Commit:** `feat(backend): P5 pricing, memory-driven quotes, policy confirm`

---

### P6 — Watchers: price trigger, expiry, warnings, checkpoint pulse

**Goal:** automatic `report_breach → confirm_breach` payouts, `reset_breach`, `expire`, near-miss tagging, warnings for liquidation cover; live checkpoint heartbeat from Tatum's gRPC stream.

**`backend/src/workers/priceWatcher.ts`**
```ts
import { db } from '../db.js';
import { C, ASSETS, FEED_BY_ASSET } from '../config.js';
import { hermesLatest } from '../chain/pyth.js';
import { reportBreach, resetBreach, confirmBreach, expirePolicy } from '../chain/ghostwriterTx.js';
import { upsertPolicyFromChain, type PolicyRow } from '../policies/sync.js';
import { appendRecord } from '../memory/records.js';
import { emit, emitTransient } from '../bus.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';
import { workerState } from '../state.js';
import { poolCached } from '../chain/poolCache.js';
import { env } from '../config.js';

const inflight = new Set<string>();
let lastRun = 0;
let running = false;

async function act(policyId: string, label: string, fn: () => Promise<{ digest: string }>, after: (digest: string) => void) {
  if (inflight.has(policyId)) return;
  inflight.add(policyId);
  try {
    const { digest } = await fn();
    after(digest);
  } catch (e) {
    if (e instanceof AppError && e.code === 'CHAIN_ABORT') log.warn(`${label} aborted (chain state differs from Hermes view)`, e.details);
    else log.error(`${label} failed`, { message: (e as Error).message });
  } finally {
    inflight.delete(policyId);
  }
}

export async function priceTick(): Promise<void> {
  if (running || Date.now() - lastRun < 3000) return;
  running = true; lastRun = Date.now();
  try {
    const rows = db.prepare(`SELECT * FROM policies WHERE status IN ('active', 'breach')`).all() as PolicyRow[];
    const spots = await hermesLatest(ASSETS.map((a) => FEED_BY_ASSET[a]));
    emitTransient('price.tick', { prices: ASSETS.map((a) => ({ asset: a, spotUsd: spots.get(FEED_BY_ASSET[a])!.spotUsd, publishMs: spots.get(FEED_BY_ASSET[a])!.publishMs })) });
    if (rows.length === 0) return;
    const pool = await poolCached(60_000);
    const now = Date.now();

    for (const p of rows) {
      const spot = spots.get(p.feed_id);
      if (!spot) continue;
      const strike = BigInt(p.strike_e8);
      const price = spot.priceE8;

      if (now > p.end_ms + pool.confirmDelayMs) {
        await act(p.id, 'expire', () => expirePolicy(p.id), (digest) => {
          void upsertPolicyFromChain(p.id).then(() => emit('policy.expired', { policyId: p.id, digest }));
        });
        continue;
      }

      if (p.kind === 0) {
        if (p.breach_started_ms === 0 && price <= strike && now >= p.start_ms && now <= p.end_ms) {
          await act(p.id, 'report_breach', () => reportBreach(p.id, p.feed_id), (digest) => {
            void upsertPolicyFromChain(p.id).then(() => emit('breach.reported', { policyId: p.id, priceE8: price.toString(), digest }));
          });
        } else if (p.breach_started_ms > 0 && price > strike) {
          await act(p.id, 'reset_breach', () => resetBreach(p.id, p.feed_id), (digest) => {
            void upsertPolicyFromChain(p.id).then(() => emit('breach.reset', { policyId: p.id, priceE8: price.toString(), digest }));
          });
        } else if (p.breach_started_ms > 0 && now >= p.breach_started_ms + pool.confirmDelayMs && price <= strike) {
          await act(p.id, 'confirm_breach', () => confirmBreach(p.id, p.feed_id), (digest) => {
            void upsertPolicyFromChain(p.id, undefined, { digest, path: 'price' }).then(() =>
              emit('policy.paid', { policyId: p.id, holder: p.holder, payout: p.payout, path: 'price', digest }));
          });
        }
        if (!p.near_miss && price > strike && price <= (strike * 103n) / 100n) {
          db.prepare('UPDATE policies SET near_miss = 1 WHERE id = ?').run(p.id);
        }
      } else if (!p.warned_at && price <= (strike * 105n) / 100n) {
        db.prepare('UPDATE policies SET warned_at = ? WHERE id = ?').run(now, p.id);
        const spotUsd = spot.spotUsd, strikeUsd = Number(strike) / 1e8;
        appendRecord(p.holder, 'warning', { policyId: p.id, obligationId: p.obligation_id, spotUsd, strikeUsd });
        emit('warning.issued', { policyId: p.id, borrower: p.holder, spotUsd, strikeUsd });
      }
    }
  } catch (e) {
    log.warn('price tick failed', { message: (e as Error).message });
  } finally {
    running = false;
  }
}

export function startPriceWatcher() {
  workerState.priceWatcher = 'running';
  const loop = async () => { await priceTick(); setTimeout(loop, env.PRICE_POLL_MS); };
  void loop();
}
```

**`backend/src/workers/checkpointPulse.ts`**
```ts
import { testnet } from '../chain/clients.js';
import { emitTransient } from '../bus.js';
import { workerState } from '../state.js';
import { log } from '../log.js';

/** Tatum gRPC SubscriptionService.SubscribeCheckpoints on Testnet. Drives price checks and the UI heartbeat. */
export function startCheckpointPulse(onPulse: () => void) {
  const run = async () => {
    try {
      const stream = testnet.subscriptionService.subscribeCheckpoints({ readMask: { paths: ['sequence_number'] } });
      workerState.checkpointPulse = 'stream';
      let last = 0;
      for await (const frame of stream.responses) {
        const f = frame as unknown as { cursor?: bigint | string; checkpoint?: { sequenceNumber?: bigint | string } };
        const seq = f.checkpoint?.sequenceNumber ?? f.cursor;
        if (Date.now() - last >= 5000) {
          last = Date.now();
          emitTransient('chain.checkpoint', { network: 'testnet', seq: String(seq ?? ''), at: last });
          onPulse();
        }
      }
    } catch (e) {
      workerState.checkpointPulse = 'polling';
      log.warn('checkpoint stream ended; price watcher keeps polling (OPEN-10)', { message: (e as Error).message });
    }
    setTimeout(run, 15_000);
  };
  void run();
}
```
> Each streamed frame consumes Tatum credits. The frame handler is cheap and the price check it triggers is throttled to ≥ 3 s.

Wire into `server.ts`: `startPriceWatcher(); startCheckpointPulse(() => void priceTick());` (final `server.ts` in P9).

**Commands / test run (demo pool has `confirmDelayMs = 120000`)**
```bash
pnpm dev
# 1) Quote+buy a SUI price policy close to spot so it can trigger during testing:
#    trigger = spot * 0.98, durationDays 1. (Very close triggers are refused because premium would reach payout.)
# 2) When SUI ticks under the trigger: SSE breach.reported → (2 min) policy.paid, or breach.reset if it bounces.
```
Market moves are not under your control. For the demo, buy several 1-day policies at 0.98–0.99 × spot the evening before recording; at least one usually triggers. If none does, show the most recent real `breach.reported → policy.paid` from your SSE log and Suiscan links — never fake a payout.

**Exit checks**
- `/v1/health` shows `priceWatcher: running`, `checkpointPulse: stream` (or `polling` on plans without streaming — still works).
- SSE emits `chain.checkpoint` every ~5 s and `price.tick` every ~10 s.
- A live policy goes `active → breach → paid` with three Testnet digests; the holder's DUSDC balance increases by `payout`.
- A policy left to run past `endMs + confirmDelayMs` becomes `expired`; `GET /v1/underwriter/book` (P8) shows `locked` decreasing.

**Commit:** `feat(backend): P6 price trigger, expiry, warnings, checkpoint stream`

---

### P7 — Nautilus enclave, Suilend reads, liquidation watcher

**Goal:** a real Mainnet Suilend liquidation of a covered obligation → enclave attestation → `settle_liquidation` on Testnet; borrower responses to warnings detected from Mainnet events.

#### 7.1 Confirm Suilend shapes first (OPEN-6)

**`backend/scripts/peek-suilend.ts`**
```ts
import { env } from '../src/config.js';
import { mainnet, tatum } from '../src/chain/clients.js';

for (const t of [env.SUILEND_LIQUIDATE_EVENT_TYPE, `${env.SUILEND_EVENT_MODULE}::DepositEvent`, `${env.SUILEND_EVENT_MODULE}::RepayEvent`]) {
  const page = await tatum(() => mainnet.listEvents({ filter: { eventType: t }, order: 'descending', limit: 1 }));
  const ev = page.events[0];
  console.log('\n===', t);
  console.log(ev ? JSON.stringify({ eventType: ev.eventType, tx: ev.transactionDigest, json: ev.json }, null, 2) : 'NO EVENTS (type name wrong?)');
}
```
Run `pnpm peek:suilend`. The field names are confirmed (`obligation_id`, `repay_amount`, `withdraw_amount` on `LiquidateEvent`; `obligation_id` on `DepositEvent`/`RepayEvent`), so this run is a live sanity check. Keep one liquidation tx digest for P7 exit checks. For `SUILEND_OBLIGATION_CAP_TYPE`: copy `lending_market_id` from the printed event, run `sui client object <lending_market_id> --json` against Mainnet, take the type argument `P` from `LendingMarket<P>`, and set `SUILEND_OBLIGATION_CAP_TYPE=0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::ObligationOwnerCap<P>`.

**Tatum JSON-RPC check for the enclave (OPEN-8)**
```bash
curl -s https://sui-mainnet.gateway.tatum.io -H 'content-type: application/json' -H "x-api-key: $TATUM_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getTransactionBlock","params":["<liquidation digest>",{"showEvents":true,"showEffects":true}]}' | jq '.result.timestampMs, .result.events[0].type'
```

#### 7.2 Enclave (Rust, inside your Nautilus clone)

Create `nautilus/src/nautilus-server/src/apps/ghostwriter/` by copying `apps/weather-example/`, then replace `mod.rs` with the file below and `allowed_endpoints.yaml` with the next one. Then mirror every place the template registers `weather-example` for your new app:
```bash
cd nautilus
grep -rn "weather-example\|weather_example" src/nautilus-server Makefile configure_enclave.sh 2>/dev/null
```
Add the same entries for `ghostwriter` (Cargo feature, module declaration, Makefile/`ENCLAVE_APP` switch). The Nautilus docs say "use existing app directories as references"; the grep shows every spot.

**`enclave/mod.rs`** → copy to `nautilus/src/nautilus-server/src/apps/ghostwriter/mod.rs`
```rust
// Ghostwriter: attests that a Suilend LiquidateEvent for a given obligation exists in a successful Mainnet tx.
use crate::common::IntentMessage;
use crate::common::{to_signed_response, ProcessDataRequest, ProcessedDataResponse};
use crate::AppState;
use crate::EnclaveError;
use axum::extract::State;
use axum::Json;
use fastcrypto::encoding::{Encoding, Hex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::sync::Arc;

/// Must match LIQUIDATION_INTENT in ghostwriter.move.
#[derive(Serialize_repr, Deserialize_repr, Debug)]
#[repr(u8)]
pub enum IntentScope {
    Liquidation = 1,
}

const TATUM_SUI_MAINNET_RPC: &str = "https://sui-mainnet.gateway.tatum.io";
// Field names confirmed from Suilend's lending_market docs (OPEN-6); `pnpm peek:suilend` shows a live example.
const LIQUIDATE_EVENT_PREFIX: &str =
    "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LiquidateEvent";
const F_OBLIGATION: &str = "obligation_id";
const F_REPAY: &str = "repay_amount";
const F_WITHDRAW: &str = "withdraw_amount";

/// Field order and types must match `LiquidationAttestation` in ghostwriter.move.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiquidationAttestation {
    pub obligation_id: [u8; 32],
    pub tx_digest: Vec<u8>,
    pub repay_amount: u64,
    pub withdraw_amount: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LiquidationRequest {
    pub tx_digest: String,
    pub obligation_id: String,
}

fn err(msg: impl Into<String>) -> EnclaveError {
    EnclaveError::GenericError(msg.into())
}

fn parse_addr(s: &str) -> Result<[u8; 32], EnclaveError> {
    let h = s.trim_start_matches("0x");
    if h.len() > 64 {
        return Err(err("address longer than 32 bytes"));
    }
    let padded = format!("{:0>64}", h);
    let v = Hex::decode(&padded).map_err(|e| err(format!("bad address hex: {e}")))?;
    v.try_into().map_err(|_| err("address must be 32 bytes"))
}

fn as_u64(v: &Value) -> Option<u64> {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64())
}

pub async fn process_data(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<LiquidationRequest>>,
) -> Result<Json<ProcessedDataResponse<IntentMessage<LiquidationAttestation>>>, EnclaveError> {
    let want = parse_addr(&request.payload.obligation_id)?;
    let digest = request.payload.tx_digest.clone();
    if digest.is_empty() || digest.len() > 64 {
        return Err(err("bad digest"));
    }
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "sui_getTransactionBlock",
        "params": [digest, { "showEvents": true, "showEffects": true }]
    });
    let resp = reqwest::Client::new()
        .post(TATUM_SUI_MAINNET_RPC)
        .header("x-api-key", &state.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| err(format!("rpc request failed: {e}")))?;
    let v: Value = resp.json().await.map_err(|e| err(format!("rpc response not json: {e}")))?;
    let result = &v["result"];
    if result.is_null() {
        return Err(err(format!("transaction not found: {}", v["error"])));
    }
    if result["effects"]["status"]["status"].as_str() != Some("success") {
        return Err(err("transaction did not succeed"));
    }
    // timestampMs exists only once the tx is in a checkpoint (final).
    let ts = as_u64(&result["timestampMs"]).ok_or_else(|| err("transaction not checkpointed yet"))?;
    let events = result["events"].as_array().ok_or_else(|| err("no events"))?;
    for ev in events {
        let ty = ev["type"].as_str().unwrap_or("");
        if !ty.starts_with(LIQUIDATE_EVENT_PREFIX) {
            continue;
        }
        let pj = &ev["parsedJson"];
        let oid = match pj[F_OBLIGATION].as_str() {
            Some(s) => s,
            None => continue,
        };
        if parse_addr(oid)? != want {
            continue;
        }
        let repay = as_u64(&pj[F_REPAY]).ok_or_else(|| err("repay amount missing"))?;
        let withdraw = as_u64(&pj[F_WITHDRAW]).ok_or_else(|| err("withdraw amount missing"))?;
        return Ok(Json(to_signed_response(
            &state.eph_kp,
            LiquidationAttestation {
                obligation_id: want,
                tx_digest: digest.as_bytes().to_vec(),
                repay_amount: repay,
                withdraw_amount: withdraw,
            },
            ts,
            IntentScope::Liquidation as u8,
        )));
    }
    Err(err("no LiquidateEvent for this obligation in that transaction"))
}
```

**`enclave/allowed_endpoints.yaml`** → copy to `apps/ghostwriter/allowed_endpoints.yaml`. Keep the exact YAML structure of the weather example's file and only swap the host:
```yaml
endpoints:
  - sui-mainnet.gateway.tatum.io
```
(If OPEN-8 fails, also add `fullnode.mainnet.sui.io` and change `TATUM_SUI_MAINNET_RPC`.)

**Deploy + register (Nautilus docs, Steps 7–11)**
```bash
cd nautilus
sh configure_enclave.sh ghostwriter        # instance name: ghostwriter; secret: yes → new → name tatum-key → value: <TATUM_API_KEY>
rsync -avz -e "ssh -i ~/.ssh/<alias>.pem" ./ ec2-user@<public-ip>:~/nautilus/
ssh -i ~/.ssh/<alias>.pem ec2-user@<public-ip>
  cd nautilus && make ENCLAVE_APP=ghostwriter && make run && sh expose_enclave.sh
  cat out/nitro.pcrs                    # PCR0, PCR1, PCR2
# back on your machine (Sui CLI on testnet, same address as the server key):
export ENCLAVE_PACKAGE_ID=<from P1 step 1>  APP_PACKAGE_ID=$GHOSTWRITER_PACKAGE_ID
export CAP_OBJECT_ID=<ENCLAVE_CAP_ID from P1>  ENCLAVE_CONFIG_OBJECT_ID=<from P1>
export ENCLAVE_URL=http://<public-ip>:3000  MODULE_NAME=ghostwriter  OTW_NAME=GHOSTWRITER
sui client call --function update_pcrs --module enclave --package $ENCLAVE_PACKAGE_ID \
  --type-args "$APP_PACKAGE_ID::$MODULE_NAME::$OTW_NAME" --args $ENCLAVE_CONFIG_OBJECT_ID $CAP_OBJECT_ID 0x$PCR0 0x$PCR1 0x$PCR2
sh register_enclave.sh $ENCLAVE_PACKAGE_ID $APP_PACKAGE_ID $ENCLAVE_CONFIG_OBJECT_ID $ENCLAVE_URL $MODULE_NAME $OTW_NAME
# record the new shared Enclave object → ENCLAVE_OBJECT_ID in backend/.env; set ENCLAVE_URL too
curl -s $ENCLAVE_URL/health_check
```
**Stop the instance when not testing** (`aws ec2 stop-instances --instance-ids <id>`); restarting needs `make run` + `expose_enclave.sh`, and a **re-register** because the enclave key is regenerated on every start (Nautilus troubleshooting: "enclave restarted … without re-registering"). Plan: start the instance ~30 min before recording the demo.

#### 7.3 Backend

**`backend/src/chain/suilend.ts`** (final; replaces the P4 stub)
```ts
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { env } from '../config.js';
import { db } from '../db.js';
import { mainnet, tatum } from './clients.js';

/** OPEN-6: confirm with `pnpm peek:suilend`. */
export const LIQ_FIELDS = { obligation: 'obligation_id', repay: 'repay_amount', withdraw: 'withdraw_amount' } as const;
export const ACTION_FIELDS = { obligation: 'obligation_id' } as const;
export const DEPOSIT_EVENT = `${env.SUILEND_EVENT_MODULE}::DepositEvent`;
export const REPAY_EVENT = `${env.SUILEND_EVENT_MODULE}::RepayEvent`;

db.exec(`CREATE TABLE IF NOT EXISTS seen_events (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
export function markSeen(key: string): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO seen_events(key, at) VALUES (?, ?)').run(key, Date.now());
  return r.changes === 1;
}

export type ChainEvent = { eventType: string; transactionDigest: string; eventIndex: number; json: Record<string, unknown> | null };

/** Newest-first page of Mainnet events of one type (no cursor bookkeeping; dedupe via seen_events). */
export async function latestEvents(eventType: string, limit = 50): Promise<ChainEvent[]> {
  const page = await tatum(() => mainnet.listEvents({ filter: { eventType }, order: 'descending', limit }), `listEvents:${eventType.split('::').pop()}`);
  return page.events.map((e) => ({
    eventType: e.eventType, transactionDigest: e.transactionDigest, eventIndex: Number(e.eventIndex),
    json: (e.json ?? null) as Record<string, unknown> | null,
  }));
}

export function fieldAddr(json: Record<string, unknown> | null, field: string): string | null {
  const v = json?.[field];
  return typeof v === 'string' ? normalizeSuiAddress(v) : null;
}

/** Best-effort Mainnet positions: ObligationOwnerCap objects owned by the address, then each obligation's JSON. */
export async function listObligations(owner: string): Promise<{ obligations: Array<{ obligationId: string; raw: unknown }>; note?: string }> {
  if (!env.SUILEND_OBLIGATION_CAP_TYPE) return { obligations: [], note: 'SUILEND_OBLIGATION_CAP_TYPE not set (OPEN-6); enter the obligation id manually' };
  const page = await tatum(() => mainnet.listOwnedObjects({ owner, type: env.SUILEND_OBLIGATION_CAP_TYPE, limit: 10, include: { json: true } }), 'listOwnedObjects');
  const out: Array<{ obligationId: string; raw: unknown }> = [];
  for (const cap of page.objects) {
    const id = (cap.json as { obligation_id?: string } | null)?.obligation_id;
    if (!id) continue;
    const { object } = await tatum(() => mainnet.getObject({ objectId: id, include: { json: true } }), 'getObject:obligation');
    out.push({ obligationId: normalizeSuiAddress(id), raw: object.json ?? null });
  }
  return { obligations: out };
}
```

**`backend/src/enclave/client.ts`**
```ts
import { env } from '../config.js';
import { AppError } from '../errors.js';

export type Attestation = { timestampMs: number; repayAmount: bigint; withdrawAmount: bigint; signatureHex: string; txDigest: string };

export async function attestLiquidation(txDigest: string, obligationId: string): Promise<Attestation> {
  if (!env.ENCLAVE_URL) throw new AppError('UPSTREAM_ENCLAVE', 'ENCLAVE_URL not set');
  let res: Response;
  try {
    res = await fetch(`${env.ENCLAVE_URL}/process_data`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { tx_digest: txDigest, obligation_id: obligationId } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new AppError('UPSTREAM_ENCLAVE', `enclave unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new AppError('UPSTREAM_ENCLAVE', `enclave HTTP ${res.status}: ${text.slice(0, 300)}`);
  // Keep u64s lossless: quote large integers before JSON.parse.
  const safe = text.replace(/("(?:repay_amount|withdraw_amount|timestamp_ms)"\s*:\s*)(\d+)/g, '$1"$2"');
  const body = JSON.parse(safe) as {
    response: { intent: number; timestamp_ms: string; data: { obligation_id: number[]; tx_digest: number[]; repay_amount: string; withdraw_amount: string } };
    signature: string;
  };
  if (body.response.intent !== 1) throw new AppError('UPSTREAM_ENCLAVE', 'unexpected intent');
  const echoed = Buffer.from(body.response.data.tx_digest).toString('utf8');
  if (echoed !== txDigest) throw new AppError('UPSTREAM_ENCLAVE', 'enclave echoed a different digest');
  return {
    timestampMs: Number(body.response.timestamp_ms),
    repayAmount: BigInt(body.response.data.repay_amount),
    withdrawAmount: BigInt(body.response.data.withdraw_amount),
    signatureHex: body.signature.replace(/^0x/, ''),
    txDigest,
  };
}
```

**`backend/src/workers/liquidationWatcher.ts`**
```ts
import { db } from '../db.js';
import { env, C } from '../config.js';
import { AppError } from '../errors.js';
import { latestEvents, markSeen, fieldAddr, LIQ_FIELDS, ACTION_FIELDS, DEPOSIT_EVENT, REPAY_EVENT } from '../chain/suilend.js';
import { attestLiquidation } from '../enclave/client.js';
import { settleLiquidation } from '../chain/ghostwriterTx.js';
import { upsertPolicyFromChain, getPolicyRow, type PolicyRow } from '../policies/sync.js';
import { appendRecord } from '../memory/records.js';
import { emit } from '../bus.js';
import { log } from '../log.js';
import { workerState } from '../state.js';

const claiming = new Set<string>();

export async function claimLiquidation(policyId: string, txDigest: string): Promise<{ status: 'paid'; settleDigest: string }> {
  const p = getPolicyRow(policyId);
  if (!p) throw new AppError('NOT_FOUND', 'policy not found');
  if (p.kind !== 1) throw new AppError('CONFLICT', 'not a liquidation policy');
  if (p.status !== 'active') throw new AppError('CONFLICT', `policy is ${p.status}`);
  if (claiming.has(p.id)) throw new AppError('CONFLICT', 'claim already in progress');
  claiming.add(p.id);
  try {
    const att = await attestLiquidation(txDigest, p.obligation_id);
    const { digest } = await settleLiquidation({ policyId: p.id, txDigest, repayAmount: att.repayAmount, withdrawAmount: att.withdrawAmount, timestampMs: att.timestampMs, signatureHex: att.signatureHex });
    await upsertPolicyFromChain(p.id, undefined, { digest, path: 'liquidation' });
    emit('policy.paid', { policyId: p.id, holder: p.holder, payout: p.payout, path: 'liquidation', digest });
    return { status: 'paid', settleDigest: digest };
  } finally {
    claiming.delete(p.id);
  }
}

async function scanLiquidations() {
  const active = db.prepare(`SELECT * FROM policies WHERE kind = 1 AND status = 'active'`).all() as PolicyRow[];
  const byObligation = new Map(active.map((p) => [p.obligation_id, p]));
  for (const ev of await latestEvents(env.SUILEND_LIQUIDATE_EVENT_TYPE)) {
    if (!markSeen(`liq:${ev.transactionDigest}:${ev.eventIndex}`)) continue;
    const obligationId = fieldAddr(ev.json, LIQ_FIELDS.obligation);
    if (!obligationId) continue;
    const match = byObligation.get(obligationId) ?? null;
    if (!match) continue; // only emit for covered obligations (Suilend has many liquidations)
    emit('liquidation.seen', { obligationId, txDigest: ev.transactionDigest, matchedPolicyId: match.id });
    try { await claimLiquidation(match.id, ev.transactionDigest); }
    catch (e) { log.error('auto-claim failed', { policyId: match.id, message: (e as Error).message }); }
  }
}

async function scanResponses() {
  const now = Date.now();
  const warned = db.prepare(`SELECT * FROM policies WHERE kind = 1 AND warned_at IS NOT NULL AND responded = 0 AND warned_at > ?`).all(now - C.RESPONSE_WINDOW_MS) as PolicyRow[];
  if (warned.length === 0) return;
  const byObligation = new Map(warned.map((p) => [p.obligation_id, p]));
  for (const type of [DEPOSIT_EVENT, REPAY_EVENT]) {
    for (const ev of await latestEvents(type)) {
      const obligationId = fieldAddr(ev.json, ACTION_FIELDS.obligation);
      const p = obligationId ? byObligation.get(obligationId) : undefined;
      if (!p || !markSeen(`act:${ev.transactionDigest}:${ev.eventIndex}`)) continue;
      db.prepare('UPDATE policies SET responded = 1 WHERE id = ?').run(p.id);
      appendRecord(p.holder, 'response', { policyId: p.id, obligationId, action: type.endsWith('DepositEvent') ? 'deposit' : 'repay' }, [ev.transactionDigest]);
      byObligation.delete(p.obligation_id);
    }
  }
}

export function startLiquidationWatcher() {
  workerState.liquidationWatcher = 'running';
  const loop = async () => {
    try { await scanLiquidations(); await scanResponses(); }
    catch (e) { log.warn('liquidation watcher', { message: (e as Error).message }); }
    setTimeout(loop, env.LIQ_POLL_MS);
  };
  void loop();
}
```

Add the claim route to **`backend/src/routes/policies.ts`** (append inside `policyRoutes`):
```ts
  app.post('/v1/policies/:id/claim-liquidation', async (req) => {
    const { id } = z.object({ id: Addr }).parse(req.params);
    const { txDigest } = z.object({ txDigest: z.string().min(32).max(64) }).parse(req.body);
    const { claimLiquidation } = await import('../workers/liquidationWatcher.js');
    return claimLiquidation(id, txDigest);
  });
```

**Exit checks**
- `pnpm peek:suilend` prints a real LiquidateEvent JSON; field names in `LIQ_FIELDS` and the enclave match it.
- `curl $ENCLAVE_URL/health_check` → `sui-mainnet.gateway.tatum.io: true`.
- Direct enclave call with a real liquidation digest + its obligation id returns `{response:{intent:1, timestamp_ms, data}, signature}`.
- **Signature check without spending a policy**: buy a liquidation policy (any obligation id, 1-day) — then call `claim-liquidation` with a digest whose obligation does **not** match → `UPSTREAM_ENCLAVE` "no LiquidateEvent for this obligation". This proves the enclave rejects mismatches.
- **Full path**: buy a 7-day liquidation policy on an obligation you control and that you deliberately make liquidatable on Mainnet with a tiny position (a few dollars, high LTV, volatile collateral). When Suilend liquidates it, SSE shows `liquidation.seen` → `policy.paid` (`path: liquidation`). If you can't get a live liquidation before the deadline, demonstrate the enclave + on-chain verification with the mismatch test above and show the auto-claim code path; say so honestly in the demo.

**Commit:** `feat: P7 nautilus liquidation attestation, suilend watcher`

---

### P8 — Learning loop, underwriter book, backtest seeding

**Goal:** outcomes become memories that change future prices; underwriter book/memory endpoints; ≥ 10 Mainnet memories via backtest seeding.

**`backend/src/policies/learning.ts`**
```ts
import { db } from '../db.js';
import { env, C, type Asset } from '../config.js';
import { bus, type BusEvent } from '../bus.js';
import { enqueueCase } from '../memory/cases.js';
import { matchRule, saveRule, ruleId, type Rule } from '../memory/rules.js';
import { writeLesson } from '../pricing/explain.js';
import { appendRecord } from '../memory/records.js';
import { enqueueMemory } from '../memory/queue.js';
import { volBucket, moneyBucket, durBucket } from '../pricing/buckets.js';
import { getPolicyRow } from './sync.js';
import { log } from '../log.js';

type QuotePricing = { pricing: { spotUsd: number; volAnnual: number } };

function bucketsFor(policyId: string) {
  const p = getPolicyRow(policyId)!;
  const q = db.prepare('SELECT dto FROM quotes WHERE id = ?').get(p.quote_id) as { dto: string } | undefined;
  const pr = q ? (JSON.parse(q.dto) as QuotePricing).pricing : { spotUsd: Number(BigInt(p.strike_e8)) / 1e8 / 0.9, volAnnual: 0.8 };
  const strikeUsd = Number(BigInt(p.strike_e8)) / 1e8;
  const days = Math.max(1, Math.round((p.end_ms - p.start_ms) / 86_400_000));
  return { p, asset: p.asset as Asset, volBucket: volBucket(pr.volAnnual), moneyBucket: moneyBucket(pr.spotUsd, strikeUsd), durBucket: durBucket(days) };
}

async function onPaid(policyId: string, path: string, digest: string) {
  const b = bucketsFor(policyId);
  if (b.p.learned) return;
  db.prepare('UPDATE policies SET learned = 1 WHERE id = ?').run(policyId);
  enqueueCase({ v: 1, asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, durBucket: b.durBucket, outcome: 'payout', source: 'live', policyId, note: `paid via ${path}`, at: Date.now() }, `case:${policyId}`);
  const existing = matchRule(b.asset, b.volBucket, b.moneyBucket);
  const lesson = await writeLesson({ asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, path, payout: b.p.payout, premium: b.p.premium });
  const rule: Rule = existing
    ? { ...existing, multiplier: Math.min(2, Number((existing.multiplier * 1.1).toFixed(4))), status: 'active', lesson, payouts: existing.payouts + 1, quietExpiries: 0, updatedAt: Date.now() }
    : { ruleId: ruleId(b.asset, b.volBucket, b.moneyBucket), asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, multiplier: 1.25, status: 'trial', lesson, payouts: 1, quietExpiries: 0, blobId: null, updatedAt: Date.now() };
  saveRule(rule);
  appendRecord(b.p.holder, 'payout', { policyId, payout: b.p.payout, path }, [digest]);
  enqueueMemory({ account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies, purpose: `policy:${policyId}:paid`,
    text: `policy paid ${b.asset} ${C.PREFIX.policy}${JSON.stringify({ policyId, status: 'paid', path, payout: b.p.payout, digest })}` });
}

async function onExpired(policyId: string, digest: string) {
  const b = bucketsFor(policyId);
  if (b.p.learned) return;
  db.prepare('UPDATE policies SET learned = 1 WHERE id = ?').run(policyId);
  const outcome = b.p.near_miss ? 'near_miss' : 'expired';
  if (outcome === 'near_miss') {
    enqueueCase({ v: 1, asset: b.asset, volBucket: b.volBucket, moneyBucket: b.moneyBucket, durBucket: b.durBucket, outcome, source: 'live', policyId, note: 'came within 3% of trigger', at: Date.now() }, `case:${policyId}`);
  }
  const r = matchRule(b.asset, b.volBucket, b.moneyBucket);
  if (r) {
    const quiet = r.quietExpiries + 1;
    let multiplier = r.multiplier, status = r.status;
    if (quiet >= 5) { multiplier = Number((r.multiplier * 0.9).toFixed(4)); if (multiplier <= 1.05) status = 'retired'; }
    saveRule({ ...r, multiplier, status, quietExpiries: quiet >= 5 ? 0 : quiet, updatedAt: Date.now() });
  }
  appendRecord(b.p.holder, 'expired', { policyId, nearMiss: !!b.p.near_miss }, [digest]);
  enqueueMemory({ account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.policies, purpose: `policy:${policyId}:expired`,
    text: `policy expired ${b.asset} ${C.PREFIX.policy}${JSON.stringify({ policyId, status: 'expired', nearMiss: !!b.p.near_miss, digest })}` });
}

export function startLearning() {
  bus.on('event', (ev: BusEvent) => {
    const d = ev.payload as { policyId?: string; path?: string; digest?: string };
    if (!d?.policyId) return;
    if (ev.type === 'policy.paid') onPaid(d.policyId, d.path ?? 'price', d.digest ?? '').catch((e) => log.error('learning onPaid', { message: (e as Error).message }));
    if (ev.type === 'policy.expired') onExpired(d.policyId, d.digest ?? '').catch((e) => log.error('learning onExpired', { message: (e as Error).message }));
  });
}
```

**`backend/src/routes/underwriter.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { C, env } from '../config.js';
import { AppError } from '../errors.js';
import { allRules } from '../memory/rules.js';
import { underwriter, recall, listAll } from '../memory/client.js';
import { writesSummary } from '../memory/queue.js';
import { poolCached } from '../chain/poolCache.js';
import { setPaused } from '../chain/ghostwriterTx.js';

const NS = { cases: C.NS.cases, rules: C.NS.rules, quotes: C.NS.quotes, policies: C.NS.policies } as const;

export async function underwriterRoutes(app: FastifyInstance) {
  app.get('/v1/underwriter/book', async () => {
    const pool = await poolCached(10_000);
    const active = (db.prepare(`SELECT COUNT(*) AS n FROM policies WHERE status IN ('active','breach')`).get() as { n: number }).n;
    const hist = db.prepare(`SELECT id, created_at, dto FROM quotes ORDER BY created_at DESC LIMIT 50`).all() as Array<{ id: string; created_at: number; dto: string }>;
    return {
      vault: pool.vault.toString(), locked: pool.locked.toString(), free: pool.free.toString(),
      premiumsCollected: pool.premiumsCollected.toString(), payoutsMade: pool.payoutsMade.toString(),
      lossRatio: pool.premiumsCollected === 0n ? 0 : Number(pool.payoutsMade) / Number(pool.premiumsCollected),
      activePolicies: active,
      rules: allRules().map(({ blobId: _b, updatedAt: _u, ...r }) => r),
      multiplierHistory: hist.reverse().map((h) => ({ at: h.created_at, quoteId: h.id, multiplier: (JSON.parse(h.dto) as { pricing: { multiplier: number } }).pricing.multiplier })),
    };
  });

  app.get('/v1/underwriter/memory', async (req) => {
    const q = z.object({ namespace: z.enum(['cases', 'rules', 'quotes', 'policies']), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const ns = NS[q.namespace];
    const [meta, hits] = await Promise.all([listAll(underwriter, ns, 1000), recall(underwriter, ns, `${q.namespace} ghostwriter`, q.limit, 'recent')]);
    const textByBlob = new Map(hits.map((h) => [h.blob_id, h.text]));
    const items = meta.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, q.limit)
      .map((m) => ({ blobId: m.blob_id, createdAt: m.created_at ?? null, endEpoch: m.end_epoch ?? null, expiresAt: m.expires_at ?? null, text: textByBlob.get(m.blob_id) ?? null }));
    return { namespace: ns, indexedCount: meta.length, items };
  });

  app.get('/v1/memory/writes', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return writesSummary(limit);
  });

  const admin = (h: unknown) => { if (h !== env.ADMIN_TOKEN) throw new AppError('UNAUTHORIZED', 'admin token required'); };
  app.post('/v1/admin/restore', async (req) => {
    admin(req.headers['x-admin-token']);
    const { namespace } = z.object({ namespace: z.string().min(1) }).parse(req.body);
    return underwriter.restore(namespace, 100);
  });
  app.post('/v1/admin/pause', async (req) => {
    admin(req.headers['x-admin-token']);
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    return setPaused(paused);
  });
}
```

**`backend/scripts/seed-backtest.ts`**
```ts
// Writes backtest aggregate cases to the underwriter's Walrus Memory on MAINNET (direct, paced writes).
// Usage: pnpm seed            (≈ 20–24 memories, ~2 minutes)
import { MemWal } from '@mysten-incubation/memwal';
import { env, C, ASSETS, type Asset } from '../src/config.js';
import { fetchCloses, annualizedVol } from '../src/pricing/vol.js';
import { volBucket, type VolBucket, type MoneyBucket } from '../src/pricing/buckets.js';
import { caseText, type CaseRec } from '../src/memory/cases.js';
import { sleep } from '../src/util/sleep.js';

const mem = MemWal.create({ key: env.MEMWAL_UNDERWRITER_KEY, accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL, namespace: C.NS.cases });
const DIST: Array<[number, MoneyBucket]> = [[0.07, '5-10'], [0.12, '10-15'], [0.20, '15-25'], [0.30, '25+']];
const HORIZON = 7;

const agg = new Map<string, { asset: Asset; vb: VolBucket; mb: MoneyBucket; n: number; hits: number }>();
for (const asset of ASSETS) {
  const closes = (await fetchCloses(asset, 400)).map((c) => c.close);
  for (let i = 31; i + HORIZON < closes.length; i++) {
    const vb = volBucket(annualizedVol(closes.slice(i - 30, i + 1)));
    const minAhead = Math.min(...closes.slice(i + 1, i + 1 + HORIZON));
    for (const [d, mb] of DIST) {
      const key = `${asset}:${vb}:${mb}`;
      const a = agg.get(key) ?? { asset, vb, mb, n: 0, hits: 0 };
      a.n += 1;
      if (minAhead <= closes[i] * (1 - d)) a.hits += 1;
      agg.set(key, a);
    }
  }
}

let written = 0;
for (const a of agg.values()) {
  const rec: CaseRec = { v: 1, asset: a.asset, volBucket: a.vb, moneyBucket: a.mb, durBucket: '4-7d', outcome: 'backtest', source: 'backtest', n: a.n, hits: a.hits, note: `daily closes, ${HORIZON}d horizon, Tatum OHLCV`, at: Date.now() };
  const r = await mem.rememberAndWait(caseText(rec), C.NS.cases);
  written++;
  console.log(`✔ ${a.asset} ${a.vb} ${a.mb}%  ${a.hits}/${a.n}  blob ${r.blob_id}`);
  await sleep(C.MEMWAL_WRITE_GAP_MS);
}
console.log(`done: ${written} backtest memories on Mainnet`);
```
> Daily closes under-count intraday touches, so backtest hit rates are a lower bound. The case factor blends them in by sample size and caps the effect at ×0.7–×1.8; live payouts add on top. Say this in the blog.

Wire in `server.ts`: register `underwriterRoutes`; call `startLearning()` (final in P9).

**Commands**
```bash
pnpm seed
pnpm dev
curl -s 'localhost:8787/v1/underwriter/memory?namespace=cases&limit=5' | jq
# Quote the same bucket twice: once now, once after a forced payout on the test pool → multiplier rises, citations include the new case/rule.
```

**Exit checks**
- Seed prints ≥ 10 `✔` lines with blob IDs; `/v1/underwriter/memory?namespace=cases` → `indexedCount ≥ 10`, items show `endEpoch`.
- A quote in a seeded bucket cites a `backtest` case and `factors.cases ≠ 1`.
- After one live payout in a bucket: next quote in that bucket has `factors.rules = 1.25` and cites the new rule (after its memory write lands); SSE shows `rule.updated`.
- Fresh DB (`rm data/ghostwriter.db`) + restart → rules rebuilt from Walrus (`/v1/underwriter/book.rules` not empty).

**Commit:** `feat: P8 learning loop, underwriter book, backtest memories`

---

### P9 — x402 agent payments + final server

**Goal:** an AI agent buys cover by paying over HTTP 402; the payment payload is the signed purchase transaction, so payment and policy issuance are one atomic on-chain step.

**`backend/src/x402/agent.ts`**
```ts
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../config.js';
import { AppError, chainAbort } from '../errors.js';
import { testnet, tatum } from '../chain/clients.js';
import { getQuote, type QuoteDTO } from '../pricing/quote.js';
import { confirmFromDigest, type PolicyDTO } from '../policies/sync.js';
import { emit } from '../bus.js';

/** The official Sui exact spec only shows `sui:mainnet`; testnet id follows the same pattern (OPEN-9). */
export const X402_NETWORK = 'sui:testnet';

export function paymentRequired(quote: QuoteDTO, error: string) {
  const usd = (n: string) => (Number(n) / 10 ** env.COIN_DECIMALS).toFixed(2);
  return {
    x402Version: 2,
    error,
    resource: {
      url: `${env.PUBLIC_BASE_URL}/v1/agent/cover`,
      description: `Ghostwriter cover: ${quote.kind} ${quote.asset} below $${(Number(quote.strikeE8) / 1e8).toFixed(4)} until ${new Date(quote.endMs).toISOString()}, payout ${usd(quote.payout)} DUSDC`,
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'exact',
      network: X402_NETWORK,
      amount: quote.premium,
      asset: env.COIN_TYPE,
      payTo: env.GHOSTWRITER_POOL_ID,
      maxTimeoutSeconds: 120,
      extra: { quote, how: 'Build a PTB calling quote.moveCall.target with args in quote.moveCall.argOrder; sign; send base64 JSON in PAYMENT-SIGNATURE' },
    }],
  };
}

/** x402 v2 PaymentPayload for the Sui exact scheme: payload = { signature, transaction } (both base64). */
const PaymentPayload = z.object({
  x402Version: z.literal(2),
  accepted: z.object({ scheme: z.literal('exact'), network: z.literal(X402_NETWORK) }).passthrough(),
  payload: z.object({ signature: z.string().min(16), transaction: z.string().min(16) }),
}).passthrough();

export function decodeHeader(header: string) {
  try { return PaymentPayload.parse(JSON.parse(Buffer.from(header, 'base64').toString('utf8'))); }
  catch { throw new AppError('BAD_REQUEST', 'payment header is not base64 JSON in the x402 v2 exact/sui shape'); }
}

type Cmd = { $kind: string; MoveCall?: { package: string; module: string; function: string; arguments: Array<{ $kind: string; Input?: number }> } };
type Inp = { $kind: string; Pure?: { bytes: string } };

/** Reads the quote id out of the signed tx's single ghostwriter::buy call (the quote id is not repeated in the payload). */
function readBuy(bytes: Uint8Array): { payer: string; quoteId: string } {
  const data = Transaction.from(bytes).getData() as unknown as { sender?: string; commands: Cmd[]; inputs: Inp[] };
  const payer = normalizeSuiAddress(data.sender ?? '0x0');
  const pkg = normalizeSuiAddress(env.GHOSTWRITER_PACKAGE_ID);
  const buys = data.commands.filter((c) => c.$kind === 'MoveCall' && c.MoveCall && normalizeSuiAddress(c.MoveCall.package) === pkg && c.MoveCall.module === 'ghostwriter' && c.MoveCall.function === 'buy');
  if (buys.length !== 1) throw new AppError('BAD_REQUEST', 'transaction must contain exactly one ghostwriter::buy call');
  const arg = buys[0].MoveCall!.arguments[9];
  const input = arg?.$kind === 'Input' && arg.Input !== undefined ? data.inputs[arg.Input] : undefined;
  if (!input?.Pure) throw new AppError('BAD_REQUEST', 'quote_id must be a pure input');
  return { payer, quoteId: Buffer.from(bcs.vector(bcs.u8()).parse(fromBase64(input.Pure.bytes))).toString('hex') };
}

/** For error replies: the quote a header points at, or null if the header can't be read. */
export function quoteIdFromHeader(header: string): string | null {
  try { return readBuy(fromBase64(decodeHeader(header).payload.transaction)).quoteId; } catch { return null; }
}

/** Verifies the signed tx is exactly a ghostwriter::buy for an issued quote by the quoted buyer, then executes it via Tatum. */
export async function settlePayment(header: string): Promise<{ policy: PolicyDTO; digest: string; payer: string; quote: QuoteDTO }> {
  const xp = decodeHeader(header);
  const bytes = fromBase64(xp.payload.transaction);
  const { payer, quoteId } = readBuy(bytes);
  const quote = getQuote(quoteId);
  if (!quote) throw new AppError('NOT_FOUND', 'unknown quote');
  if (quote.status === 'used') throw new AppError('CONFLICT', 'quote already used');
  if (quote.status === 'expired' || Date.now() > quote.expiresMs) throw new AppError('QUOTE_EXPIRED', 'quote expired; request a new 402');
  if (payer !== quote.buyer) throw new AppError('BAD_REQUEST', 'transaction sender is not the quoted buyer');

  const result = await tatum(() => testnet.executeTransaction({ transaction: bytes, signatures: [xp.payload.signature], include: { effects: true } }), 'x402:execute', 0)
    .catch((e: Error) => { throw /abort/i.test(e.message) ? chainAbort(e.message) : e; });
  const t = result.Transaction ?? result.FailedTransaction;
  if (!t.status.success) throw chainAbort(t.status.error?.message ?? 'buy failed');
  db.prepare('INSERT OR IGNORE INTO payments(digest, quote_id, payer, created_at) VALUES (?, ?, ?, ?)').run(t.digest, quote.quoteId, payer, Date.now());
  await tatum(() => testnet.waitForTransaction({ digest: t.digest }), 'x402:wait');
  const policy = await confirmFromDigest(t.digest, quote.quoteId);
  emit('x402.settled', { quoteId: quote.quoteId, payer, digest: t.digest, policyId: policy.policyId });
  return { policy, digest: t.digest, payer, quote };
}
```

**`backend/src/routes/agent.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { makeQuote, getQuote, QuoteInput } from '../pricing/quote.js';
import { paymentRequired, settlePayment, quoteIdFromHeader, X402_NETWORK } from '../x402/agent.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

export async function agentRoutes(app: FastifyInstance) {
  app.post('/v1/agent/cover', async (req, reply) => {
    // x402 v2 calls the header PAYMENT-SIGNATURE; v1 clients send X-PAYMENT. Accept both.
    const raw = req.headers['payment-signature'] ?? req.headers['x-payment'];
    const send402 = (quote: Parameters<typeof paymentRequired>[0], error: string) => {
      const body = paymentRequired(quote, error);
      reply.header('payment-required', b64(body));
      return reply.status(402).send(body);
    };
    if (!raw) return send402(await makeQuote(QuoteInput.parse(req.body)), 'payment required');
    const h = Array.isArray(raw) ? raw[0] : raw;
    try {
      const r = await settlePayment(h);
      const receipt = b64({ success: true, transaction: r.digest, network: X402_NETWORK, payer: r.payer });
      reply.header('payment-response', receipt);
      reply.header('x-payment-response', receipt);
      return r.policy;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const qid = quoteIdFromHeader(h);
      const quote = qid ? getQuote(qid) : null;
      if (quote && quote.status === 'issued') return send402(quote, e.message);
      throw e;
    }
  });
}
```

**`backend/scripts/agent-buyer.ts`** (the autonomous buyer used in the demo; also the reference PTB for the frontend)
```ts
// Usage: AGENT_PRIVATE_KEY=suiprivkey1… MAX_PREMIUM_USDC=1 pnpm agent
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { toBase64 } from '@mysten/sui/utils';
import { testnet, tatum } from '../src/chain/clients.js';
import { env } from '../src/config.js';

const API = process.env.API ?? 'http://localhost:8787';
const kp = Ed25519Keypair.fromSecretKey(process.env.AGENT_PRIVATE_KEY ?? '');
const me = kp.toSuiAddress();
const maxPremium = Number(process.env.MAX_PREMIUM_USDC ?? '1') * 10 ** env.COIN_DECIMALS;
const hex = (h: string) => Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

const market = (await (await fetch(`${API}/v1/market`)).json()) as { assets: Array<{ asset: string; spotUsd: number }> };
const sui = market.assets.find((a) => a.asset === 'SUI')!;
const body = { buyer: me, kind: 'price', asset: 'SUI', triggerPriceUsd: Number((sui.spotUsd * 0.85).toFixed(4)), payoutUsdc: 5, durationDays: 3 };

const r1 = await fetch(`${API}/v1/agent/cover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}: ${await r1.text()}`);
const pr402 = (await r1.json()) as { resource: unknown; accepts: Array<Record<string, unknown> & { extra: { quote: any } }> };
const req = pr402.accepts[0];
const q = req.extra.quote;
console.log(`402 → premium ${Number(q.premium) / 1e6} DUSDC, p=${q.pricing.probability}, ×${q.pricing.multiplier}`);
if (Number(q.premium) > maxPremium) { console.log('agent policy: premium above my budget, not buying'); process.exit(0); }

const cfg = (await (await fetch(`${API}/v1/config`)).json()) as { poolId: string };
const coins = (await tatum(() => testnet.listCoins({ owner: me, coinType: env.COIN_TYPE, limit: 50 }))).objects;
if (!coins.length) throw new Error('agent has no DUSDC');
const tx = new Transaction();
const pay = tx.object(coins[0].objectId);
if (coins.length > 1) tx.mergeCoins(pay, coins.slice(1).map((c) => tx.object(c.objectId)));
tx.moveCall({
  target: q.moveCall.target,
  typeArguments: q.moveCall.typeArguments,
  arguments: [
    tx.object(cfg.poolId), tx.pure.u8(q.kindU8), tx.pure.vector('u8', hex(q.feedId)), tx.pure.u64(q.strikeE8),
    tx.pure.address(q.obligationId), tx.pure.u64(q.payout), tx.pure.u64(q.premium), tx.pure.u64(q.startMs), tx.pure.u64(q.endMs),
    tx.pure.vector('u8', hex(q.quoteId)), tx.pure.u64(q.expiresMs), tx.pure.vector('u8', hex(q.signatureHex)), pay, tx.object.clock(),
  ],
});
tx.setSender(me);
const bytes = await tx.build({ client: testnet });
const { signature } = await kp.signTransaction(bytes);
// x402 v2 PaymentPayload (Sui exact scheme): echo what we accepted, attach the signed tx.
const { extra: _extra, ...accepted } = req;
const xPayment = Buffer.from(JSON.stringify({ x402Version: 2, resource: pr402.resource, accepted: { ...accepted, extra: {} }, payload: { signature, transaction: toBase64(bytes) } })).toString('base64');

const r2 = await fetch(`${API}/v1/agent/cover`, { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': xPayment }, body: JSON.stringify(body) });
console.log('status', r2.status);
const pr = r2.headers.get('payment-response');
if (pr) console.log('PAYMENT-RESPONSE', JSON.parse(Buffer.from(pr, 'base64').toString('utf8')));
console.log(JSON.stringify(await r2.json(), null, 2));
```

**`backend/src/server.ts`** (final)
```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env, corsOrigins } from './config.js';
import { AppError } from './errors.js';
import { log } from './log.js';
import { metaRoutes } from './routes/meta.js';
import { eventRoutes } from './routes/events.js';
import { borrowerRoutes } from './routes/borrowers.js';
import { quoteRoutes } from './routes/quotes.js';
import { policyRoutes } from './routes/policies.js';
import { underwriterRoutes } from './routes/underwriter.js';
import { agentRoutes } from './routes/agent.js';
import { startMemoryWorker } from './memory/queue.js';
import './memory/records.js';
import { rebuildRulesFromMemory } from './memory/rules.js';
import { startPolicyDiscovery } from './policies/sync.js';
import { startLearning } from './policies/learning.js';
import { startPriceWatcher, priceTick } from './workers/priceWatcher.js';
import { startCheckpointPulse } from './workers/checkpointPulse.js';
import { startLiquidationWatcher } from './workers/liquidationWatcher.js';
import { startHedger } from './workers/hedger.js';

for (const k of ['GHOSTWRITER_PACKAGE_ID', 'GHOSTWRITER_POOL_ID', 'GHOSTWRITER_ADMIN_CAP_ID'] as const) {
  if (!env[k]) { log.error(`${k} is empty — finish P1/P3 first`); process.exit(1); }
}

const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
await app.register(cors, {
  origin: corsOrigins, methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['content-type', 'x-payment', 'x-admin-token', 'last-event-id'], exposedHeaders: ['x-payment-response'],
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) return reply.status(err.status).send(err.toBody());
  if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.issues[0]?.message ?? 'invalid request', details: { issues: err.issues } } });
  if ((err as { statusCode?: number }).statusCode === 400) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.message, details: {} } });
  log.error('unhandled', { message: err.message });
  return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error', details: {} } });
});

await app.register(metaRoutes);
await app.register(eventRoutes);
await app.register(borrowerRoutes);
await app.register(quoteRoutes);
await app.register(policyRoutes);
await app.register(underwriterRoutes);
await app.register(agentRoutes);

startMemoryWorker();
log.info('rules from memory', { count: await rebuildRulesFromMemory() });
startLearning();
startPolicyDiscovery();
startPriceWatcher();
startCheckpointPulse(() => void priceTick());
startLiquidationWatcher();
if (env.HEDGE_ENABLED) startHedger();

await app.listen({ port: env.PORT, host: '0.0.0.0' });
log.info(`ghostwriter backend on :${env.PORT}`);

const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**Commands**
```bash
pnpm typecheck && pnpm dev
# agent wallet: new testnet key with SUI (faucet) + DUSDC (form)
AGENT_PRIVATE_KEY=suiprivkey1... MAX_PREMIUM_USDC=1 pnpm agent
```

**Exit checks**
- First call prints `402 → premium …`. Second call prints `status 200`, `PAYMENT-RESPONSE { success: true, transaction, network: 'sui:testnet', payer }`, and a `PolicyDTO`.
- SSE shows `quote.issued`, `x402.settled`, `policy.bought`.
- Replaying the same payment header → 409 `CONFLICT` (quote already used).
- Tampering with the header's `quoteId` → 402 with `"error": "transaction is for a different quote"`.

**Commit:** `feat: P9 x402 agent cover (payment = policy purchase), final server`

---

### P10 — Hedger (optional; `HEDGE_ENABLED=false` by default)

**Goal:** for BTC price cover, the underwriter buys a DeepBook Predict "down" position with part of the premium. DeepBook Predict on Testnet: BTC only, queued orders filled at Pyth's signed price, entry probability must be 0.15–0.85, premium ≥ 1 USDC, 0.02 USDC order fee, trading closes 10 s before expiry (Sui docs). So the hedge is **partial**, near the money, on the nearest admissible expiry — say "partial hedge" in the demo.

**One-time setup** — create and fund the server's Predict account (confirmed SDK call `client.predict.tx.deposit(owner, amount, { create: true })`):

**`backend/scripts/hedge-setup.ts`**
```ts
// Usage: pnpm tsx scripts/hedge-setup.ts 20     (deposits 20 DUSDC into the server's Predict account)
import { predict } from '@mysten/deepbook-v3/predict';
import { testnet, serverAddress, execServer } from '../src/chain/clients.js';

const client = testnet.$extend(predict({ network: 'testnet' }));
const amount = Number(process.argv[2] ?? '20');
let exists = true;
try { await client.predict.read.balance(serverAddress); } catch { exists = false; }
const tx = client.predict.tx.deposit(serverAddress, amount, exists ? undefined : { create: true });
const r = await execServer(tx, 'predict:deposit');
console.log('digest', r.digest, 'wrapper', client.predict.wrapperIdFor(serverAddress));
console.log('balance', await client.predict.read.balance(serverAddress));
```

**`backend/src/workers/hedger.ts`**
```ts
import { predict } from '@mysten/deepbook-v3/predict';
import { db } from '../db.js';
import { env } from '../config.js';
import { testnet, serverAddress, execServer, tatum } from '../chain/clients.js';
import { onNewPolicy, type PolicyDTO } from '../policies/sync.js';
import { emit } from '../bus.js';
import { log } from '../log.js';
import { workerState } from '../state.js';

const client = testnet.$extend(predict({ network: 'testnet' }));

function setHedge(policyId: string, status: string, detail: string) {
  db.prepare('UPDATE policies SET hedge_status = ?, hedge_detail = ? WHERE id = ?').run(status, detail.slice(0, 300), policyId);
}

async function hedge(p: PolicyDTO) {
  setHedge(p.policyId, 'queued', 'planning');
  const budgetUsdc = (Number(p.premium) / 10 ** env.COIN_DECIMALS) * env.HEDGE_RATIO;
  if (budgetUsdc < 1.05) { setHedge(p.policyId, 'failed', `budget ${budgetUsdc.toFixed(2)} below DeepBook minimum premium (1 USDC + fee)`); emit('hedge.failed', { policyId: p.policyId, detail: 'budget below minimum' }); return; }

  const now = Date.now();
  const markets = (await client.predict.read.markets()).filter((m) => !m.mintPaused && m.referencePrice !== null && Number(m.expiryMs) - now >= 30 * 60_000);
  const inWindow = markets.filter((m) => Number(m.expiryMs) <= p.endMs).sort((a, b) => (a.expiryMs > b.expiryMs ? -1 : 1));
  const market = inWindow[0] ?? markets.sort((a, b) => (a.expiryMs < b.expiryMs ? -1 : 1))[0];
  if (!market) { setHedge(p.policyId, 'failed', 'no tradeable BTC market'); emit('hedge.failed', { policyId: p.policyId, detail: 'no market' }); return; }

  // Signatures from MystenLabs/ts-sdks deepbook-v3/src/predict/client.ts (OPEN-7).
  const m = { underlying: 'BTC', expiryMs: market.expiryMs, marketId: market.id, side: 'down' as const, strike: 'reference' as const };
  const plan = await client.predict.read.planMint(serverAddress, m, { amount: budgetUsdc, orderFee: 'inclusive', slippageCents: 'auto' });
  if (!plan.accepting || plan.refusal != null) { setHedge(p.policyId, 'failed', `refused: ${String(plan.refusal)}`); emit('hedge.failed', { policyId: p.policyId, detail: plan.refusal }); return; }
  const { transaction } = await client.predict.tx.enqueuePlan(serverAddress, m, plan);
  const { digest } = await execServer(transaction, 'predict:enqueue');
  emit('hedge.placed', { policyId: p.policyId, detail: { digest, expiryMs: String(market.expiryMs) } });

  const full = await tatum(() => testnet.getTransaction({ digest, include: { effects: true, events: true } }));
  const { recordId } = client.predict.decode.enqueue(full as never);
  const res = await client.predict.read.waitForOutcome({ underlying: 'BTC', expiryMs: market.expiryMs, marketId: market.id }, recordId, { timeoutMs: 120_000 });
  const filled = res.outcome === 'filled';
  setHedge(p.policyId, filled ? 'filled' : 'refunded', JSON.stringify({ digest, recordId: String(recordId), outcome: res.outcome }));
  emit(filled ? 'hedge.filled' : 'hedge.failed', { policyId: p.policyId, detail: { digest, outcome: res.outcome } });
}

export function startHedger() {
  workerState.hedger = 'running';
  onNewPolicy((p) => {
    if (p.asset !== 'BTC' || p.kind !== 'price') return;
    hedge(p).catch((e) => { setHedge(p.policyId, 'failed', (e as Error).message); log.error('hedge failed', { message: (e as Error).message }); });
  });
}
```

**Exit checks** (only if you enable it)
- `hedge-setup` prints a balance ≥ deposit.
- Buying a BTC price policy with premium ≥ ~2.2 DUSDC (so 50% ≥ 1.05) → SSE `hedge.placed` then `hedge.filled`; `PolicyDTO.hedge.status = filled`.
- With `HEDGE_ENABLED=false`, `/v1/health.workers.hedger = 'disabled'` and nothing else changes.

**Commit:** `feat: P10 optional DeepBook Predict partial hedge`

---

### P11 — Deploy (optional), blog, submission

**Local demo (what you record):** `pnpm dev` + frontend on `localhost:5173`; enclave EC2 started and re-registered ≥ 30 min before recording.

**Railway (only if you want a public URL)**
1. New project → Deploy from GitHub → root directory `backend`.
2. Variables: everything from `.env` (secrets included — Railway stores them server-side), plus `NIXPACKS_NODE_VERSION=24`, `DB_PATH=/data/ghostwriter.db`, `PUBLIC_BASE_URL=https://<app>.up.railway.app`, `CORS_ORIGINS=<frontend origin>`.
3. Add a **Volume** mounted at `/data` (SQLite file survives redeploys).
4. Start command `pnpm start`. One instance only (workers must not run twice).
5. Check `GET /v1/health`.

**CORS the frontend needs:** origin in `CORS_ORIGINS`; request headers `content-type`, `x-payment`, `last-event-id`; exposed header `x-payment-response`; SSE sends `Access-Control-Allow-Origin` itself (it bypasses the CORS plugin because it hijacks the socket).

**Commit:** `chore: P11 deploy config`

---

## 7. Threat model

| Attack | Defence | Phase | How we demo it |
|---|---|---|---|
| User edits premium/payout in their buy tx | `buy` rebuilds `QuoteMessage` from the args and verifies our Ed25519 signature; any change → `EBadQuoteSig` | P1, P5 | Change one byte of `premium` in a tx → abort code 3 |
| Replay of a quote | `used_quotes` table on-chain → `EQuoteUsed` | P1 | Second buy with same quote aborts 4 |
| Stale quote | `expires_ms` checked against `Clock` | P1 | Wait 2 min, buy → abort 2 |
| Pool over-sells cover | `free(pool) >= payout` after adding premium → `EInsufficientCapacity` | P1 | Fund pool small, quote big |
| Flash manipulation of price trigger | Pyth aggregated feed + confidence ≤ 2% + max age 60 s + breach must persist ≥ `confirm_delay_ms` across two txs | P1, P6 | Show `breach.reported` then `breach.reset` when price bounces |
| Forged liquidation | Payout requires an enclave signature over `IntentMessage{1, ts, LiquidationAttestation}`; enclave key registered only via a Nitro attestation with matching PCRs | P1, P7 | Wrong obligation → enclave refuses; tampered sig → `EBadAttestation` |
| Old enclave after code change | `config_version` must equal current config version → `EStaleEnclave` | P1 | `update_pcrs` without re-register → claims abort 18 |
| Liquidation outside cover window | `timestamp_ms` (checkpoint time, signed) must be in `[start, end]` | P1 | Claim with an older liquidation → abort 9 |
| Borrower forges good history | Records Ed25519-signed by our record key; borrower doesn't have it | P4 | Edit a record's data → `sigValid: false`, `valid: false` |
| Borrower hides bad records | Hash chain + `(seq, head)` anchored on-chain by `AdminCap` only | P4 | `verification.reasons` shows the gap / anchor mismatch |
| Borrower revokes our delegate key mid-cover | Records already written stay on Walrus; new writes fail → history becomes stale; `verifyHistory` still validates what exists; discount only applies to verified history | P4 | Remove key in dashboard → `memory.failed` for new records |
| Other delegates on the borrower's account read our records | Delegate access is account-wide (Walrus docs). Records contain no secrets; we tell users to use a dedicated account | P4 | Disclosure text in UI |
| x402 payload for someone else's quote | Sender must equal quote buyer; exactly one `buy` call; quote_id arg must match | P9 | Tampered header → 402 with reason |
| Secrets leak in logs | Logger redacts the exact value of every secret env var, plus `suiprivkey…`, `sk-…`, and any 64-hex run; config errors print names only | P2 | `grep` logs |
| Tatum rate limit / outage | Token bucket at `TATUM_RPS`, retries on transient codes, stream falls back to polling | P3, P6 | `/v1/health.workers.checkpointPulse = polling` |
| Walrus Memory relayer slow/outage | Write queue with backoff; reads retried; quotes fall back to neutral factors and say so in logs | P4, P5 | Kill network → quotes still work, `memory.failed` after retries |
| Prompt injection via memory text into OpenAI | LLM only explains numbers already computed; it never decides prices or payouts | P5 | — |

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `sui move build`: dependency conflict on `Sui`/`MoveStdlib` | Pyth and the Nautilus `enclave` package pin different framework revs | Add `override = true` to our `Sui = {…}` line (keep Pyth's rev `041c5f2b…`) and rebuild |
| Price calls abort / `PriceInfoObject` not found | Old Pyth IDs (`0x2437…`, `0x3135…`) — dead since 26 Aug 2026 | Use the Core Compatible IDs in §4 and `rev = "sui-pro-compatible-contract-testnet"` |
| Hermes `401`/`403` | Missing or expired `PYTH_API_KEY` | New key at app.pyth.com; restart |
| `Unpublished dependencies: enclave` | Enclave lib not published first | P1 step 1, then rebuild |
| `smoke`: Tatum gRPC `UNAUTHENTICATED` | Wrong key / header | `x-api-key` metadata; regenerate key |
| `smoke`: Tatum gRPC 415 or protocol error | Default gRPC-web transport used | Our clients use native `GrpcTransport` — check you didn't construct `SuiGrpcClient` with `baseUrl` |
| `RATE_LIMITED` bursts | Free plan 3 RPS | Lower `PRICE_POLL_MS`, keep `TATUM_RPS=3`, or upgrade plan |
| `checkpointPulse: polling` | Plan without streaming, or stream dropped | Fine; price watcher polls every `PRICE_POLL_MS` |
| Memory writes stuck `queued` with 429/401 | Relayer burst cap (~24/min) or "401 after burst" (issues #1114, #1157) | Queue already paces 3 s/account; wait; it retries with backoff |
| `401 AUTH_REJECTED` right after adding a delegate | Relayer delegate cache / chain lag | Retry after ~5–30 s |
| History `partial: true` | Recall returned fewer than indexed (OPEN-11) | `POST /v1/admin/restore {"namespace":"ghostwriter-history"}` is for the **underwriter** account only; for borrowers re-run later; keep records < 100 |
| Quote `UPSTREAM_TATUM … only N usable daily closes` | OHLCV body field names differ, or the symbol is unknown to Tatum | Look at the smoke OHLCV body; add the close/time field name in `vol.ts`; `DELETE FROM ohlcv_daily WHERE close = 0;` then `pnpm warm:ohlcv` |
| First quote takes ~15 s | Daily cache empty | Run `pnpm warm:ohlcv` once |
| `quotePubkeyMatches: false` | Pool created with another quote key | `set_quote_pubkey` with AdminCap, or recreate the pool |
| Buy aborts code 3 | Frontend arg order/type differs from `QuoteMessage` | Use `moveCall.argOrder`; `feedId`/`quoteId`/`signature` as `vector<u8>` bytes; `obligationId` as `address` |
| `report_breach` aborts 12 | Hermes view moved before execution | Harmless; next tick retries |
| `report_breach` aborts 11 | Pyth confidence > 2% | Wait; raise `max_conf_bps` only for testing |
| Pyth update throws about objects/state | Wrong state IDs or pyth-sui-js incompatibility (OPEN-2/3) | Re-check IDs on Pyth contract-address page; pin pyth-sui-js version from its README |
| Enclave `transaction not checkpointed yet` | Digest too fresh | Watcher retries next poll; manual: wait 5 s |
| Settlement aborts 16 `EBadAttestation` | BCS mismatch (Rust vs Move) or enclave restarted without re-register | Fields/order identical; re-run `register_enclave.sh`, update `ENCLAVE_OBJECT_ID` |
| Settlement aborts 18 `EStaleEnclave` | PCRs updated, old enclave object | Register again after `update_pcrs` |
| `seed` fails on second run with 429 | Relayer limits | Re-run later; it is idempotent in effect (duplicates only nudge weights) |
| SSE closes after ~60 s behind a proxy | Proxy idle timeout | `: ping` every 15 s already; disable buffering (`X-Accel-Buffering: no` set) |

---

## 9. Final submission checklist

- [ ] Underwriter MemWal account on **Mainnet**; `GET /v1/proof.mainnetMemories ≥ 10` (seed + live).
- [ ] At least one borrower account (yours) with ≥ 3 records, `history.verification.valid = true`, anchored on Testnet.
- [ ] Tatum used for: gRPC reads/execution on both networks, checkpoint stream, OHLCV, and inside the enclave. Mention each in the README.
- [ ] One full price payout (`breach.reported → policy.paid`) with digests saved.
- [ ] Liquidation path: enclave registered; attestation demo (live payout if achieved; otherwise the verification + refusal demo, stated honestly).
- [ ] x402 agent purchase recorded (`pnpm agent` output saved).
- [ ] Tests: `sui move test`, `pnpm test` green; `pnpm typecheck` clean.
- [ ] Public repo: README (architecture diagram from §1.2, run steps, env table without values), `docs/PINS.md` (exact versions + Nautilus commit + Move.lock).
- [ ] No `.env`, keys, or AWS creds in git (`git log -p | grep -E "suiprivkey|sk-"` returns nothing).
- [ ] Blog post published (outline below) — includes "how it learned over time" with real before/after quotes and blob IDs.
- [ ] Submission form: Tatum account ID, Sui address, Sui (MemWal) account ID, `MEMWAL_AGENT_ID` (= underwriter delegate public key from `/v1/proof.memwalAgentId`).
- [ ] Post on X/LinkedIn tagging @Tatum_io and @WalrusFoundation.
- [ ] Stop the EC2 instance after recording.
- [ ] Submitted before **10 Nov 17:00 UTC (22:30 IST)**.

**Blog outline:** (1) Problem: liquidations punish borrowers; agents forget their mistakes. (2) What Ghostwriter does, one paragraph. (3) How it uses Walrus Memory: underwriter cases/rules (with real blob IDs), borrower-owned signed history and why only portable, user-owned memory makes a no-claims bonus that travels. (4) How it uses Tatum: gRPC on two networks, checkpoint stream, OHLCV, enclave JSON-RPC. (5) How it learned: backtest seed → first quote; a payout → rule created → same quote later costs ×1.25, with the cited blob. (6) Trust: Pyth two-step trigger, Nautilus attestation, x402 agent purchase. (7) Honest limits: testnet money, partial hedge, daily-close backtest lower bound.

---

## 10. Demo script (3 minutes)

| Time | Screen | Terminal / chain | Sponsor beat |
|---|---|---|---|
| 0:00–0:20 | Landing: "Liquidation cover priced by an underwriter that remembers" | — | Problem in one line |
| 0:20–0:45 | Onboard: connect Slush → create Walrus Memory account → add Ghostwriter key → registered | SSE: `memory.written`, `ledger.anchored` | **Walrus Memory on Mainnet, owned by the borrower** |
| 0:45–1:20 | Quote SUI cover: price, probability, ×multiplier, **cited memories** (backtest case, rule, your record), OpenAI explanation | `GET /v1/market` shows Tatum OHLCV vol | **Memory visibly changes the price** |
| 1:20–1:40 | Buy with wallet → policy card active | Testnet digest link | Move vault + signed quote |
| 1:40–2:10 | Price trigger (pre-bought policy near spot): `breach.reported` → 2-min confirm → `policy.paid`, DUSDC lands | Checkpoint heartbeat from **Tatum gRPC stream** | Pyth two-step, no human |
| 2:10–2:30 | Underwriter page: new rule ×1.25 appears; re-quote same bucket → higher price citing the new rule blob | `rule.updated` | **Learning over time** |
| 2:30–2:45 | Terminal: `pnpm agent` → 402 → pays → policy | `x402.settled` | **Agent payments settled on Sui** |
| 2:45–3:00 | Liquidation proof: enclave health, attestation, Move `verify_signature` (live payout or refusal test) | EC2 + Testnet tx | Nautilus TEE |

---

## 11. Notes for the frontend doc (next step)
- Every frontend call is in §5. **No backend endpoint creates the Walrus Memory account or adds the delegate key** — the frontend does that in the browser with `@mysten-incubation/memwal/account` (`createAccount`, `addDelegateKey` with `walletSigner`, `packageId`/`registryId` from `/v1/config.memwal`), then calls `PUT /v1/borrowers/:address`. The exact `walletSigner` shape is an open item for the frontend doc.
- The buy PTB is exactly the one in `scripts/agent-buyer.ts` (wallet signs instead of a keypair), then `POST /v1/policies/confirm`.
- Wallet must be on **Testnet** for buying and **Mainnet** for the MemWal account steps; the UI must make the network switch explicit.

