# Ghostwriter — Knowledge Transfer

Everything built, everything demoed, every live ID. Written so a fresh session (or a
teammate, or you in two weeks) can pick this up cold.

Last verified: 2026-11-10. Backend up 10h, 105 memories on Mainnet, 0 failed writes.

---

## 1. What it is, in one breath

**Parametric liquidation and price-drop cover for Sui borrowers, priced by an AI
underwriter whose memory lives on Walrus Memory.**

You borrow on Sui. You buy a policy: *"pay me 10 gUSD if SUI drops below $0.80 in the
next 7 days."* No claim form. When the on-chain Pyth price crosses your trigger and
stays there, the vault pays your wallet automatically.

The interesting part is not the escrow. It's the underwriter. It prices each policy by
recalling comparable historical cases from Walrus, it refuses business it shouldn't
write, and when it loses money it writes itself a new pricing rule — which then changes
what it will sell.

Built for **Total Recall — Tatum × Walrus Memory**.

### Sponsor surface
| Sponsor | Used for | Where |
|---|---|---|
| **Walrus Memory** | the underwriter's entire memory: cases, decisions, rules, policies, per-borrower history | `backend/src/memory/` |
| **Tatum** | all Sui chain reads/writes, both networks, via gRPC gateways | `backend/src/chain/clients.ts` |
| **Pyth** | on-chain `PriceInfoObject` — trigger evaluation happens in Move, not off-chain | `backend/move/ghostwriter/sources/ghostwriter.move` |
| **Nautilus / AWS Nitro** | liquidation attestation enclave (logic real, hardware not deployed — see §4) | `backend/enclave/mod.rs` |
| **x402** | agent-to-agent payment: an AI agent buys its own cover | `backend/src/x402/`, `backend/src/agent/` |
| **Vultr Inference** | the LLM behind pricing judgement, chat, and brief parsing | `VULTR_INFERENCE_*` in `.env` |

---

## 2. Two networks, on purpose

| | Network | Why |
|---|---|---|
| Policies, vault, payouts, gUSD | **Sui Testnet** | real money movement, free to demo |
| Walrus Memory | **Sui Mainnet** | that's where Walrus Memory actually runs |

This is not a shortcut — it is the honest shape. Memory is Mainnet because the hosted
relayer (`relayer.memory.walrus.xyz`) is Mainnet-only. Say this out loud in the demo;
judges notice it anyway.

---

## 3. Architecture

```
┌─ frontend (Next.js 16, React 19, dapp-kit) ──────────────────┐
│  /           landing (hero only, no chrome)                  │
│  /home       live dashboard                                  │
│  /onboard    borrower creates their OWN memory account       │
│  /cover      quote → buy  (+ chat about the quote)           │
│  /policies   list + detail, live breach countdown            │
│  /underwriter  the book: rules, multiplier chart, chat       │
│  /memory     borrower's hash-chained, Sui-anchored history   │
│  /agents     natural-language agent brief → agent buys       │
│  /proof      every ID, every key, every blob                 │
└──────────────────────────────────────────────────────────────┘
                              │ REST + SSE
┌─ backend (Node 24, Fastify, node:sqlite) ────────────────────┐
│  pricing/      quote.ts, explain.ts  — price + rationale     │
│  underwriting/ decide.ts  — THE AGENT: accept/counter/decline│
│                ask.ts     — chat grounded only in Walrus     │
│                learn.ts   — writes its own rules after P&L   │
│  agent/        autobuyer.ts — English brief → x402 purchase  │
│  memory/       Walrus read/write, namespaces, vector recall  │
│  chain/        Tatum gRPC, both networks                     │
│  x402/         v2 Sui "exact" scheme                         │
│  workers/      priceWatcher, liquidationWatcher,             │
│                checkpointPulse, memoryQueue                  │
│  enclave/      client for the attestation service            │
└──────────────────────────────────────────────────────────────┘
        │                        │                     │
   Tatum gRPC              Walrus relayer        enclave :3010
   (testnet+mainnet)        (mainnet)            (Rust, Nautilus)
```

### Move packages (`backend/move/`)
- **`ghostwriter`** — `Pool<C>`, `Policy<C>`, `Ledger`, `AdminCap`. BCS-signed
  `QuoteMessage` so the backend can price off-chain but the chain verifies. Abort codes
  1–24; the ones you'll actually see: `3 EBadQuoteSig`, `9 EOutsideWindow`,
  `16 EBadAttestation`, `18 EStaleEnclave`.
