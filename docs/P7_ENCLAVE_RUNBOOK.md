# P7 — Nautilus enclave runbook

Every value below is this project's real value. Work top to bottom and tick as you go.

**What the enclave is for:** it is the only component our Move contract trusts for liquidation facts.
It reads a Mainnet transaction itself, checks that it really contains a Suilend `LiquidateEvent` for
the covered obligation, and signs that attestation. The contract verifies the signature against a
key registered only via a Nitro attestation with matching PCRs — so the backend cannot forge a
liquidation even if it wanted to.

---

## Status

| Stage | State |
|---|---|
| A. Enclave app written | ✅ `backend/enclave/mod.rs` |
| B. Wired into a Nautilus clone | ✅ `../nautilus` @ `0104d627` |
| C. **Compiles** | ✅ `cargo check --no-default-features --features ghostwriter` clean |
| D. **BCS layout verified against Move** | ✅ Rust test + `backend/test/attestation-bcs.test.ts` agree byte-for-byte |
| D2. **Enclave logic verified against live Mainnet** | ✅ signs a real Suilend liquidation, refuses two kinds of false claim — see *Verified without AWS* |
| D3. **On-chain settlement verified with real signatures** | ✅ 7 Move tests, including aborts 16, 18 and 9 |
| D4. **Local enclave app runs and serves the real path** | ✅ `/public_key`, `/process_data` sign + refuse, on any port |
| E. AWS account prepared | ✅ CLI, credentials, key pair, secret, IAM role, security group, generated code |
| E2. **Nitro instance launched** | 🔴 **BLOCKED — AWS account plan.** See below |
| F. Build + run in the enclave | ⬜ needs E2 |
| G. `update_pcrs` + `register_enclave` | ⬜ one command, ready: `pnpm enclave:register` |
| H. `.env` wired, backend restarted | ⬜ |
| I. Exit checks pass | ⬜ (3 of the 4 already pass off-instance — see below) |

Everything that does not require Nitro hardware is done and tested, at zero cost. What the
instance would add is the hardware attestation that binds the signing key to this exact code.

---

## 🔴 The blocker: AWS Free Plan cannot launch a Nitro instance

`RunInstances` fails with:

```
InvalidParameterCombination: The specified instance type is not eligible for Free Tier.
```

This is not a quota problem and not a credit problem. Since July 2025 new AWS accounts choose a
**Free Plan** or a **Paid Plan**, and the Free Plan blocks instance types that would burn the credit
allowance quickly. Nitro Enclaves need at least 4 vCPU, and **every** Free-Plan-eligible type is 2
vCPU with `NitroEnclavesSupport: unsupported`. Verified on this account:

```
$ aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
    --query 'InstanceTypes[?NitroEnclavesSupport==`supported`].InstanceType'
[]
```

The intersection is empty, so no choice of instance type, region or flag avoids it.

**Upgrading the plan is not the same as paying.** In the Billing and Cost Management console, use
**Upgrade Plan** in the Cost and Usage widget or the banner in the nav bar. Remaining sign-up
credits carry over, and `m5.xlarge` is about $0.19/hour plus about $0.02/hour for the volume — so a
three-hour session to build, register and record the demo spends roughly **$0.65 of existing
credits**. A payment method must be on file, and overage past the credits would be billed, so
terminate the instance afterwards.

**Do not** upgrade by joining an AWS Organization or by setting up a Control Tower landing zone —
that path expires the credits immediately. Use the Upgrade Plan button.

---

## Verified without AWS

These run on a laptop, cost nothing, and cover every part of the path except the hardware.

### 1. The enclave logic, against real Mainnet liquidations

```bash
cd ~/Desktop/Hacks/nautilus/src/nautilus-server
cargo test --no-default-features --features ghostwriter -- --ignored --nocapture
```

Three tests, all passing, against Sui Mainnet over the network:

| Test | What it proves |
|---|---|
| `signs_a_real_mainnet_liquidation` | Reads Mainnet tx `HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV`, finds the `LiquidateEvent` for obligation `0xcc69…22e4`, takes the timestamp from the chain (`1794175084189`), signs, and the signature verifies over exactly the BCS bytes the Move contract rebuilds |
| `refuses_an_obligation_that_transaction_did_not_liquidate` | **The security property.** Same real transaction, a different real obligation → *"no LiquidateEvent for this obligation in that transaction"*, no signature |
| `refuses_a_digest_that_does_not_exist` | A fabricated digest is refused |

