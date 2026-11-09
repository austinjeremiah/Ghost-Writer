# Ghostwriter — demo runbook

A recording script that works **without voiceover**. Every scene says what to do, what to verify
before moving on, and what the viewer should be able to read on screen by themselves.

Do a silent dry run first. Only record once every ✅ below passes.

---

## Pre-flight

Three processes:

```bash
cd backend  && pnpm dev                                        # :8787
cd frontend && npm run dev                                     # :3001
cd ~/Desktop/Hacks/nautilus/src/nautilus-server \
  && PORT=3010 API_KEY=unused ./target/debug/nautilus-server   # :3010
```

Wallet `0xb199b981…9450` in Slush, **Network: Testnet** (Mainnet was only for onboarding):

| Check | Expected |
|---|---|
| Testnet SUI | ≥ 0.5 |
| gUSD | 1,000.00 |
| Onboarded | `/onboard` shows "You're set up." |

Then:

- **Reload every page once** before recording. The onboarding panel shows a stale "#0 anchored"
  until it refetches; after a reload it reads **#1**.
- Close DevTools.
- Browser zoom **110–125%** — text must be readable in a small video frame.
- Hide bookmarks (⌘⇧B) and use a clean window.

Live values at time of writing, so you know what "right" looks like: SUI ≈ **$0.85**, vol **72.8%**,
vault **1,997.55 gUSD**, **47** Mainnet memories (45 cases, 1 quote, 1 policy).

---

## Scene 1 · The landing — 15s

**Do:** open `http://localhost:3001/`. Scroll slowly to the stats row, then back up.

**Verify:** ✅ hero fills the screen, no sidebar ✅ dots sit *behind* the text ✅ "SUI now" shows a
real price ✅ "Memories on Mainnet" shows **47**

**Reads by itself:** the headline states the product. The stats prove it is live, not a mockup.

## Scene 2 · It is running — 15s

**Do:** click **See it live** → `/home`.

**Verify:** ✅ sidebar appears ✅ spot price, vault and memory count all populated, no dashes
✅ top bar shows **1000.00 gUSD** and a green **Live** dot

**Reads by itself:** "Policies: Testnet" and "Memory: Mainnet" chips tell the viewer the split.

## Scene 3 · The borrower owns their memory — insert your clip

**Use the onboarding recording you already took.** Drop it in here, after `/home` and before
`/cover`. It is the right place: the viewer has seen the product is live, and now learns whose
memory this is — which is what makes the next scene mean something.

If you re-record it, show: connect → **Create your memory account** (Mainnet tx) → **Add
Ghostwriter's key** (Mainnet tx) → "You're set up."

**Then cut back to the live page** at `/onboard` so the end state is on screen:

**Verify:** ✅ all four steps green ✅ account `0x8e21ed9e…f1a7` ✅ ledger `0x20750e03…1959`
✅ **1** record, **#1** anchored on Sui ✅ blob link present

**Reads by itself:** "Your insurance history lives in your own Walrus Memory account… You can
remove Ghostwriter's access at any time."

## Scene 4 · ⭐ The differentiator — 60s, the most important scene

Two quotes at different triggers. Memory corrects each one differently, and **cites the blob that
did it**.

**Do:** `/cover` → Price drop → SUI → trigger **0.81**, payout **10**, duration **7** → Get quote.
Let the citation sit on screen for 3–4 seconds.

**Verify:** ✅ premium ≈ **8.85 gUSD** ✅ multiplier ≈ **×1.17** ✅ citation reads
*"backtest SUI 0-5% 4-7d: 139/180 touched (76.9%)"* ✅ second citation *"your record #1: onboarded"*
✅ badge says **Written by AI**

**Do:** change the trigger to **0.72** → Get quote again.

**Verify:** ✅ premium drops to ≈ **1.33 gUSD** ✅ multiplier ≈ **×1.03** ✅ citation now reads
*"15-25% 4-7d: 20/180 touched (11.5%)"* — a **different** memory

**Reads by itself:** the two citations are the argument. 76.9% of similar cases touched the barrier,
so the price went up 17%. 11.5% touched, so it barely moved. The pricing is not a black box; it
shows its evidence.

