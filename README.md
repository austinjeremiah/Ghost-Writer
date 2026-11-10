# Ghostwriter

Price-drop cover for Sui borrowers, priced by an AI underwriter whose memory lives on
Walrus Memory.

Built for **Total Recall — Tatum × Walrus Memory**.

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
