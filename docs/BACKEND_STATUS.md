# Backend status

What is done and what is left on the Ghostwriter backend. Phases (P0–P11) are the ones in
[GHOSTWRITER_BACKEND.md](GHOSTWRITER_BACKEND.md). Updated with every backend commit.

**Last updated:** 9 Nov 2026 · **Deadline:** 10 Nov 2026, 17:00 UTC

## At a glance

| Phase | What | Status |
|---|---|---|
| P0 | Accounts, keys, tools | ✅ done |
| P1 | Move contract on Testnet | ✅ done |
| P2 | Server skeleton (config, SQLite, SSE, health) | ✅ done |
| P3 | Chain layer (Tatum gRPC, prices, tx builders), create + fund pool | ✅ done |
| P4 | Walrus Memory layer (queue, borrower records, onboarding) | ✅ done |
| P5 | Pricing, quotes, policy confirm, config/market/proof endpoints | ✅ done |
| P6 | Watchers: price trigger, expiry, warnings, checkpoint pulse | ✅ done |
| P7 | Nautilus enclave, Suilend reads, liquidation watcher | 🟡 code done, **needs AWS to run** |
| P8 | Learning loop, underwriter book, backtest seeding | ✅ done — **47 memories on Mainnet** |
| P9 | x402 agent payments | ✅ done — real purchase settled |
| P10 | DeepBook Predict hedge | ⏸ dropped (needs DUSDC; we use gUSD) |
| P11 | Blog, submission, X post | ⏳ yours |

## Proven end to end, on real networks

| Thing | Evidence |
|---|---|
| Walrus Memory writes on **Mainnet** | 47 memories on account `0x8b7608b6…f89ab`. `GET /v1/proof` → `mainnetMemories: 47` (45 backtest cases, 1 policy, 1 write-path check) |
| Live price from **on-chain Pyth** via Tatum | `GET /v1/market` → SUI $0.81, 53 s old, 30-day vol 72.8% |
| Memory changes the price, **both ways** | 7.5% below spot → ×0.96 (model slightly over-prices); 13.7% below → ×1.63 (model under-prices deep barriers). Each quote cites the blob id that moved it |
| Signed quote → Move `buy` | Quote Ed25519-signed by the backend, verified on-chain; byte-for-byte BCS test in `pnpm test` |
| Price payout, fully automatic | `pnpm e2e:price`: buy → report_breach → 2 min → confirm_breach → 5 gUSD paid |
| **x402 agent purchase** | `pnpm agent`: 402 → signed buy tx in `PAYMENT-SIGNATURE` → policy `0xab6a92da…32d6`, digest `7vgEBffKjhwxo5wHpNWCEc73GF6Pxmj3Kf7GjfWyNU3` |
| Tatum gRPC **streaming** | `checkpointPulse: stream` — real Testnet checkpoint sequence numbers over SSE |
| Tests | 17 node tests + 18 Move tests, all pass; `pnpm typecheck` clean |

## What runs where