This is exit check 3 from the list below, minus the hardware. The enclave is asked to attest
something false and declines, because it reads the chain itself.

### 2. On-chain settlement, with real signatures

```bash
cd backend/move/ghostwriter && sui move test settle_liquidation
```

Five tests. `new_enclave_for_testing` holds a public key whose private half we control, so the
signature `settle_liquidation` verifies is a genuine ed25519 signature over the genuine BCS intent
message — the same bytes the Rust enclave emits. Only the key's origin is simulated.

| Test | Abort |
|---|---|
| `settle_liquidation_pays_the_holder_on_a_valid_attestation` | — pays the payout, unlocks the pool, coin reaches the holder |
| `settle_liquidation_rejects_a_tampered_amount` | 16 `EBadAttestation` |
| `settle_liquidation_rejects_a_substituted_digest` | 16 `EBadAttestation` |
| `settle_liquidation_rejects_an_enclave_registered_against_old_pcrs` | 18 `EStaleEnclave` |
| `settle_liquidation_rejects_a_liquidation_outside_the_window` | 9 `EOutsideWindow` |

Regenerate the test vectors with `node scripts/gen-liq-test-vectors.mjs`.

### What is still unproven

Only this: that the key which signed the attestation belongs to a TEE running this exact code. That
is what the Nitro attestation document establishes, and it is the one thing the instance buys. Say
so plainly in the demo rather than implying the TEE is live.

---

## Finishing the demo without a TEE — and what it costs you

There are two honest ways to demo, and the choice is about what you claim, not about what works.

### Option A — demo what is true now (recommended, nothing to deploy)

Show, live:

- memory-driven quotes moving the price both directions with blob citations
- the price-breach payout, end to end on Testnet
- the x402 agent buying cover by itself
- borrower history hash-chained and anchored
- **the enclave app running locally**: it reads a real Mainnet Suilend liquidation and signs it; it
  refuses an obligation that transaction did not liquidate

Then say: *"settlement against this attestation is proven by the contract's tests; the Nitro
attestation that binds the key to the hardware needs a paid AWS instance, so it is not deployed."*

Nothing is overstated and nothing is deployed. This is the state the repo is in today.

### Option B — put the liquidation payout on-chain, with two concessions

This makes the liquidation path settle for real on Testnet. It requires two compromises, and both
have to be said out loud or the demo misrepresents itself.

**Concession 1 — the key is operator-registered, not hardware-attested.** The `enclave` package gets
an upgrade adding `register_enclave_by_cap`, which stores a signing key under the `Cap` with no
attestation document. Everything downstream is unchanged: the same ed25519 signature over the same
BCS intent message, the same `config_version` pinning, the same aborts. What is lost is the single
link the TEE exists to provide — proof that the key lives in an enclave running this code. An
auditor can spot it: an `Enclave` registered this way has no `load_nitro_attestation` call in its
creating transaction.

**Concession 2 — the policy window has to be backdated.** `settle_liquidation` requires
`start_ms <= timestamp_ms <= end_ms`, and the timestamp comes from the chain. The known Mainnet
liquidation happened on 8 Nov 2026 at `1794175084189`, so a policy bought today starts after it and
aborts 9 `EOutsideWindow`. Either backdate `start_ms`, or wait for a liquidation of an obligation you
already cover — which you cannot schedule, since you do not choose who gets liquidated.

Concession 1 is already built and tested. Concession 2 is not, and it is the one that makes the
scenario artificial rather than merely unattested.

```bash
# 1. Upgrade the enclave package in place (original id is kept, so nothing else republishes).
cd backend/move/enclave
sui move build --dump-bytecode-as-base64 | tail -1 > /tmp/eb.json
cd ../.. && pnpm enclave:upgrade /tmp/eb.json

# 2. Run the enclave app locally, off 3000 so a frontend dev server can keep it.
cd ~/Desktop/Hacks/nautilus/src/nautilus-server
PORT=3010 API_KEY=unused-graphql-needs-none cargo run --no-default-features --features ghostwriter

# 3. Register its key (prints ENCLAVE_OBJECT_ID / ENCLAVE_URL for .env), then restart the backend.
cd backend && pnpm enclave:register-local --url http://localhost:3010
```

