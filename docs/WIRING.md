# Frontend × backend wiring

Tracking doc for connecting the Next.js app to the Ghostwriter backend, one page at a time.
Each step records what changed, why, and **what to click in the UI** to confirm it.

**Backend:** `http://localhost:8787` (`cd backend && pnpm dev`)
**Frontend:** `http://localhost:3001` (`cd frontend && npm run dev`) — set by `NEXT_PUBLIC_API_URL` in `frontend/.env.local`

> If an older `next dev` is still holding port 3000, stop it and use one instance only.

---

## Starting point

The frontend was **not** hardcoded. It already had a complete API layer — `src/lib/api.ts` (every
endpoint), `src/hooks/queries.ts` (react-query), `src/lib/events.tsx` (SSE → cache), `src/lib/buy.ts`
(wallet buy), `src/lib/memwal.ts` — and 8 of 9 pages called it. The types in `src/lib/types.ts` were
written from the **spec document**, not from the running backend, so the job is to reconcile them
with reality and fix what the drift broke.

Two problems were found before any wiring: `node_modules` was incomplete (the app could not compile),
and the types disagreed with the live responses in ways that silently changed behaviour.

## Page inventory — 9 pages

| # | Route | Purpose | Wired |
|---|---|---|---|
| 0 | `/` | **Landing** — full-bleed hero, outside the app shell | ✅ |
| 1 | `/home` | App home: live market, vault, memory count | ⬜ |
| 2 | `/cover` | Quote → buy cover | ⬜ |
| 3 | `/policies` | Policy list | ⬜ |
| 4 | `/policies/[id]` | Policy detail, live settlement, claim | ⬜ |
| 5 | `/memory` | Borrower history from Walrus Memory | ⬜ |
| 6 | `/underwriter` | The book: vault, rules, loss ratio | ⬜ |
| 7 | `/proof` | Receipts: memories, blobs, keys, ids | ⬜ |
| 8 | `/agents` | x402 agent purchase | ⬜ |
| 9 | `/onboard` | Borrower MemWal account + delegate key | ⬜ |

## Verified backend contract

Captured from the running backend, not from the spec. Fields the frontend did not know are marked.

| Endpoint | Notes |
|---|---|
| `/v1/health` | `liquidationWatcher` reports **`polling`** — normal, since Tatum's plan blocks event RPCs |
| `/v1/config` | **`enabledAssets: ["SUI"]`**, **`coinFaucetId`**, `feeds` holds **only enabled assets**, **`pool.quotePubkeyMatches/vault/free`**, **`limits.minPremium`**, **`enclave.url`** |
| `/v1/market` | **`priceObjectId`**, **`ageS`**, **`maxPriceAgeS`** (180 s — settlement aborts past it) |
| `/v1/quotes` | `explanationSource` is **`'llm'`** (not `'openai'`), **`obligationVerified: boolean \| null`** |
| `/v1/policies` | **`nearMiss`** |
| `/v1/underwriter/book` | **`paused`**, **`policies`** |
| `/v1/memory/writes` | **`failed`** |
| `/v1/proof` | **`memoryNetwork`**, **`perNamespace`**, **`writes`**, **`recordPubkeyHex`**, **`quotePubkeyHex`** |

Live values at time of writing: SUI $0.818, vol 72.8%, vault 1997.54 gUSD, 47 Mainnet memories
(45 cases, 1 quote, 1 policy), 1 active policy, `enclave.objectId` empty.

---

## Step 0 — shared foundation ✅

Everything below is used by every page, so it came first.

**Fixed `node_modules`.** `npm install` had never completed: `@tanstack/react-query`,
`lucide-react`, `@mysten/dapp-kit-react/ui` and `@mysten/sui/utils` were all missing. The app could
not typecheck or build.

**Reconciled `src/lib/types.ts` with the live backend** — every field in the table above.

