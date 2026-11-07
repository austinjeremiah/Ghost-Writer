# Backend status

What is done and what is left on the Ghostwriter backend. Phases (P0–P11) are the ones in
[GHOSTWRITER_BACKEND.md](GHOSTWRITER_BACKEND.md). Updated with every backend commit.

**Last updated:** 7 Nov 2026 · **Plan:** get everything working end-to-end on Sui Testnet, then Mainnet.

## At a glance

| Phase | What | Status |
|---|---|---|
| P0 | Accounts, keys, tools | 🟡 mostly done (see blockers) |
| P1 | Move contract on Testnet | ✅ done |
| P2 | Server skeleton (config, SQLite, SSE, health) | ✅ done |
| P3 | Chain layer (Tatum gRPC, prices, tx builders), create + fund pool | 🔵 next |
| P4 | Walrus Memory layer (queue, borrower records, onboarding) | ⏳ pending |
| P5 | Pricing, quotes, policy confirm, config/market/proof endpoints | ⏳ pending |
| P6 | Watchers: price trigger, expiry, warnings, checkpoint pulse | ⏳ pending |
| P7 | Nautilus enclave on AWS, Suilend reads, liquidation watcher | ⏳ pending (needs AWS) |
| P8 | Learning loop, underwriter book, backtest seeding (≥10 Mainnet memories) | ⏳ pending |
| P9 | x402 agent payments + final server | ⏳ pending |
| P10 | DeepBook Predict hedge (optional, off by default) | ⏸ skipped for now |
| P11 | Deploy, blog, submission | ⏳ pending |

## Done

### P0: accounts and credentials
- Tatum API keys (Mainnet and Testnet). The data API works (SUI daily candles).
- Vultr inference key (used instead of OpenAI). Chat works with the configured model.
- Walrus Memory underwriter account on **Mainnet**: `0x8b7608b6c7911acb97353a6010280bfb687ce4396127e7d9b5c18c72c39f89ab`.
  The delegate key in `.env` is registered on it (checked on-chain).
- Server wallet on Testnet: `0xdd6389cc38a64526d84e6189ef8904cf8e83f4721b08f65fe96b8579b46e6f2b`.

### P1: contracts on Sui Testnet
All IDs are in [backend/move/DEPLOYMENTS.md](../backend/move/DEPLOYMENTS.md).
- `ghostwriter` package: `0xff272f596619f255a591323d32d7d0a3835fbdaf84718bdb61f7dec263e23060`
- Nautilus `enclave` package, vendored in `backend/move/enclave`: `0xc9c14c07…521802`
- `gusd` test dollar with a public faucet: `0x6dc2c1e1…::gusd::GUSD`
- Tests: 17 for `ghostwriter` (signed-quote buys and every rejection path, expiry, withdraw
  limits, ledger sequencing) and 3 for `gusd`. All pass.

### P2: server skeleton
- Fastify server: config validation (bad or missing env exits and prints names only, never values),
  log redaction, error format, SQLite schema (`node:sqlite`), event bus.
- `GET /v1/health` and `GET /v1/events` (SSE with replay from `Last-Event-ID`, ping every 15 s).
- `pnpm keys` writes the admin token, quote key, record key and borrower delegate key straight into
  `.env`, prints only public keys, and never overwrites existing keys.
  Quote public key (goes into the pool): `62a55ba3994c5d6df8e6aceda8e313c587e6e20627cbfffde50231bba73f6a16`.
- Checked: typecheck clean, health OK, SSE pings and survives disconnects, malformed JSON gives 400.
- Run it: `cd backend && pnpm install && pnpm dev`.

### Frontend
All 9 pages are built against the API contract (ICD §5). They show "backend not reachable" until
the server is running.

## In progress

Nothing. Next: **P3**, the chain layer, then create and fund the pool.

## Pending

- **P3:** Tatum gRPC clients (the gateways speak native gRPC only; JSON-RPC URLs return 404),
  reading prices from the on-chain Pyth object, tx builders, create the pool, fund it with gUSD,
  smoke test.
- **P4:** Walrus Memory write queue, borrower hash-chained records, onboarding endpoint.
- **P5:** volatility from Tatum candles, quote pricing and signing, memory citations, Vultr explanation.
- **P6:** watchers that report, confirm and reset breaches, expire policies and send warnings.
- **P7:** Nautilus enclave on AWS Nitro and the liquidation watcher.
- **P8:** learning rules from outcomes and seeding at least 10 backtest memories on Mainnet.
- **P9:** x402 agent purchase endpoint and agent script.
- **Frontend follow-up:** show gUSD instead of DUSDC, add a "Get test gUSD" faucet button,
  and hide BTC while it has no live testnet price.

## Blockers and things needed

| # | Need | Who | Blocks |
|---|---|---|---|
| 1 | **AWS account** with Nitro Enclaves (us-east-1) | you | P7 liquidation cover only |
| 2 | More testnet SUI for the **server wallet** `0xdd6389cc…6e6f2b` (0.49 SUI left). Faucet SUI sent on 7 Nov did not reach it | you | many server transactions |

## Decisions and changes from the build doc

| Change | Why |
|---|---|
| **gUSD** (our own test dollar) instead of DeepBook's DUSDC | The DUSDC request form is closed. `Pool<C>` accepts any coin. |
| **Prices read from the on-chain Pyth object on Testnet**, no Hermes API calls | The Pyth free plan has no API access. Pyth's SUI/USD object on Sui Testnet is pushed every ~126 s by others, and the contract only reads it. |
| **Pool max price age 180 s** (doc: 60 s) | It must be above the ~126 s update gap, or payout checks fail as "stale". |
| **SUI only on Testnet; BTC off** | The on-chain BTC/USD object was last updated 26 days ago. Re-enable it with a paid Pyth plan or a live feed. |
| **Vultr inference** instead of OpenAI | Your choice. OpenAI-compatible API, same `openai` client with a different base URL. |
| **Node 26 LTS** (installed with winget; the doc says 24) | Node 26 is the current LTS. It meets the backend's `>=24` and the Walrus Memory SDK's `>=20`. |
| **`node:sqlite`** instead of `better-sqlite3` | `better-sqlite3` needs Visual Studio C++ build tools on Windows. |
| **Two Tatum keys** (`TATUM_API_KEY_MAINNET`, `TATUM_API_KEY_TESTNET`) | Your setup. |
| **Move manifests use the new Sui package manager** | Sui CLI 1.73 cannot build old-style manifests against Nautilus. |
| **Walrus Console not used** | It is file storage, not Walrus Memory. Its keys were removed from `.env`. |