- **Sui Mainnet** — Walrus Memory (underwriter + borrower accounts), Suilend reads. Via Tatum gRPC.
- **Sui Testnet** — our Move package, Pool, policies, payouts, x402 settlement. Via Tatum gRPC.
- **Money** — gUSD, our own test dollar with a public faucet (DUSDC's request form is closed).

## Endpoints live

`/v1/health` `/v1/config` `/v1/market` `/v1/proof` `/v1/events` (SSE) ·
`PUT|GET /v1/borrowers/:address` `/history` `/positions` ·
`POST /v1/quotes` `GET /v1/quotes/:id` ·
`POST /v1/policies/confirm` `GET /v1/policies` `GET /v1/policies/:id` `POST /v1/policies/:id/claim-liquidation` ·
`GET /v1/underwriter/book` `/v1/underwriter/memory` `/v1/memory/writes` `/v1/enclave/health` ·
`POST /v1/agent/cover` (x402) · `POST /v1/admin/pause` `/v1/admin/restore`

## Pending

1. **P7 needs AWS** (the only external blocker). All the code is written: `enclave/mod.rs`,
   `enclave/allowed_endpoints.yaml`, `src/enclave/client.ts`, `src/workers/liquidationWatcher.ts`,
   and the claim route. Without `ENCLAVE_URL` the liquidation path reports "enclave not configured"
   and everything else is unaffected. **The Rust has not been compiled** — it needs the Nautilus
   clone to build against.
2. **Borrower onboarding needs a browser** once: a second MemWalAccount owned by your own wallet,
   with our borrower delegate key added. The frontend onboarding page does this; the key to paste is
   in `GET /v1/config` → `memwal.borrowerDelegatePublicKeyHex`.
3. **P11** — blog, X/LinkedIn, submission form, repo public.
4. Frontend follow-ups (owner: frontend dev): show gUSD not DUSDC, add a "get test gUSD" button,
   hide BTC, surface `obligationVerified` and `explanationSource`.

## Decisions and changes from the build doc

| Change | Why |
|---|---|
| **gUSD** instead of DeepBook's DUSDC | The DUSDC request form is closed. `Pool<C>` is generic over the coin. This also kills P10, whose hedge needs DUSDC. |
| **On-chain Pyth object, no Hermes** | The Pyth free plan has no API access. Others push SUI/USD to Testnet every ~126 s and the contract only reads the object. |
| **Pool max price age 180 s** (doc: 60 s) | Must exceed the ~126 s push gap or every settlement aborts as stale. |
| **SUI only; BTC off** | The Testnet BTC/USD object is weeks stale. `ENABLED_ASSETS=SUI`. |
| **Vultr inference** instead of OpenAI, with `reasoning_effort: 'none'` | Your key. The model is a reasoning model: by default it spent the whole token budget thinking and returned `finish_reason: length` with empty text. Confirmed fix against the endpoint. |
| **Liquidation discovery polls obligations**, not events | Tatum's plan answers "gRPC method not allowed" for `ListEvents`/`SubscribeEvents`. Instead the watcher reads each covered obligation's `previousTransaction`; any change is a candidate and **the enclave decides** whether it was a liquidation. A refusal doubles as evidence the borrower reacted to a warning. The event-stream path is still in the code and activates automatically on a plan that allows it. |
| **Backtest uses intraday lows**, not closes | Tatum's OHLCV returns `high`/`low`. A barrier is touched intraday, so closes undercount hits. This makes the hit rates true barrier touches and removes a systematic downward bias in the case factor. |
| **Exact bucket match required for base rates** | Semantic recall put "distance=0-5 duration=8-30d" within 0.14 of "distance=5-10 duration=4-7d" — bucket hit rates differ wildly (92% vs 45%), and the first mispriced a 10 gUSD payout at 9.44. Recall now finds candidates; the JSON inside the memory decides the match. Live payouts still count from neighbouring buckets. |
| **`confirm_breach` checks the window end** | Added `now <= end_ms + confirm_delay_ms`. Without it, a holder could report a breach, never reset it, and confirm on any later dip — the contract was relying on our watcher for soundness. |
| **Obligation ownership checked at quote time** | Liquidation cover is refused unless the buyer holds the obligation; while `SUILEND_OBLIGATION_CAP_TYPE` is unset the quote reports `obligationVerified: null` rather than claiming it checked. |
| **`moneyBucket` rounds before comparing** | `1 - 0.9/1` is `0.09999999999999998`, so a trigger exactly 10% below spot keyed to the wrong bucket — and the bucket is the memory key. |
| **Node 26 / `node:sqlite`** | Node 26 is current LTS; `node:sqlite` avoids needing VS C++ build tools on Windows. |
| **Two Tatum keys** | One per network, each with its own rate bucket. |

## Run it

```bash
cd backend && pnpm install
pnpm keys          # one-time: writes admin token + signing keys into .env
pnpm smoke         # checks every upstream
pnpm warm:ohlcv    # one-time: fills the daily candle cache
pnpm dev           # http://localhost:8787
```

Demo scripts: `pnpm e2e:price` (price payout), `pnpm agent` (x402 purchase),
`pnpm seed --dry` (backtest table), `pnpm mem:ping` (Mainnet write path),
`pnpm peek:suilend <digest>` (Suilend shapes).