**Fixed a real, visible bug.** `cover/page.tsx` rendered
`q.explanationSource === 'openai' ? 'Written by AI' : 'Standard explanation'`. The backend sends
`'llm'`, so the badge said *"Standard explanation"* for every LLM-written explanation — the
memory-reasoning feature was being credited to a fallback. Correcting the type turned this into a
compile error, which is how it was found.

**Asset selectors now come from `config.enabledAssets`** in `/cover` and `/agents`, instead of a
hardcoded `SUI` + `BTC` pair. BTC is disabled backend-side because its Testnet price object is weeks
stale; picking it produced a quote request for a feed the backend does not serve.

**`DUSDC` → `gUSD`, 22 occurrences across 12 files.** The pool's coin is our own test dollar, since
DeepBook's DUSDC request form is closed. Includes the `Amount` component's default symbol.

**Replaced the dead faucet link.** `/cover` linked to a closed Tally form
(`https://tally.so/r/Xx102L`). It now links to the real gUSD faucet object from
`config.coinFaucetId` via `config.explorers.testnetObject`.

**Fixed the SSE market update.** `price.tick` rebuilt the `Market` object from scratch, dropping
`maxPriceAgeS` and leaving `ageS` frozen at its last fetched value. It now spreads the previous
state and recomputes `ageS` from the new `publishMs`, so the staleness indicator stays truthful
between the slower `/v1/market` refetches.

**Fixed CORS, which blocked the whole app in the browser.** `CORS_ORIGINS` defaults to
`http://localhost:3000` only and was not set in `backend/.env`. Next.js had fallen back to port
3001 because an older dev server held 3000, so every request from the browser was blocked and the
UI showed *"Ghostwriter backend is not reachable at http://localhost:8787"* — while `curl` worked
fine, because curl does not enforce CORS. Set to `http://localhost:3000,http://localhost:3001`.

> **When you deploy:** add the Vercel origin to `CORS_ORIGINS` on Render, or the hosted frontend
> hits exactly this wall. It is an allowlist, not a wildcard — unknown origins get no
> `access-control-allow-origin` header, which is the behaviour you want.

**Checks:** `npx tsc --noEmit` clean · all 9 routes return HTTP 200 with no runtime errors ·
CORS verified: origins 3000 and 3001 are echoed back, an unknown origin is refused.

### What to test in the UI

1. Open `http://localhost:3001` — the page loads, no red error overlay.
2. **Hard-refresh and search the page for "DUSDC"** (⌘F). It should appear **nowhere**, on any page.
   Balances, payout labels and toasts should all read **gUSD**.
3. Go to `/cover`. Open the **Asset** dropdown — it should list **SUI only**, no BTC.
4. On `/cover`, fill in trigger `0.75`, payout `10`, duration `7`, and get a quote. Under the
   explanation, the badge should read **"Written by AI"**, not "Standard explanation".
5. Still on `/cover`, with a wallet holding little gUSD, the low-balance note's **"Get test gUSD"**
   link should open a Suiscan object page, not a Tally form.
6. Go to `/agents` — its **Asset** dropdown should also list SUI only.

Report anything that differs and it gets fixed before the next page.

---

## Step 1 — the landing ✅