> If the numbers differ from the table above, that is fine — the spot price moves. What must hold is
> that **the citation text matches the multiplier** and that the two quotes cite **different** blobs.

**Do:** buy the 0.72 one. Approve in Slush.

**Verify:** ✅ one wallet prompt ✅ gUSD drops by the premium ✅ policy appears

## Scene 4a · Ask it about the quote, right there — 30s

Under every quote there is an **Ask about this quote** box. The quote's own numbers travel with the
question, so follow-ups work.

**Do:** click the suggestion **"Why is this premium what it is?"**, then **"What would make it
cheaper?"**

Expect, roughly: *"I priced this premium at 5.18 gUSD based on a 0.52 probability… I applied a
memory multiplier of x0.72… My backtest memory [X0EYnlVP] indicates… 45.1% of cases."* Then, on the
follow-up, concrete advice grounded in a **different** memory for the wider bucket.

**Verify:** ✅ it speaks in the first person ✅ it cites blob ids ✅ the memories it used are listed
with Walruscan links ✅ the second answer follows on from the first

**Reads by itself:** the price is not a black box you have to accept. You can interrogate it, and
it answers from the same memories it priced with.

## Scene 4b · ⭐⭐ The underwriter says no — 45s, the scene that proves it is an agent

This is the difference between a parametric escrow and an underwriter. Do it **before** buying.

**Do:** on `/cover`, keep the trigger, set payout to **900** → Get quote.

**Verify:** ✅ no quote is issued ✅ the panel reads something like *"A single policy is capped at
25% of free capital, which is 498.14 gUSD here"* ✅ it shows free capital and bucket exposure
✅ two buttons appear under **"Terms it would accept"**

**Do:** click **"498.13 gUSD payout instead"** — the form fills itself. Then set payout back to
**10** and quote normally.

**Verify on the accepted quote:** ✅ badge **Underwriter: accept** ✅ badge **agent judged**
✅ a reason in its own words, e.g. *"Pool has ample free capital and zero existing SUI exposure.
The 10 gUSD payout is negligible (0.5% of free capital), and the 45.1% historical hit rate is
acceptable given the low concentration."*

**Reads by itself:** the service refused money, explained why in terms of its own book, and offered
terms it would accept. Then it took a smaller risk and said why that one was fine.

**Worth showing after:** `/underwriter` → memory → **decisions** namespace. Every verdict is written
to Walrus Mainnet, so the next decision recalls the last. The appetite is *learned*, not configured.

**The architecture line, if anyone asks:** judgement sits inside a mandate. Capital and
concentration limits are hard-coded and the model cannot cross them; inside those limits the agent
reasons over recalled memory, its own past verdicts, the borrower's record and live exposure. A
malicious memory can change wording, never solvency.

## Scene 5 · It settles itself — 30s

**Do:** open the new policy from `/policies`.

**Verify:** ✅ status **active**, countdown running ✅ buy digest links to Suiscan ✅ terms shown in
plain language

**Reads by itself:** "Pays 10 gUSD if the price stays below $0.72 until then." No claim form
anywhere on the page.

> **You can trigger a real payout on camera** — no fakery needed. Buy cover with a trigger just
> **0.1% below spot** (quote it, the form accepts it). At 72.8% annual vol SUI crosses that within
> a few Pyth pushes, usually 2–6 minutes. The watcher reports the breach, the contract re-checks the
> price itself after the 120 s delay, and the payout lands. Real breach, real contract, real digest.
>
> Bonus: that quote prices at about **×0.70** — memory pushing the price *down*. Paired with ×1.17
> at 5% below, you show memory correcting in **both directions**.
>
> If it has not crossed by the time you need to move on, cut to the already-settled policy. Never
> imply a payout happened if it did not.

## Scene 6 · The TEE, honestly — 45s

**Do:** `/cover` → **Liquidation** tab → obligation
`0x1040b150d07a3ccb920d01af5e315364844b9709f2ecea00e18a9bdbc507efdd` → payout **10**, **1** day →
quote → buy. Then open the policy and claim with this **real Mainnet** digest:

```
HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV
```

**Verify:** ✅ the claim is **refused**: *"no LiquidateEvent for this obligation in that
transaction"*

