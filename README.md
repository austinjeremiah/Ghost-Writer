# Ghostwriter

**AI-underwritten liquidation protection for Sui borrowers, priced by an underwriter whose memory lives on Walrus Memory.**

Built for **Total Recall — Tatum × Walrus Memory**. Track 03 Consumer Finance Apps, plus Best Walrus Memory and Best Use of Agent Payments.

---

## What it does

A Sui borrower asks for cover: *"if SUI stays below $0.75 for the next 7 days, pay me 10."* Ghostwriter prices it from real volatility, then **adjusts that price using what it remembers** — back-tested base rates, rules it learned from its own past losses, and the borrower's own portable history. The quote cites the exact Walrus blob that changed the price.

Payouts are automatic. A price trigger settles through a two-step Pyth check on-chain; a Suilend liquidation settles through a **Nautilus TEE attestation**. No claim form, no human.

An AI agent can buy cover over **x402** — and the payment payload *is* the signed purchase transaction, so paying and getting insured are one atomic on-chain step.

## Why memory is load-bearing

Remove Walrus Memory and the product loses both its learning and its portability:

- **Pricing depends on it.** Case recall and rule recall set the premium multiplier. Live numbers from this build: a barrier 7.5% below spot prices at **×0.96** (400 days of history say our model slightly over-prices it), while a barrier 13.7% below prices at **×1.63** (the Gaussian model badly under-prices deep barriers, and memory corrects it). Every quote names the blob id responsible.
- **The borrower owns their history.** Each borrower's records live in *their own* MemWalAccount, written by a delegate key they added and can revoke. Records are Ed25519-signed by Ghostwriter and hash-chained, and the latest `(seq, head)` is anchored on-chain. A borrower can't forge a clean history (no key) or hide a bad record (the chain breaks or the anchor mismatches) — and any other underwriter they authorise can verify it the same way. That makes a no-claims bonus that travels.

**47 memories on Sui Mainnet** as of submission: 45 back-tested case aggregates plus live policy outcomes.

## Architecture

```
          ┌───────────────────────── Sui MAINNET ──────────────────────────┐
          │  Walrus Memory: underwriter account + one account per borrower │
          │  Suilend: obligations, liquidations                            │
          └────────▲──────────────────────▲────────────────────▲───────────┘
                   │ memwal SDK           │ Tatum gRPC         │ Tatum JSON-RPC
                   │ (hosted relayer)     │ (reads)            │ (inside the TEE)
 ┌──────────┐ HTTP │                      │           ┌────────┴─────────┐
 │ Frontend ├──────┤  BACKEND (Node, Fastify, SQLite) │ Nautilus enclave │
 │ (wallet) │◄─SSE─┤  pricing · memory queue · x402   │ AWS Nitro        │
 └────┬─────┘      └──────┬───────────────────▲───────┴────────▲─────────┘
      │ signs buy tx      │ Tatum gRPC        │ attestation    │
      ▼                   ▼ (reads + txs)     │                │
 ┌──────────────────── Sui TESTNET ───────────┴────────────────┴──┐
 │  ghostwriter::ghostwriter — Pool<GUSD>, Policy, Ledger,        │
 │  Enclave<GHOSTWRITER>        ·  Pyth PriceInfoObject (read)    │
 └────────────────────────────────────────────────────────────────┘
 AI agent ── x402 v2: HTTP 402 → signed buy tx in PAYMENT-SIGNATURE ──► backend executes
```