The app regenerates its key on every start, so step 3 repeats after any restart.

**My recommendation is Option A.** The TEE's whole claim is "you do not have to trust the operator",
and Option B registers a key on the operator's word. A judge who understands Nautilus will ask how
the key was registered, and "we could not launch a Nitro instance, so here is the logic running live
against Mainnet and the settlement proven by tests" is a better answer than a payout whose trust
root is an admin capability.

---

## Data source: Sui GraphQL, not Tatum

The app first used Tatum's `sui_getTransactionBlock`. That does not work, and it would only have
failed once the enclave was already running:

| Endpoint | Result |
|---|---|
| `https://sui-mainnet.gateway.tatum.io` + any JSON-RPC method | `{"statusCode": 404, "message": "Not Found"}` — Tatum serves Sui over **gRPC only** |
| `https://fullnode.mainnet.sui.io` + JSON-RPC | *"JSON-RPC on public fullnodes has been deprecated"* |
| `https://graphql.mainnet.sui.io/graphql` | ✅ works, no API key |

So the enclave now queries GraphQL:

```graphql
query($d:String!){transaction(digest:$d){digest effects{status timestamp events{nodes{contents{type{repr} json}}}}}}
```

Two consequences:

- **The enclave holds no secret.** GraphQL needs no credentials. The `tatum-key` secret still exists
  and is still wired in, only because `nautilus-server/src/main.rs` does
  `std::env::var("API_KEY").expect("API_KEY must be set")` at boot. Its value is now unused.
- `allowed_endpoints.yaml` is `graphql.mainnet.sui.io`, and `run.sh` maps it to `127.0.0.64`.
  `configure_enclave.sh` regenerates both from the allowlist, so just re-run it.

GraphQL reports the checkpoint time as RFC 3339 (`2026-11-08T21:58:04.189Z`) rather than epoch
milliseconds, and the contract compares that signed timestamp against the cover window. The
conversion is therefore part of the trusted path, written out rather than pulled in as a
dependency, and covered by `rfc3339_parses_to_epoch_millis` against the live Mainnet value.

Note that one liquidation transaction can carry several `LiquidateEvent`s, one per reserve. The
contract pays the policy's fixed payout and records the digest as evidence, so the amounts are
informational and the first matching event is enough.

---

## Constants for this project

```bash
export ENCLAVE_PACKAGE_ID=0xc9c14c07c24fc80c1425dcb8f52385d0bb0ff9f671f9dc856a1719c746521802
export APP_PACKAGE_ID=0xff272f596619f255a591323d32d7d0a3835fbdaf84718bdb61f7dec263e23060
export ENCLAVE_CONFIG_OBJECT_ID=0xea95563f84284e7bfef75a0885ea361c1ccaf8d70005e7e151ed0442333e57f8
export CAP_OBJECT_ID=0x125895a0aca256e38cdfe7753136510977bcf238580a96582fe948213b5a0bc6
export MODULE_NAME=ghostwriter
export OTW_NAME=GHOSTWRITER
```

The `Cap` is owned by the backend's **server address**
`0xdd6389cc38a64526d84e6189ef8904cf8e83f4721b08f65fe96b8579b46e6f2b`, which is **not** in the local
Sui CLI keystore. That is why stage G runs as a backend script rather than `register_enclave.sh`.

---

## Stage E — AWS, already done

| Thing | Value |
|---|---|
| Account | `678503489652` (root access keys were used — **delete them**, see Housekeeping) |
| Region | `us-east-1` |
| AWS CLI | 2.39.6, via `brew install awscli` |
| EC2 key pair | `ghostwriter`, private key at `~/.ssh/ghostwriter.pem` (mode 400) |
| Secrets Manager | `arn:aws:secretsmanager:us-east-1:678503489652:secret:tatum-key-fN94C8` — now only satisfies the template's `API_KEY` requirement |
| IAM role + instance profile | `role-ghostwriter-114344`, may read exactly that one secret |
| Security group | `instance-script-sg` = `sg-06fc00872ece4cbf9`, inbound 22 / 443 / 3000 |
| Default VPC | `vpc-0c589bbf40642b4a9` |
| vCPU quota | 8 (m5.xlarge needs 4) ✅ |