- **`enclave`** — Nautilus pattern. `IntentMessage{intent, timestamp_ms, payload}`,
  PCR registration, `0x2::nitro_attestation::load_nitro_attestation`.
- **`gusd`** — our own test stablecoin with a public faucet (`mint_to_sender`, cap
  1000/call). Lets anyone try the demo without begging for testnet tokens.

### The memory namespaces (Mainnet, 105 records)
| Namespace | Count | What |
|---|---|---|
| `ghostwriter-cases` | 46 | backtested historical outcomes — "how often did SUI fall 5–10% in 4–7 days?" |
| `ghostwriter-decisions` | 48 | every accept / counter / decline with its reasoning |
| `ghostwriter-policies` | 9 | each policy written, and how it ended |
| `ghostwriter-rules` | 1 | pricing rules the system wrote **itself** |
| `ghostwriter-quotes` | 1 | quote audit |

---

## 4. What is real, and what isn't

Be straight about this. It's stronger than hedging.

| Claim | Status |
|---|---|
| Real on-chain policy purchase, Testnet | **real**, verifiable |
| Real automatic payout, no claim filed | **real** — digest below |
| Pyth price read on-chain inside Move | **real** |
| All chain I/O through Tatum gRPC | **real** |
| 105 memories on Walrus **Mainnet** | **real** |
| Borrower owns their memory account, revocable delegate | **real** |
| Underwriter refuses business and counter-offers | **real** |
| Underwriter wrote its own pricing rule after a loss | **real**, and it changed behaviour |
| Chat answers only from Walrus, says "I have no memory of that" | **real** |
| Agent buys its own cover over x402 from an English sentence | **real**, own wallet |
| Enclave reads Mainnet and refuses false liquidation claims | **real** |
| Enclave runs inside **Nitro hardware** | **NO** — runs as the same binary outside a TEE |
| On-chain settlement of a liquidation claim | **disabled**, because of the line above |

`ENCLAVE_OBJECT_ID` is deliberately empty in `.env`. That's the one honest gap. The
attestation *logic* is real and tested against live Mainnet Suilend liquidations; the
*hardware* attestation needs a Nitro-capable EC2 instance, which the AWS Free Plan
refuses (proved: the instance-type intersection is empty).

---

## 5. The five agentic behaviours — these ARE the demo

Not "an LLM writes a sentence about the price." Five things that change outcomes.

### (a) Memory corrects the price in both directions
Same cover, two triggers, two different recalled memories, opposite corrections.

- Trigger **$0.80**, payout 10, 7 days → premium **6.85 gUSD**, cases multiplier **×0.90**.
  Recalled: 5–10% below spot, 4–7 days → price touched 81 of 180 times. Memory made it
  **cheaper** than the model wanted.
- Trigger **$0.70**, payout 10, 7 days → premium **1.69 gUSD**, cases multiplier **×2.07**.
  Recalled: 15–25% below spot → touched only 11.5% of the time. Memory made it
  **dearer**.

Each quote cites the Walrus blob ID it used. Clickable. That's the whole point.

### (b) It refuses on size, and counter-offers
Ask for **900 gUSD** of cover → declined. Single policy cap is 25% of free capital
(`MAX_SINGLE_SHARE = 0.25`) → counter at **495.36 gUSD**, one click to accept.

The capital limits live in `decide.ts`'s `guard()` as a hard mandate the LLM cannot
cross, and in Move. The model has judgement *inside* a mandate. It can never oversell
the pool.

```
MAX_SINGLE_SHARE    = 0.25   // one policy vs free capital
MAX_BUCKET_SHARE    = 0.40   // one risk bucket vs free capital
STRESSED_LOSS_RATIO = 1.5    // refuse if stressed book breaches this
```

### (c) It refuses on risk — because of a rule it wrote itself
Trigger **$0.83** (≈2% below spot) → *"cover is too likely to pay out at this trigger."*
Refused at any price.

Why: it paid out once in exactly that bucket and lost money. So it wrote:

```json
{
  "ruleId": "SUI:mid:0-5",
  "multiplier": 1.25,
  "status": "trial",
  "lesson": "SUI, mid vol, 0-5% below spot: The premium of 9.73M was insufficient
             to cover the 10M payout, resulting in a net loss of 2.7M.",
  "payouts": 1,
  "blobId": "2OqnhNTJ09bHlATw134i0Vb_Uds1Hn2JlA6zXZng9vM"
}
```

Nobody told it to. It closed the loop: paid → measured its own P&L → raised its own
price → that cover is now off the table. **This is the single best beat in the demo.**