Memory is on **Mainnet** (that's the real asset). Money is on **Testnet** on purpose: economically this is an insurance product, so it runs as a demo with test dollars.

## How the sponsors' tech is used

**Walrus Memory** — two account kinds on Mainnet, five namespaces, a paced and retried write queue, vector recall that drives pricing, and `restore` for re-indexing. Walrus is canonical: wipe the local database and rules are rebuilt from memory on boot.

**Tatum** — every chain read and every server transaction on *both* networks goes through Tatum's Sui gRPC gateways (native gRPC, `x-api-key` metadata), rate-limited per key. Also: the Testnet checkpoint **stream** for a live heartbeat, the Data API for daily OHLCV candles, and Tatum JSON-RPC *inside* the enclave so the TEE reads the chain itself.

**Pyth** — the price trigger reads the on-chain `PriceInfoObject` with a confidence bound and a staleness bound, and a breach must persist across two transactions before it pays.

**Nautilus** — liquidation payouts require a signature from an enclave whose key is registered only via a Nitro attestation with matching PCRs.

## Running it

```bash
cd backend
pnpm install
pnpm keys         # writes admin token + signing keys into .env (never prints secrets)
pnpm smoke        # checks Tatum (both networks), Pyth, Walrus Memory, the LLM, the pool
pnpm warm:ohlcv   # one-time: fills the daily candle cache
pnpm dev          # http://localhost:8787
```

Demos:

| Command | What it proves |
|---|---|
| `pnpm agent` | An agent buys cover over HTTP 402, settled on Sui |
| `pnpm e2e:price` | Buy → breach reported → confirmed → paid, on Testnet |
| `pnpm seed --dry` | The back-test table behind the base rates |
| `pnpm mem:ping` | A real Mainnet memory write, read back |
| `sui move test` | 18 contract tests, including every rejection path |

Contract and object IDs: [`backend/move/DEPLOYMENTS.md`](backend/move/DEPLOYMENTS.md).
Build status and every deviation from the plan: [`docs/BACKEND_STATUS.md`](docs/BACKEND_STATUS.md).

## Configuration

`backend/.env.example` lists every variable. The ones you must supply: two Tatum API keys, a Testnet Sui private key for the server, a Walrus Memory account id and delegate key, and an LLM key, base URL and model. Everything else has a working default. No secret is ever logged — the logger redacts the exact value of every secret variable plus any 64-hex run, and a bad config prints variable *names* only.

## What is honest about this build

- **Test money.** gUSD, our own test dollar with a public faucet (DeepBook's DUSDC request form is closed). The contract is generic over the coin.
- **SUI only.** The Testnet BTC/USD price object has not been updated in weeks, so BTC is disabled rather than quoted off a stale price.
- **The liquidation path needs AWS.** All of it is written — enclave app, attestation client, watcher, claim route — but without an enclave registered, liquidation cover reports "enclave not configured". The Rust has not been compiled against the Nautilus template.
- **Liquidation discovery polls.** Our Tatum plan refuses the event RPCs, so the watcher reads each covered obligation's `previousTransaction` and lets the *enclave* judge whether a change was a liquidation. That judgement was never ours to make, so handing it candidates costs nothing in trust.
- **One x402 difference from the spec.** Its last facilitator check is "payTo receives the amount". Our premium goes into a shared `Pool` object, not to an address, so we verify the call is exactly one `ghostwriter::buy` for an issued quote by the quoted buyer, and the contract enforces `premium >= quoted premium`. The Sui exact scheme publishes `sui:mainnet` only; we use `sui:testnet` by the same pattern.
- **Back-test caveat.** Base rates come from 400 days of daily candles using intraday lows, which makes them true barrier touches — but a daily candle still can't see the path within a day.

## Repository

```
backend/
  move/ghostwriter/   Move package (Pool, Policy, Ledger, settlement)   18 tests
  move/gusd/          test dollar with a public faucet
  enclave/            Nautilus enclave app (copy into a Nautilus clone)
  src/chain/          Tatum gRPC clients, Pyth, objects, tx builders, Suilend
  src/memory/         Walrus Memory client, write queue, records, cases, rules
  src/pricing/        first-passage maths, volatility, buckets, quoting, explanations
  src/policies/       on-chain mirror, learning loop
  src/workers/        price trigger, checkpoint pulse, liquidation watcher
  src/x402/           agent payments
frontend/             Next.js app, 9 pages, built against the API contract
docs/                 build doc, backend status, frontend doc
```