After the plan upgrade, re-run the configure script. It regenerates `user-data.sh`, `run.sh` and
`expose_enclave.sh` from the current allowlist, which is what picks up the GraphQL host:

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=us-east-1
export KEY_PAIR=ghostwriter EC2_INSTANCE_NAME=ghostwriter
cd ~/Desktop/Hacks/nautilus
sh configure_enclave.sh ghostwriter      # answer: y → existing → the secret ARN above
```

Answering **existing** with that ARN reuses the secret instead of creating a second one.

## Stage F — build and run

```bash
rsync -avz -e "ssh -i ~/.ssh/ghostwriter.pem" ./ ec2-user@<public-ip>:~/nautilus/
ssh -i ~/.ssh/ghostwriter.pem ec2-user@<public-ip>
  cd nautilus
  make ENCLAVE_APP=ghostwriter      # docker build; first run takes a while
  make run
  sh expose_enclave.sh
  nitro-cli describe-eif --eif-path out/nitro.eif > eif.json
```

Wait 2–3 minutes after launch before the first ssh — user-data is still installing the Nitro
tooling, Docker and socat. Then copy the measurements back:

```bash
scp -i ~/.ssh/ghostwriter.pem ec2-user@<public-ip>:~/nautilus/eif.json /tmp/eif.json
```

## Stage G — register on Testnet, one command

```bash
cd backend
pnpm enclave:register --url http://<public-ip>:3000 --eif /tmp/eif.json
```

`backend/scripts/enclave-register.ts` does both halves in the required order:

1. `update_pcrs(config, cap, pcr0, pcr1, pcr2)` — signed with the server key, which owns the `Cap`.
2. `GET /get_attestation`, then a PTB of `0x2::nitro_attestation::load_nitro_attestation` followed by
   `enclave::register_enclave`, printing the new shared `Enclave` object id.

`update_pcrs` **must** come first — it bumps `config.version`, and the contract refuses any enclave
whose `config_version` is behind, which is abort 18 `EStaleEnclave`. The script enforces the order,
and `settle_liquidation_rejects_an_enclave_registered_against_old_pcrs` proves the contract really
does reject it.

## Stage H — wire the backend

The script prints these two lines. Put them in `backend/.env`:

```
ENCLAVE_OBJECT_ID=<printed by enclave:register>
ENCLAVE_URL=http://<public-ip>:3000
```

Restart the backend (`.env` is read at boot; `tsx watch` does not pick it up).

```bash
curl -s localhost:8787/v1/enclave/health     # { configured: true, health: {...} }
```

## Stage I — exit checks

1. `curl -s $ENCLAVE_URL/health_check` → reports `graphql.mainnet.sui.io: true`
2. `/v1/enclave/health` → `configured: true`
3. **Refusal test.** Already proven off-instance by
   `refuses_an_obligation_that_transaction_did_not_liquidate`; on the instance it goes through the
   backend. Buy a 1-day liquidation policy on any obligation id, then claim it with a Mainnet digest
   whose obligation does not match:
   ```bash
   curl -s -X POST localhost:8787/v1/policies/<policyId>/claim-liquidation \
     -H 'content-type: application/json' -d '{"txDigest":"HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV"}'
   ```
   Expect `502 UPSTREAM_ENCLAVE` with *"no LiquidateEvent for this obligation in that transaction"*.
4. **Full path.** Cover obligation `0xcc698926b57d5b971bf1f05133909151f08f182d90b77ef280bbb1acb69422e4`
   with a window that contains `1794175084189`, then claim with digest
   `HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV` — a liquidation that really happened on Mainnet on
   8 Nov 2026. SSE should go `liquidation.seen` → `policy.paid` with `path: liquidation`. **This no
   longer needs you to arrange a live liquidation**, which was the old plan's weakest point.

   Find more recent ones with:
   ```bash
   curl -s -X POST https://graphql.mainnet.sui.io/graphql -H 'content-type: application/json' \
     -d '{"query":"{ events(filter: {type: \"0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LiquidateEvent\"}, last: 10) { nodes { transaction { digest effects { timestamp } } contents { json } } } }"}'
   ```

---

## Things that will bite you

| Symptom | Cause | Fix |
|---|---|---|
| `RunInstances` says **not eligible for Free Tier** | The account plan, not a quota | Upgrade the account plan — see the blocker section |
| Enclave can't reach the chain | Allowlist or `/etc/hosts` still points at Tatum | Re-run `configure_enclave.sh`; the allowlist is `graphql.mainnet.sui.io` |
| `API_KEY must be set` at boot | No secret configured | The value is unused but must exist; reuse the `tatum-key` ARN |
| Settlement aborts **16** `EBadAttestation` | BCS drift Rust ↔ Move, or the enclave restarted without re-registering | `pnpm test`, `cargo test` and `sui move test` all lock the layout. Otherwise re-register. |
| Settlement aborts **18** `EStaleEnclave` | PCRs updated after registering | `pnpm enclave:register` does both in the right order |
| Settlement aborts **9** `EOutsideWindow` | The liquidation's signed timestamp is outside the policy window | Expected; the backend reports this before sending the transaction |
| `sui move test` fails in `backend/move/enclave` with `MISSING_DEPENDENCY` in `sui::object` | Pre-existing: that package pins Sui framework rev `06734f6f…` while `ghostwriter` pins `718ae563…`, and the older rev's bytecode is not verifiable by the current CLI's VM. Confirmed against an unmodified checkout. | Harmless — the module's logic is covered by ghostwriter's 24 tests, which compile it as a dependency. Repinning would change the built bytecode, so do not do it while an upgrade is pending. |
| `sui move test` fails loading `move-stdlib` | `Move.lock` was generated on Windows, with `crates\…` backslash subdirs | Already fixed; keep paths forward-slashed |
| Everything works, then stops after a reboot | **The enclave key is regenerated on every start** | `make run` + `expose_enclave.sh` + `pnpm enclave:register` again |

**Plan for the demo:** start the instance and re-register about 30 minutes before recording, and
terminate it straight after.

---

## Housekeeping

- The AWS credentials used here were **root account access keys**. Root keys cannot be scoped and
  compromise the whole account. Delete them in IAM → *My security credentials* → *Access keys*, and
  use an IAM user or SSO afterwards.
- Terminate the EC2 instance after the demo. Stopping it halts the hourly charge but the 200 GB
  volume keeps billing.
- The `tatum-key` secret costs about $0.40/month. Delete it when the project is done.

---

## Reproducing the Nautilus wiring on a fresh clone

The clone is not in this repo. Three changes recreate it:

1. `cp backend/enclave/mod.rs nautilus/src/nautilus-server/src/apps/ghostwriter/mod.rs`, and
   `backend/enclave/allowed_endpoints.yaml` beside it
2. `src/nautilus-server/Cargo.toml` → add `ghostwriter = []` under `[features]`
2c. `src/nautilus-server/src/common.rs` → in `check_endpoint`, the non-AWS branch returns `true`
   for any HTTP response instead of requiring a 2xx. The probe tests whether the enclave can reach
   a host at all (i.e. whether the vsock forwarder works); `https://graphql.mainnet.sui.io` answers
   404 to a bare `GET /` because the endpoint is at `/graphql`, so demanding a 2xx reported a
   perfectly reachable host as unreachable in `/health_check`.
2b. `src/nautilus-server/src/main.rs` → two small changes: bind `PORT` (default 3000) instead of a
   hardcoded 3000, so the app can run on a laptop beside a frontend dev server; and, under
   `#[cfg(feature = "ghostwriter")]`, add `.route("/public_key", get(nautilus_server::app::public_key))`
   for the local registration path. (`/health_check` already returns `pk` too.)
3. `src/nautilus-server/src/lib.rs` → add the `ghostwriter` module and re-export, mirroring
   `weather-example`:
   ```rust
   #[cfg(feature = "ghostwriter")]
   #[path = "ghostwriter/mod.rs"]
   pub mod ghostwriter;
   // and in `pub mod app`:
   #[cfg(feature = "ghostwriter")]
   pub use crate::apps::ghostwriter::*;
   ```

Verify with `cargo test --no-default-features --features ghostwriter` (add `-- --ignored` for the
live Mainnet checks).