Side effect worth knowing: a near-the-money policy is no longer purchasable, so you
**cannot film a fresh guaranteed payout any more.** Use the already-paid one.

### (d) Chat grounded only in Walrus
`ask.ts` recalls across `cases`, `rules`, `decisions`, `policies` + the borrower's
`history`. System prompt forbids outside knowledge and forces blob-ID citations; it
answers in the first person.

Ask it *"what's the capital of France?"* → **"I have no memory of that."**
A chatbot says Paris. This one structurally can't.

### (e) An agent is a customer
`/agents`. Type a sentence — *"Cover my SUI if it drops 15% over 3 days, don't pay more
than 4 gUSD."*

`parseBrief()` sends it to the LLM, which returns **only mandate numbers** (never the
transaction). `runMandate()` is plain code that does the x402 signing. 7 narrated steps:
parse → quote (HTTP **402 Payment Required**) → read the memories behind the price →
check premium vs budget → sign → pay → covered.

It pays from **its own wallet** (`AGENT_PRIVATE_KEY`, address `0x2da30149…a9b9`) —
deliberately a third party, not the user and not the underwriter. In x402 the payment
payload *is* the signed purchase transaction, so paying and being covered cannot come
apart.

---

## 6. The real payout — the proof that it isn't a mock

| | |
|---|---|
| Policy | `0x151cecc344ee80cdee61d050043ff7f481f718c630832c87660fa201ae02b779` |
| Premium paid | 9.730769 gUSD |
| Payout | 10 gUSD |
| Bought | 19:21 |
| Price crossed trigger | 19:29 |
| **Paid** | **19:31** |
| Settlement digest | `9MXG2zpaV1ZjdNH8jC4j5deWF8QEHRDG1KfPukrfvm9t` |

No claim was filed. There is no claim form in the app. The price watcher reported the
breach, the Move contract **re-read the Pyth price itself** after the 120s confirm
delay, and the vault released the money.

Net result: −2.7 gUSD. Which is what taught it rule `SUI:mid:0-5`.

**Use SuiVision for explorer links, not Suiscan** — Suiscan's testnet indexer lags and
shows "Unknown" for minutes, which looks broken on camera.

The enclave refusal scene uses a **real Mainnet Suilend liquidation**, digest
`HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV`, claimed against an obligation it did
*not* liquidate → enclave refuses to sign. Our own backend asked; it said no.

---

## 7. Live IDs — everything in one place

### Sui Testnet (policies)
```
GHOSTWRITER_PACKAGE_ID  0xff272f596619f255a591323d32d7d0a3835fbdaf84718bdb61f7dec263e23060
POOL_ID                 0x76e3792eeb08a19ad7cb1a72e53472c1f3194726be0aeb8b0ed5ede587051d74
ADMIN_CAP_ID            0x0efa4379f064661d32d5ae86872e423be6a4b9245b2a15b07b6ef6542f6abc0e
ENCLAVE_PACKAGE_ID      0xc9c14c07c24fc80c1425dcb8f52385d0bb0ff9f671f9dc856a1719c746521802
ENCLAVE_CONFIG_OBJECT   0xea95563f84284e7bfef75a0885ea361c1ccaf8d70005e7e151ed0442333e57f8
ENCLAVE_CAP_ID          0x125895a0aca256e38cdfe7753136510977bcf238580a96582fe948213b5a0bc6
ENCLAVE_OBJECT_ID       (empty — no Nitro hardware)
GUSD_PACKAGE_ID         0x6dc2c1e1afe9ceece7e2bf64c52055110e5777404d6d23c6d5e51622ec14f2f1
GUSD_FAUCET_ID          0x728cea2bd6f17243b575bea09e017407919113aff264389f707bd7b3529501d5
COIN_TYPE               0x6dc2…::gusd::GUSD   (6 decimals)
SUI/USD Pyth feed       0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744
server address          0xdd6389cc38a64526d84e6189ef8904cf8e83f4721b08f65fe96b8579b46e6f2b
```

### Sui Mainnet (Walrus Memory)
```
MEMWAL_PACKAGE_ID       0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5
MEMWAL_REGISTRY_ID      0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f
UNDERWRITER_ACCOUNT_ID  0x8b7608b6c7911acb97353a6010280bfb687ce4396127e7d9b5c18c72c39f89ab
relayer                 https://relayer.memory.walrus.xyz
agent (delegate) pubkey 4cafd304de73c09608d6318561c8c2701d321c2365d20535278b63f6e48a2176
borrower delegate pubkey 395ce8b631441c4cede6c20b5af84eb62e3a4bef0c8cd66f5b5ac2fdb504b514
history namespace       ghostwriter-history
```

