# Ghostwriter

Price-drop cover for Sui borrowers, priced by an AI underwriter whose memory lives on
Walrus Memory.

Built for **Total Recall — Tatum × Walrus Memory**.

---

**Contents** · [What it does](#what-it-does) · [The underwriter](#the-underwriter) ·
[How a price is computed](#how-a-price-is-computed) · [Why an off-chain price is safe](#why-an-off-chain-price-is-safe) ·
[How a payout happens](#how-a-payout-happens) · [An agent is a customer](#an-agent-is-a-customer) ·
[Walrus Memory](#how-walrus-memory-is-used) · [The borrower's record chain](#the-borrowers-record-chain) ·
[Tatum](#how-tatum-is-used) · [Proof it ran](#proof-it-actually-ran) · [What isn't shipped](#what-isnt-shipped) ·
[Limitations](#limitations) · [Decisions](#decisions-we-had-to-make) · [Architecture](#architecture) ·
[Running it](#running-it) · [Addresses](#deployed-addresses) · [Tests](#tests) · [API](#api)

---

## What it does

You're borrowing on Sui and you don't want to get wiped out by a drawdown. You ask for
cover: *pay me 10 gUSD if SUI drops below $0.80 in the next 7 days.* You get a price,
you pay it, you're covered.

There is no claim form. There isn't one anywhere in the app. When the on-chain Pyth
price crosses your trigger, a watcher reports it; after a 120-second confirm delay the
Move contract **re-reads the Pyth price itself** and either pays you or resets the
timer. The money comes from a pool on Sui Testnet and lands in your wallet.

That part is a parametric escrow, and on its own it isn't very interesting. The
interesting part is who sets the price.

## The underwriter

Every quote starts from a volatility model, and then gets corrected by what the
underwriter remembers. It recalls comparable historical cases from Walrus and tells you
which blob changed the number.

**It corrects in both directions.** Same cover, two different triggers:

| Trigger | Premium | Memory multiplier | What it recalled |
|---|---|---|---|
| $0.80 | 6.85 gUSD | **×0.90** | 5–10% below spot over 4–7 days: price touched 81 times out of 180 |
| $0.70 | 1.69 gUSD | **×2.07** | 15–25% below spot: touched only 11.5% of the time |

The model over-prices shallow barriers and under-prices deep ones. Memory knows that and
fixes it, cheaper in one direction and dearer in the other. Both quotes cite the blob
they used, and you can open them.

**It refuses business on size.** Ask for 900 gUSD of cover and it declines — a single
policy is capped at 25% of free capital — then counter-offers 495.36 gUSD, which you can
accept with one click. The capital limits live in `guard()` in
[`decide.ts`](backend/src/underwriting/decide.ts) and in the Move contract, not in a
prompt. The model exercises judgement *inside* a mandate it cannot cross.

```
MAX_SINGLE_SHARE    = 0.25   // one policy against free capital
MAX_BUCKET_SHARE    = 0.40   // one risk bucket against free capital
STRESSED_LOSS_RATIO = 1.5    // refuse if the stressed book breaches this
```

**It refuses business on risk, because of a rule it wrote itself.** Ask for a trigger at
$0.83, roughly 2% below spot, and it won't write it at any price: *"cover is too likely
to pay out at this trigger."*

It knows that because it got it wrong once. It sold a policy for 9.73 gUSD, paid out 10,
and lost 2.7. Then it measured its own P&L and wrote this to Walrus:

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

Nothing in the codebase told it to write that rule, and the rule is now the reason it
turns that business away. The loop closed by itself.

**It only answers from memory.** `/underwriter` has a chat box.
[`ask.ts`](backend/src/underwriting/ask.ts) recalls across cases, rules, decisions,
policies and the borrower's own history, and the system prompt forbids outside knowledge
and requires blob-ID citations. Ask it why it refused your 900 and it explains itself
with receipts. Ask it the capital of France and it says *"I have no memory of that."* A
chatbot would say Paris; this one structurally can't.

## How a price is computed

Every number is deterministic. Memory moves the multiplier; it never touches the maths.

```
premium = payout × P(touch) × (1 + loading) × clamp(cases × rules × borrower, 0.6, 3.0)
```

**P(touch)** is the probability that a zero-drift geometric Brownian motion starting at spot
`S` touches the barrier `B` at any point before expiry — a first-passage problem, not a
European option. The price only has to *dip* to the trigger once, so pricing it as a
terminal-value option would badly under-reserve. With log-price drift `mu = -sigma^2/2`:

```
P(min <= B) = Phi((b + h)/s) + (S/B) · Phi((b - h)/s)
   where b = ln(B/S),  s = sigma·sqrt(T),  h = sigma^2·T/2
```

This ignores the requirement that the price *stay* below the trigger through the confirm
delay, which makes it slightly conservative — it over-prices rather than under-reserves.
See [`math.ts`](backend/src/pricing/math.ts).

**Loading** is a flat 15%. **The multiplier** is clamped to [0.6, 3.0] so no single memory can
run away with the price, and there's a floor of 0.10 gUSD on any premium.

The three multiplier factors:

- **Cases** — backtested base rates plus live outcomes. The backtest counts true intraday
  barrier touches, so its hit rate is directly comparable with the model's probability and may
  pull the price either way. It's Laplace-smoothed (`(k+1)/(n+2)`), weighted by sample size
  (`min(n,50)/50`), and the ratio is clamped to [0.7, 1.8] before weighting, so one thin bucket
  can't dominate. Only an **exact** bucket match may set a base rate — a neighbouring bucket's
  hit rate is a different number, not a noisy version of this one. Live payouts compound on top
  at 1.15× each, near-misses at 1.05×, capped at 3×; there the neighbourhood *does* count,
  because a payout one bucket away is still a warning.
- **Rules** — what the underwriter wrote for itself after measuring its own P&L.
- **Borrower** — their own verified history, from their own memory account.

Worked example, the $0.80 quote from the table above:

```
payout 10 gUSD × P(touch) 0.662 × loading 1.15 × memory 0.90  =  6.85 gUSD
```

Every factor that moved the number is returned with the blob ID that caused it.

## Why an off-chain price is safe

Pricing runs off-chain — it needs an LLM, Walrus recall and 400 days of history, none of which
belong in a Move call. The chain doesn't have to trust any of it.

The backend signs a BCS-serialised `QuoteMessage` with an Ed25519 key whose public half is
stored in the pool at creation. `buy` verifies that signature against the exact bytes before it
will do anything. The struct must match
[`ghostwriter.move`](backend/move/ghostwriter/sources/ghostwriter.move) field for field, because
BCS is order-sensitive:

```
domain · pool_id · buyer · kind · feed_id · strike_e8 · obligation_id
payout · premium · start_ms · end_ms · quote_id · expires_ms
```

`domain` is a fixed string (`ghostwriter.quote.v1`) so a signature can never be replayed as some
other message type. `pool_id` and `buyer` bind the quote to one pool and one wallet. `quote_id`
is single-use — the pool records spent IDs. `expires_ms` gives a 120-second TTL.

So the worst a compromised pricing backend can do is quote badly. It cannot mint a policy, pay
itself, change terms after signing, or let someone else use your quote. And if the signing key
ever drifts from the one the pool holds, `/v1/config` reports `quotePubkeyMatches: false` and
every purchase aborts with code 3 rather than failing silently.

The 24 abort codes, which the frontend maps to plain English in
[`errors.ts`](frontend/src/lib/errors.ts):

| | | | |
|---|---|---|---|
| 1 `EPaused` | 7 `ENotActive` | 13 `EBreachAlreadyReported` | 19 `ENotExpired` |
| 2 `EQuoteExpired` | 8 `EWrongKind` | 14 `ENoBreach` | 20 `EBadSeq` |
| 3 `EBadQuoteSig` | 9 `EOutsideWindow` | 15 `ETooEarly` | 21 `EBadParams` |
| 4 `EQuoteUsed` | 10 `EWrongFeed` | 16 `EBadAttestation` | 22 `ENegativePrice` |
| 5 `EInsufficientPayment` | 11 `EPriceTooUncertain` | 17 `EWrongPool` | 23 `EInsufficientFree` |
| 6 `EInsufficientCapacity` | 12 `ENotBreached` | 18 `EStaleEnclave` | 24 `EPriceAbove` |

## How a payout happens

Three calls, and the contract checks the price itself at both ends:

1. **`report_breach`** — anyone may call it. Reads the Pyth `PriceInfoObject`, asserts the price
   is at or below the strike and that we're inside the cover window, then stamps
   `breach_started_ms`.
2. **`reset_breach`** — if the price recovers before the delay elapses, the clock is cleared and
   the policy carries on.
3. **`confirm_breach`** — after `confirm_delay_ms` (120 s on this pool), **re-reads the price**
   and pays only if it's still at or below the strike.

The second read is the point. A single momentary wick doesn't trigger a payout, and the watcher
is never trusted — it can only *nominate* a breach. The watcher is a liveness dependency, not a
trust one.

One subtlety worth calling out, because it's the kind of thing that becomes an exploit:
`confirm_breach` also asserts `now <= end_ms + confirm_delay_ms`. Without it, a holder could
report a breach near expiry, never reset it, and confirm on any later dip — collecting on a
policy that had already ended. The contract refuses to depend on the off-chain watcher calling
`expire` or `reset_breach` honestly.

Price staleness and confidence are enforced too: `maxPriceAgeS` is 180 s and `maxConfBps` is 200,
so a stale or wide Pyth price aborts with 11 rather than settling on bad data.

## An agent is a customer

Go to `/agents` and type a sentence:

> Cover my SUI if it drops 15% over 3 days, don't pay more than 4 gUSD.

[`autobuyer.ts`](backend/src/agent/autobuyer.ts) splits this in two on purpose. The LLM
only parses the brief into mandate numbers — it never touches the transaction.
`runMandate()` is ordinary code that does the signing. Seven narrated steps follow:
parse, request a quote (HTTP **402 Payment Required**), read the memories behind the
price, check the premium against the budget, sign, pay, covered.

It pays from its own wallet, not yours — deliberately a third party, separate from both
the human buyer and the underwriter. In the x402 "exact" scheme on Sui the payment
payload *is* the signed purchase transaction, so paying and being covered cannot come
apart.

## How Walrus Memory is used

Memory isn't a log here, it's the pricing input. Remove it and the product loses both its
judgement and its portability.

**105 records on Sui Mainnet**, five namespaces, zero failed writes:

| Namespace | Records | What's in it |
|---|---|---|
| `ghostwriter-cases` | 46 | backtested base rates — how often SUI actually fell this far, this fast |
| `ghostwriter-decisions` | 48 | every accept, counter and decline, with reasoning |
| `ghostwriter-policies` | 9 | each policy written and how it ended |
| `ghostwriter-rules` | 1 | pricing rules the underwriter wrote for itself |
| `ghostwriter-quotes` | 1 | quote audit trail |

**The borrower owns their history.** Each borrower's records live in *their own*
`MemWalAccount`, created by them on memory.walrus.xyz, written by a delegate key they
granted and can revoke whenever they like. Records are Ed25519-signed by Ghostwriter and
hash-chained — each one points at the one before — and the latest `(seq, head)` is
anchored on Sui.

So a borrower can't forge a clean record (no signing key) and can't quietly delete a bad
one (the chain breaks, or the anchor stops matching). And any other underwriter they
authorise can verify the whole thing the same way. That's a no-claims bonus that travels
between insurers, which is not a thing that exists today.

## The borrower's record chain

Each borrower's history is a hash chain written into their own account. A record body is:

```json
{ "v": 1, "borrower": "0x…", "seq": 7, "prev": "<sha256 of record 6>", "kind": "…", "at": 1794… }
```

canonicalised, SHA-256'd, Ed25519-signed by Ghostwriter, then written to Walrus. Record 1 points
at a genesis hash of 64 zeros. The latest `(seq, head)` is anchored on Sui in a `Ledger` object, and
the contract enforces `seq = last + 1` (abort 20) — so anchors can't be written out of order or
skipped, and anchoring happens strictly in sequence even when writes land out of order.

What that buys: a borrower can't forge a clean history, because they don't hold the signing key.
They can't delete a bad record, because the chain breaks and the on-chain anchor stops matching.
And they *can* take the whole thing to a competing underwriter, who can verify it independently.
A no-claims bonus that moves between insurers doesn't exist in insurance today.

## How Tatum is used

Every chain read and write goes through Tatum's Sui gRPC gateways, on both networks:

- **Testnet** — pool state, policy objects, the on-chain Pyth `PriceInfoObject`, buy and
  settle transactions.
- **Mainnet** — the Walrus Memory account and its delegate keys.

The client is [`clients.ts`](backend/src/chain/clients.ts), one rate-limited channel per
network with the key in gRPC metadata. Worth knowing if you're building on this: Tatum
serves Sui over **gRPC only** — there's no Sui JSON-RPC endpoint, and asking for one
gets you a 404.

Two networks is the honest shape, not a shortcut: the hosted Walrus relayer is
Mainnet-only, and we weren't going to spend real money on demo policies.

## Proof it actually ran

One policy settled end to end with nobody touching it:

| | |
|---|---|
| Policy | `0x151cecc344ee80cdee61d050043ff7f481f718c630832c87660fa201ae02b779` |
| Premium | 9.730769 gUSD |
| Payout | 10 gUSD |
| Bought | 19:21 |
| Trigger crossed | 19:29 |
| **Paid** | **19:31** |
| Digest | `9MXG2zpaV1ZjdNH8jC4j5deWF8QEHRDG1KfPukrfvm9t` |

Pool as it stands: 2,016.69 gUSD in the vault, 1,966.69 free, 50 locked against open
policies, 31.69 collected in premiums, 15 paid out, loss ratio 0.473. Seven active
policies, one paid.

The 2.7 gUSD lost on that policy is the loss that taught it rule `SUI:mid:0-5`.

`/proof` in the app lists every one of these IDs live, along with the blob IDs and
signing keys, so nothing here has to be taken on trust.

## What isn't shipped

The repo contains a Nautilus enclave and a `settle_liquidation` path in the Move package,
for cover against Suilend liquidations. **This is not a working feature and we don't
claim it.**

The attestation service reads Mainnet and refuses to sign claims the transaction doesn't
support, and the Move side is covered by tests — but it runs as a plain binary outside
AWS Nitro, so it cannot produce a hardware attestation. `ENCLAVE_OBJECT_ID` is
deliberately empty and on-chain liquidation settlement is disabled. Price-drop cover is
the product; liquidation cover is unfinished work left in the tree.

## Limitations

Beyond the unshipped liquidation path:

- **One asset.** SUI only. BTC is wired end to end but disabled, because its Pyth price object on
  Testnet isn't being updated.
- **One pool, one admin.** `AdminCap` can pause the pool, deposit, withdraw unlocked funds and
  rotate the quote key. `withdraw` cannot touch capital locked against open policies (there's a
  test for exactly that), but this is a trusted operator, not a DAO.
- **The watcher is a liveness dependency.** It can't cause a wrong payout — the contract re-reads
  the price — but if it stops, payouts wait. `/v1/health` reports it and the UI banners it.
- **Capacity is static.** Limits are fractions of free capital, not a real risk model. No
  correlation across policies: twenty people buying the same trigger is twenty times the same bet,
  and only `MAX_BUCKET_SHARE` stops it.
- **Premiums don't earn.** Idle capital sits in the vault. A real pool would deploy it.
- **The backtest is 400 days of daily candles.** Enough to be useful, short enough that a regime
  change would invalidate the base rates.

## Decisions we had to make

**The LLM never touches a transaction.** It produces a verdict, a multiplier and prose. Capital
limits are enforced in `guard()` before the model is consulted and again in Move. The natural
language agent is split the same way: the model parses the brief into mandate numbers, ordinary
code does the signing. Judgement is model work; money is not.

**On-chain Pyth, not Hermes.** The contract reads a `PriceInfoObject` directly. Fetching a signed
price off-chain and passing it in would mean trusting our own backend about the price it's about
to be paid on. The cost is that we inherit Testnet's ~126 s push cadence, which is why
`maxPriceAgeS` is 180.

**Our own stablecoin.** `gUSD` has a public faucet capped at 1000 per call, so anyone can try the
product without hunting for Testnet tokens. A policy denominated in a coin nobody can get is a
demo nobody can run.

**Two networks.** Policies on Testnet, memory on Mainnet. The hosted Walrus relayer is
Mainnet-only, and we weren't going to spend real money on demo policies. It's the honest shape
rather than a shortcut, and the app labels which network every object lives on.

**SQLite, not Postgres.** `node:sqlite`, no external service. Walrus is canonical for anything
that matters — on a fresh database the rule cache rebuilds from memory and policies re-sync from
chain, which also means a wiped disk costs us the quote history and nothing else.

## Architecture

```
                         Sui MAINNET
            Walrus Memory: underwriter account
                  + one account per borrower
                            ▲
                            │ memwal SDK (hosted relayer)
                            │ Tatum gRPC (account reads)
                            │
 ┌───────────┐   REST/SSE   ├──────────────────────────┐
 │ Frontend  │◄────────────►│ Backend                  │
 │ Next.js   │              │ Node 24 · Fastify · SQLite│
 │ dapp-kit  │              │                          │
 └─────┬─────┘              │ pricing · underwriting   │
       │                    │ memory queue · x402      │
       │ signs buy tx       │ price + policy workers   │
       │                    └────────────┬─────────────┘
       │                                 │ Tatum gRPC
       ▼                                 ▼
                         Sui TESTNET
         Pool · Policy · Ledger · gUSD · Pyth price object
```

## Repo layout

```
backend/
  move/ghostwriter/   Pool, Policy, Ledger, AdminCap — BCS-signed quotes, 24 tests
  move/gusd/          test stablecoin with a public faucet
  move/enclave/       Nautilus registration (see "What isn't shipped")
  src/underwriting/   decide.ts (accept/counter/decline) · ask.ts (chat) · learn.ts (rules)
  src/pricing/        quote.ts · explain.ts
  src/agent/          autobuyer.ts — English brief to x402 purchase
  src/memory/         Walrus read/write, namespaces, recall
  src/chain/          Tatum gRPC clients, both networks
  src/x402/           x402 v2 Sui "exact" scheme
  src/workers/        price watcher · policy sync · checkpoint pulse · memory queue
  scripts/            deployment, funding, onboarding, smoke tests

frontend/src/
  app/                landing · home · onboard · cover · policies
                      underwriter · memory · agents · proof
  components/         AskUnderwriter · AgentBrief · WalletCapabilities · shell
  lib/                api · types · errors · format · SSE events

docs/
  HANDOFF.md          full knowledge transfer: every ID, the demo, the gotchas
  DEMO.md             demo script
  WIRING.md           page-by-page frontend/backend wiring
  BACKEND_STATUS.md   build status
```

## Running it

Node 24.13.1 and pnpm 9.15.0. You'll need a Tatum API key per network, a Walrus Memory
account on Mainnet with a delegate key, and an OpenAI-compatible inference endpoint (we
used Vultr).

```bash
# backend
cd backend
pnpm install
cp .env.example .env        # fill it in; src/config.ts validates on boot and
                            # prints the names of anything missing
pnpm keys                   # generates the quote + record signing keys
pnpm dev                    # :8787
```

```bash
# frontend  (npm here, not pnpm — the lockfile is package-lock.json)
cd frontend
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL, nothing else
npm run dev                 # :3000
```

Check it came up with `curl -s localhost:8787/v1/health`. All four workers should report
`running` or `polling`; the hedger is `disabled` by design.

Two things that will waste your afternoon if you don't know them:

- **Run one backend.** Several at once fight over the SQLite file and burn through Tatum
  credits. `lsof -nP -iTCP:8787 -sTCP:LISTEN` before you start.
- **`CORS_ORIGINS` must list the port Next actually bound.** Next falls back to :3001
  when :3000 is taken, and then the app reports the backend as unreachable while `curl`
  works fine.

To deploy your own pool: `pnpm pool:create`, then `pnpm pool:fund`, then `pnpm seed` to
write the backtested cases into Walrus. `pnpm fund:gusd` tops up test coins — the faucet
caps at 1000 per call.

## Deployed addresses

**Sui Testnet**

```
package     0xff272f596619f255a591323d32d7d0a3835fbdaf84718bdb61f7dec263e23060
pool        0x76e3792eeb08a19ad7cb1a72e53472c1f3194726be0aeb8b0ed5ede587051d74
gUSD        0x6dc2c1e1afe9ceece7e2bf64c52055110e5777404d6d23c6d5e51622ec14f2f1::gusd::GUSD
faucet      0x728cea2bd6f17243b575bea09e017407919113aff264389f707bd7b3529501d5
SUI/USD     0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744
```

**Sui Mainnet (Walrus Memory)**

```
memwal package   0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5
memwal registry  0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f
underwriter acct 0x8b7608b6c7911acb97353a6010280bfb687ce4396127e7d9b5c18c72c39f89ab
agent id         4cafd304de73c09608d6318561c8c2701d321c2365d20535278b63f6e48a2176
relayer          https://relayer.memory.walrus.xyz
```

**Public signing keys**

```
quote signing key   62a55ba3994c5d6df8e6aceda8e313c587e6e20627cbfffde50231bba73f6a16
record signing key  3b92d499f8392ceeb2e60bf639cb16551f5777b4974c7131ce6b419182a434f5
```

`/v1/config` returns `quotePubkeyMatches` — if that ever goes false, the key the backend
signs quotes with has drifted from the one the pool checks, and every purchase will abort
with code 3.

## Tests

```bash
cd backend/move/ghostwriter && sui move test   # 24 passing
cd backend && pnpm test                        # 19 passing
```

The Move suite covers the things that would cost real money: forged quote signatures,
tampered terms, replayed quotes, expired quotes, underpayment, buying past free capacity,
buying while paused, withdrawing locked funds, early expiry, and ledger sequence gaps.

## API

```
GET  /v1/health                            workers and uptime
GET  /v1/config                            networks, object ids, pool state, key match
GET  /v1/market                            on-chain Pyth price
POST /v1/quotes                            price a cover request (may decline or counter)
GET  /v1/quotes/:id
GET  /v1/policies         GET /v1/policies/:id
POST /v1/policies/confirm                  register a purchase after the wallet signs
GET  /v1/borrowers/:address                + /history, /positions
GET  /v1/underwriter/book                  capital, rules, multiplier history
GET  /v1/underwriter/memory
POST /v1/underwriter/ask                   chat, grounded only in Walrus
POST /v1/agent/run                         natural-language brief to a bought policy
POST /v1/agent/cover                       x402-gated purchase endpoint
GET  /v1/proof                             every id, key and blob
GET  /v1/events                            SSE: prices, breaches, payouts, anchors
```