**Reads by itself:** that transaction is a genuine Suilend liquidation from 8 Nov 2026 — of a
*different* obligation. The service asked the enclave to attest it and the enclave said no, because
it reads Mainnet itself instead of trusting the caller.

**Put this on screen as a caption, because it is the honest part:**

> The enclave verifies real Mainnet liquidations and refuses false ones. It runs outside Nitro
> hardware here, so on-chain settlement of a liquidation claim is not enabled.

## Scene 7 · The history is the borrower's — 20s

**Do:** `/memory`.

**Verify:** ✅ record #1 `onboarded` ✅ signature valid ✅ blob link to Walruscan ✅ anchored on Sui

**Reads by itself:** each record shows its hash and the previous hash — a chain neither side can
quietly edit.

## Scene 8 · It learns — 20s

**Do:** `/underwriter`.

**Verify:** ✅ vault ≈ 1,997 gUSD ✅ premiums collected and payouts made both non-zero
✅ loss ratio ✅ multiplier history with several entries

**Reads by itself:** the multiplier history is memory changing the price over time, not a static
formula.

## Scene 8b · ⭐⭐⭐ Talk to the underwriter — 60s, the closing argument

Top of `/underwriter`. Ask it three questions, in this order.

**1. Make it explain its own decision.**

> *Why did you refuse to cover 900 gUSD?*

Expect, roughly: *"I refused the 900 gUSD payout because it exceeded my single-policy limit. My
mandate caps any individual policy at 25% of my free capital. With 1992.55 gUSD available, that
maximum is 498.14 gUSD… [l7_F9rCO]"*

**Verify:** ✅ it speaks in the first person ✅ it cites a blob id ✅ the memories it used are
listed underneath with links to Walruscan

**2. Make it reason from its backtests.**

> *What have you learned about SUI falling 5% in a week?*

Expect it to quote actual hit rates from recalled cases, cite them, **and say what it has no memory
of** — it distinguishes the buckets it holds from the question you asked.

**3. The one that proves it. Ask something outside its memory.**

> *What is the capital of France?*

Expect: *"I have no memory of that. My records only contain underwriting decisions, policy details,
and backtest cases for SUI liquidation cover. I do not hold general geographic knowledge."*

**Verify:** ✅ it refuses

**Reads by itself:** this is the whole thesis in one exchange. A chatbot would answer "Paris". This
one cannot, because it is not answering from a model's training — it is answering from memories it
wrote to Walrus Mainnet, and you can open every one of them.

> The line to put on screen: **"Grounded in Walrus, not in training data."**

Nothing it says can move money. Pricing and the underwriting mandate are in code; the agent reads
memory and speaks. Memory text is untrusted input — anyone who buys a policy writes into these
namespaces — so it may quote and summarise, never decide.

## Scene 9 · Machines are customers — 25s

**Do:** `/agents` → fill the form → ask for cover.

**Verify:** ✅ a **402 Payment Required** with the payment terms, amount in gUSD, and the quote

**Reads by itself:** x402 is the agent-payments standard. The agent is quoted, pays, and is covered
with no human in the loop.

## Scene 10 · Receipts — 20s

**Do:** `/proof`.

**Verify:** ✅ **47** memories, split 45 cases / 1 quote / 1 policy ✅ recent blob ids
✅ record and quote public keys ✅ package and pool ids

**Reads by itself:** everything claimed earlier has an id a viewer can look up.

---

## What not to claim

- The enclave is **not** inside Nitro hardware. Say so (Scene 6 caption).
- `enclaveObjectId` is empty on `/proof`. If anyone asks, that is why liquidation settlement is off.
- Do not stage a payout that did not happen.

## If something breaks mid-recording

| Symptom | Fix |
|---|---|
| "Backend not reachable" | Backend died — restart `pnpm dev`; CORS already allows :3001 |
| Reconnecting pill stuck | SSE dropped; reload the page |
| Quote fails "price too uncertain" | Pyth push gap; wait ~2 min and requote |
| Quote expired | They last 120 s — just requote |
| Liquidation tab grey | Wrong wallet connected; it must be `0xb199b981…9450` |
| Enclave health false | The `:3010` process died; restart it |