### Signing keys (public halves)
```
quote signing pubkey    62a55ba3994c5d6df8e6aceda8e313c587e6e20627cbfffde50231bba73f6a16
record signing pubkey   3b92d499f8392ceeb2e60bf639cb16551f5777b4974c7131ce6b419182a434f5
```
`quotePubkeyMatches: true` in `/v1/config` means the key the backend signs with is the
key the pool on chain checks against. If that ever goes false, every buy aborts with 3.

### Pool state as of writing
```
vault   2,016.690364 gUSD
free    1,966.690364 gUSD
locked     50.000000 gUSD
premiums collected 31.690364
payouts made       15.000000
loss ratio 0.473
policies: 7 active, 1 paid, 8 total
```

---

## 8. The demo, step by step — 15 scenes

This is what was filmed. Values are the ones that actually work.

| # | Page | Do | Expect |
|---|---|---|---|
| 1 | `/` | land | hero, live SUI price, memory count |
| 2 | `/home` | show | both networks, pool, Pyth price |
| 3 | `/onboard` | show completed state | borrower owns the account; delegate is revocable |
| 4 | `/cover` | Trigger **0.80**, Payout **10**, Days **7** → Quote | premium **6.85**, cases **×0.90**, blob cited |
| 5 | `/cover` | Trigger **0.70**, same | premium **1.69**, cases **×2.07**, *different* blob |
| 6 | `/cover` | ask the quote chat "why?" then "what would make it cheaper?" | first person, hit rates, blob IDs, reaches for a different memory |
| 7 | `/cover` | Payout **900** | declined on size → counter **495.36** → accept it |
| 8 | `/cover` | Trigger **0.83** | *"too likely to pay out"* — refused at any price |
| 9 | `/underwriter` | the book | rule `SUI:mid:0-5 ×1.25 trial` + its lesson; multiplier chart, hover a bar |
| 10 | `/policies/0x151cecc3…` | the paid policy | 19:21 → 19:29 → 19:31, settlement digest on SuiVision |
| 11 | liquidation claim | digest `HUKqRVpJ…`, wrong obligation | enclave refuses. **Say the honesty line here.** |
| 12 | `/memory` | borrower history | hash-chained, each record points at the last, anchored on Sui |
| 13 | `/underwriter` chat | "why did you refuse 900?" / "what have you learned about SUI falling 5% in a week?" / "what's the capital of France?" | explains itself; real hit rates; **"I have no memory of that"** |
| 14 | `/agents` | type: *Cover my SUI if it drops 15% over 3 days, don't pay more than 4 gUSD* | 7 steps, HTTP 402, real purchase from the agent's own wallet |
| 15 | `/proof` | show | 105 memories by namespace, blob IDs, keys, package + pool |

**No step requires waiting.** Nothing in this script depends on the price moving.

### The one trap
Step 7's **900** goes in the **Payout** field, not Trigger. Typing 900 into Trigger
gives a nonsense quote, not the refusal.

---

## 9. Speaking script

Full voiceover is in this chat's history and matches the 15 steps above. Delivery notes
that matter:

- Slow down on **steps 7–9**. The refusal pair plus the self-written rule is the
  strongest claim in the whole project and it needs a beat.
- Say the enclave caveat in step 11 plainly and move on. Hedging makes it sound worse
  than it is.
- Let *"I have no memory of that"* sit for a second before explaining it.
- ~9 minutes at normal pace. To shorten, cut steps 2 and 12 — least load-bearing.

---

## 10. Running it from zero

```bash
# ONE backend only. Five running at once locks the DB and burns Tatum credits.
lsof -nP -iTCP:8787 -sTCP:LISTEN     # must be empty

cd backend  && pnpm dev              # :8787
cd frontend && npm run dev           # :3000 (or :3001 — see CORS below)

# enclave (separate repo)
cd ~/Desktop/Hacks/nautilus/src/nautilus-server
PORT=3010 API_KEY=unused-graphql-needs-none ./target/debug/nautilus-server
```

Health check: `curl -s localhost:8787/v1/health` — all four workers should be
`running`/`polling`, `hedger` is `disabled` by design.

Top up gUSD: `pnpm fund-gusd`. Faucet caps at 1000/call.

---

## 11. Gotchas that cost real time

- **Tatum has no Sui JSON-RPC.** Only gRPC. The enclave originally used JSON-RPC and
  got 404s; it now reads **Sui GraphQL** (`graphql.mainnet.sui.io/graphql`). Note the
  query root is `transaction`, not `transactionBlock`.