`/` was the app dashboard inside the sidebar; the original marketing landing had been replaced in
commit `98e8857` because it was a scrape of an unrelated product ("We're just sending forms / and
that's all"). Restoring that would have put someone else's marketing in front of the judges, so the
hero was rebuilt with our own copy instead.

- `/` is now a full-bleed landing: dot-grid hero, Ghostwriter headline, **Get cover** and
  **See it live**, three value points, and live figures (SUI spot, Mainnet memory count) so the
  first thing a visitor sees is real rather than claimed.
- `AppShell` is path-aware via `BARE_ROUTES`, so `/` renders with no sidebar or top bar while every
  other route keeps the chrome.
- The app home moved to **`/home`**; the sidebar's Home entry and the brand link follow.
- Connecting a wallet on the landing pushes to `/home`. It is **not** a hard gate — every page stays
  reachable by URL, so a misbehaving wallet never leaves the demo with nothing to show.
- Styles live at the end of `src/styles/app.css`, using the existing cream/royal tokens
  (`--cl-canvas`, `--cl-ink`), so the landing matches the app.

The template's four fonts are commercial and absent (`MISSING-ASSETS.md`), so type falls back to
system sans — already true across the app, just most visible on a big hero.

### What to test

1. `http://localhost:3001/` — hero fills the page, **no sidebar**, dot grid behind the text.
2. "SUI now" shows a real price and "Memories on Mainnet" shows 47 — not dashes.
3. **Get cover** → `/cover`; **See it live** → `/home`, and `/home` has the sidebar back.
4. Connect the wallet from the landing — it should move you to `/home` on its own.
5. In the app, the sidebar **Home** entry goes to `/home` and highlights there.

---

## Demo wallet

`0xc28d6e304da4484e7f14a67d1b0a1d34604a6bbc6c9925b111a5afbe7c3a27de` — one wallet does the whole
demo. The backend holds the admin/server key and settles by itself, so no second wallet is needed.

| Network | Funded | Why |
|---|---|---|
| Testnet | 1.0 SUI + 1000 gUSD | gas and premiums |
| Mainnet | nothing needed | onboarding is done; memory writes are paid by the Walrus relayer |

`pnpm fund:gusd 0x<address> [amount]` tops up any wallet (cap 1000 per call).

---

## Liquidation in the demo — what is real

The liquidation tab is **not** disabled by us. It unlocks as soon as a registered borrower wallet is
connected (`0xc28d6e30…` is registered: `verified: true`, ledger anchored, 1 record). Greyed out
simply means no wallet, or a wallet with no memory account.

The backend now points at the enclave app running on your laptop
(`ENCLAVE_URL=http://localhost:3010`), so `/v1/enclave/health` reports `configured: true` and
`graphql.mainnet.sui.io: true`. Three of the four liquidation steps are genuinely live:

| Step | Real? |
|---|---|
| Quote liquidation cover over a Suilend obligation | ✅ live |
| Buy it — premium paid, policy created on Testnet | ✅ live, real transaction |
| Claim with a digest that does **not** liquidate that obligation → enclave refuses | ✅ live, real refusal |
| Claim with the real Mainnet liquidation → enclave signs, then on-chain settlement | ⚠️ signs for real; **settlement unavailable** — no registered `Enclave` object |

**Say this out loud:** *"this is the same enclave binary, reading Mainnet and signing for real — it
just isn't inside Nitro hardware, so the contract has no attested key to verify against."* Nothing
here is mocked; one link is missing and it is the hardware one.

Restarting the enclave regenerates its key. That breaks nothing, because we never registered it.

---

## End-to-end demo flow

Three processes, then follow the steps in order.

```bash
cd backend && pnpm dev                                   # :8787
cd frontend && npm run dev                               # :3001
cd ~/Desktop/Hacks/nautilus/src/nautilus-server \
  && PORT=3010 API_KEY=unused ./target/debug/nautilus-server   # :3010
```

Wallet: `0xc28d6e30…` on **Sui Testnet** — 1 SUI, 1000 gUSD.

### 1 · `/` — the landing

Hero fills the screen, no sidebar, dots **behind** the text. Scroll: live SUI price and 47 Mainnet
memories. Connect the wallet → it moves you to `/home`.

> *"Cover for Sui borrowers, priced by an underwriter that remembers — and the memory is on Walrus."*

### 2 · `/home` — it is live, not a mock-up

Sidebar is back. Check: SUI spot with a freshness age, vault balance, memory count, workers running.

> *"Every number here is read live: Pyth on-chain for price, the pool object for the vault, Walrus for the memory count."*

### 3 · `/onboard` — the borrower owns their reputation

Your wallet is already onboarded, so it shows the connected state: your MemWal account id, our
delegate key authorised, records and anchored sequence.

> *"The account is mine, on Mainnet. Ghostwriter only holds a delegate key — I can revoke it and keep my history."*

**Do not** onboard a fresh wallet live; that needs Mainnet SUI and can fail on camera.

### 4 · `/cover` — the differentiator

The page the pitch rests on. Do it twice:

- trigger **0.75**, payout **10**, **7** days → quote. Read the citation: a backtest case on Walrus
  moved the multiplier. Badge says **Written by AI**.
- change trigger to **0.70** → requote. The multiplier moves the *other* way (≈ ×1.63).

> *"It is not a formula with a fudge factor. It recalls comparable cases from Walrus and cites the blob that changed the price — and it corrects in both directions."*

Then buy: wallet signs once, premium leaves, policy appears.

### 5 · `/policies` and `/policies/[id]` — it settles itself

Open the policy. Live status, countdown, the buy digest on Suiscan. If a breach is running, the SSE
timeline moves on its own: `breach.reported` → (2 min) → `policy.paid`.

> *"No claim form. A watcher reports the breach, the contract re-checks the Pyth price itself after the delay, and the vault pays."*

### 6 · Liquidation — the TEE, honestly

With liquidation cover bought over obligation
`0xcc698926b57d5b971bf1f05133909151f08f182d90b77ef280bbb1acb69422e4`, claim with a digest that does
not match. The enclave refuses:

```
502  no LiquidateEvent for this obligation in that transaction
```

> *"The backend just asked the enclave to attest something false, and it refused — because it reads Mainnet itself rather than taking our word."*

Then the real one, `HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV`, and say plainly that settlement
needs the Nitro-attested key.

### 7 · `/memory` — the history is the borrower's

Hash-chained records, each signed, each linking to its Walrus blob, anchored on Testnet.

> *"Chained and signed, so neither of us can edit it quietly. Good behaviour lowers my price — and it is portable."*

### 8 · `/underwriter` — it learns

Vault, premiums, payouts, loss ratio, and the multiplier history showing memory changing the price
over time.

### 9 · `/agents` — machines are customers

Ask for cover as an agent: the backend answers **402** with payment terms, the agent pays with a
signed transaction, and gets a policy. No human.

### 10 · `/proof` — receipts

47 Mainnet memories by namespace, recent blob ids, the record and quote public keys, package and
pool ids.

---

## Demo script

Run both servers, connect a wallet on Sui Testnet, and follow this order. It builds the argument
rather than touring the app.

| # | Page | The point | Say |
|---|---|---|---|
| 1 | `/` | It is real and live | Live SUI price from on-chain Pyth, workers running, checkpoints streaming |
| 2 | `/onboard` | **The borrower owns their reputation** | Their own Walrus Memory account on Mainnet; we hold a delegate key they can revoke |
| 3 | `/cover` | **The differentiator** | Quote cites the Walrus blob that moved the price. Try `0.75` → ×0.96 and `0.70` → ×1.63: memory pushes it *both* ways |
| 4 | `/policies/[id]` | It settles itself | Buy, then watch SSE: breach reported → confirmed → paid, each with a Testnet digest |
| 5 | `/memory` | The history is the borrower's | Hash-chained records, signed, anchored on Testnet, each linking to its blob |
| 6 | `/underwriter` | It learns | Vault, loss ratio, and the multiplier history showing memory changing the price over time |
| 7 | `/agents` | Machines are customers | 402 with payment terms, then the agent pays and gets a policy — no human |
| 8 | `/proof` | Receipts | 47 Mainnet memories by namespace, blob ids, keys, package and pool ids |

**Be straight about the enclave.** `/policies/[id]` will show the liquidation claim as unavailable,
because `enclave.objectId` is empty. Say: *"the attestation logic is proven live against Mainnet and
settlement is proven by the contract's tests; the Nitro hardware attestation needs a paid AWS
instance, so it is not deployed."* See [P7_ENCLAVE_RUNBOOK.md](P7_ENCLAVE_RUNBOOK.md).