- **Tatum 402 = credits exhausted**, and gRPC surfaces it as a bare `UNKNOWN` with no
  detail, so the whole app looks broken rather than unpaid. There's a ready fallback
  script at `scratchpad/add_fallback.py` (switches to public fullnodes, heals itself
  after 5 min) — **not applied**, judged too risky pre-demo.
- **CORS**: `CORS_ORIGINS` must list whatever port Next actually bound. It falls back to
  :3001 when :3000 is taken, and then the app shows "backend not reachable" while curl
  works fine.
- **`/v1/config` returns `pool: null`** on any transient chain read failure. All eight
  frontend read sites are now guarded (`cfg?.pool?.…`) — one 429 used to blank the
  entire app with *"Cannot read properties of null"*.
- **zkLogin wallets can't sign here.** Slush Google accounts expose only the deprecated
  `signAndExecuteTransactionBlock`. Use a seed-phrase account. The
  `WalletCapabilities` panel measures this rather than guessing.
- **Abort-code mapping** in `frontend/src/lib/errors.ts` must match `MoveAbort(…, N)`
  specifically. The old loose regex matched any "abort" near any digit and mislabelled
  failures.
- **`Move.lock` had Windows backslashes**, which blocks `sui move test` on macOS.
  Normalised to forward slashes.
- **Suiscan testnet indexer lags.** Use SuiVision everywhere.

---

## 12. Open items

### Security — do these
- [ ] **Delete the AWS root access keys** in IAM (`AKIAZ36PVUB2NNXULDLN`, account
      `678503489652`). Root keys cannot be scoped and they are in a chat transcript.
- [ ] **Rotate `MEMWAL_BORROWER_DELEGATE_KEY`** — *after* the demo. Rotating now
      invalidates the anchored hash chain you're showing on `/memory`.
- [ ] The borrower key `06aa411a…` and `AGENT_PRIVATE_KEY` are throwaway demo keys.
      Never fund them for real, never reuse after the hackathon.

### Product
- [ ] Remove the 56 orphaned scraped-template files — script ready at
      `scratchpad/remove_template.py`, never run.
- [ ] Deploy the `register_enclave_by_cap` package upgrade (needed for on-chain
      liquidation settlement). Your call.
- [ ] AWS plan upgrade if you want the real Nitro TEE. Free Plan blocks every
      Nitro-capable instance type.

### Submission
- [ ] Submission form, repo public, blog post, X / LinkedIn.

---

## 13. Repo map

```
backend/
  move/ghostwriter/     Pool, Policy, Ledger, AdminCap  (+ tests)
  move/enclave/         Nautilus attestation registration
  move/gusd/            test stablecoin + public faucet
  enclave/mod.rs        attestation logic, Sui GraphQL, 3 unit + 3 live tests
  src/underwriting/     decide.ts (the agent) · ask.ts (chat) · learn.ts (rules)
  src/agent/            autobuyer.ts — English brief → x402 purchase
  src/pricing/          quote.ts · explain.ts
  src/memory/           Walrus read/write, namespaces, vector recall
  src/chain/clients.ts  Tatum gRPC, both networks
  src/x402/             v2 Sui "exact" scheme
  src/workers/          priceWatcher · liquidationWatcher · checkpointPulse · memoryQueue
  scripts/              enclave-register · upgrade-enclave-package · fund-gusd · …

frontend/src/
  app/                  /  /home  /onboard  /cover  /policies  /underwriter
                        /memory  /agents  /proof
  components/common/    AskUnderwriter · AgentBrief · WalletCapabilities
  components/shell/     AppShell (BARE_ROUTES, sticky payout toast) · Toasts · Sidebar
  lib/                  api · types · errors (abort mapping) · format · events (SSE)

docs/
  HANDOFF.md            this file
  DEMO.md               demo script
  WIRING.md             page-by-page frontend↔backend wiring + per-page tests
  P7_ENCLAVE_RUNBOOK.md Nitro enclave runbook
  BACKEND_STATUS.md     backend build status
```

---

## 14. The pitch, if you only get 30 seconds

> Most on-chain insurance is an escrow with a price feed. Ghostwriter is an underwriter.
> It prices from 105 memories on Walrus and shows you the blob behind every number. It
> refuses business — on size, and on risk. And when it lost 2.7 gUSD on a policy it had
> mispriced, it wrote itself a new pricing rule, which is why it now refuses to sell me
> that same cover. Nobody told it to do that. It paid out in two minutes, on chain, with
> no claim form — and an AI agent bought its own policy over x402 with its own wallet.
