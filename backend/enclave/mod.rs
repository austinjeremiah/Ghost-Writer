// Ghostwriter: attests that a Suilend LiquidateEvent for a given obligation exists in a successful
// Sui MAINNET transaction, and signs that attestation inside an AWS Nitro enclave.
//
// Copy to: nautilus/src/nautilus-server/src/apps/ghostwriter/mod.rs
// (then register `ghostwriter` everywhere the template registers `weather-example`:
//  Cargo feature, module declaration, and the Makefile / ENCLAVE_APP switch.)
//
// The enclave is the only component our Move contract trusts for liquidation facts. It does the
// reading itself — the backend never gets to say "this was a liquidation" — and the contract verifies
// the signature against an enclave key registered only via a Nitro attestation with matching PCRs.
//
// Data source: Sui's public GraphQL endpoint. Two things ruled out JSON-RPC, which this app used
// first: public fullnodes now answer `sui_getTransactionBlock` with "JSON-RPC on public fullnodes
// has been deprecated", and Tatum's Sui gateway serves gRPC only — its HTTPS host returns 404 for
// every JSON-RPC method. GraphQL needs no API key, which also means the enclave holds no secret.
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

const SUI_GRAPHQL: &str = "https://graphql.mainnet.sui.io/graphql";
/// `transaction` (not `transactionBlock`) is the query root on the current schema.
const TX_QUERY: &str = "query($d:String!){transaction(digest:$d){digest effects{status timestamp events{nodes{contents{type{repr} json}}}}}}";

// Verified against live Mainnet data; `pnpm peek:suilend <digest>` prints a real example.
const LIQUIDATE_EVENT_PREFIX: &str =
    "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LiquidateEvent";
const F_OBLIGATION: &str = "obligation_id";
const F_REPAY: &str = "repay_amount";
const F_WITHDRAW: &str = "withdraw_amount";

/// Field order and types must match `LiquidationAttestation` in ghostwriter.move — BCS is order
/// sensitive, so reordering these fields silently breaks on-chain verification (abort 16).
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

/// Sui returns u64 as a string; accept a number too in case that changes.
fn as_u64(v: &Value) -> Option<u64> {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64())
}

fn num(s: &str, r: std::ops::Range<usize>) -> Option<i64> {
    s.get(r)?.parse().ok()
}

/// Epoch milliseconds from an RFC 3339 timestamp such as `2026-11-08T21:58:04.189Z`, which is how
/// GraphQL reports the checkpoint time. The contract checks this signed timestamp against the cover
/// window, so the conversion is part of the trusted path — hence the unit tests below rather than a
/// date-time dependency inside the enclave image.
fn rfc3339_to_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d) = (num(s, 0..4)?, num(s, 5..7)?, num(s, 8..10)?);
    let (h, mi, sec) = (num(s, 11..13)?, num(s, 14..16)?, num(s, 17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // Fractional seconds are optional, and may carry more or fewer than three digits.
    let ms = match b.get(19) {
        Some(b'.') => {
            let mut f: String = s
                .get(20..)?
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .take(3)
                .collect();
            if f.is_empty() {
                return None;
            }
            while f.len() < 3 {
                f.push('0');
            }
            f.parse::<i64>().ok()?
        }
        _ => 0,
    };
    // Days from civil date (Howard Hinnant's algorithm), shifted to the Unix epoch.
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = (if y2 >= 0 { y2 } else { y2 - 399 }) / 400;
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = (days * 86_400 + h * 3_600 + mi * 60 + sec) * 1_000 + ms;
    if total < 0 {
        None
    } else {
        Some(total as u64)
    }
}

/// The enclave's signing public key, in hex.
///
/// On the real path this is never needed: the key is carried inside the Nitro attestation document,
/// and `enclave::register_enclave` reads it from there. This endpoint exists for the local demo
/// path, where there is no attestation document and the operator registers the key under the `Cap`
/// with `enclave::register_enclave_by_cap`. Publishing a public key discloses nothing.
pub async fn public_key(State(state): State<Arc<AppState>>) -> Json<Value> {
    use fastcrypto::traits::{KeyPair, ToFromBytes};
    Json(json!({ "publicKey": Hex::encode(state.eph_kp.public().as_bytes()) }))
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

    let body = json!({ "query": TX_QUERY, "variables": { "d": digest } });
    let resp = reqwest::Client::new()
        .post(SUI_GRAPHQL)
        .json(&body)
        .send()
        .await
        .map_err(|e| err(format!("graphql request failed: {e}")))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| err(format!("graphql response not json: {e}")))?;

    if !v["errors"].is_null() {
        return Err(err(format!("graphql errors: {}", v["errors"])));
    }
    let tx = &v["data"]["transaction"];
    if tx.is_null() {
        return Err(err("transaction not found"));
    }
    let effects = &tx["effects"];
    if effects["status"].as_str() != Some("SUCCESS") {
        return Err(err("transaction did not succeed"));
    }
    // A timestamp exists only once the transaction is in a checkpoint, i.e. final.
    let ts = effects["timestamp"]
        .as_str()
        .and_then(rfc3339_to_ms)
        .ok_or_else(|| err("transaction not checkpointed yet"))?;

    let events = effects["events"]["nodes"]
        .as_array()
        .ok_or_else(|| err("no events"))?;
    // A single liquidation transaction can carry several LiquidateEvents, one per reserve. The
    // contract pays the policy's fixed payout and records the digest as evidence, so the amounts are
    // informational and attesting the first event for this obligation is enough.
    for ev in events {
        let contents = &ev["contents"];
        let ty = contents["type"]["repr"].as_str().unwrap_or("");
        if !ty.starts_with(LIQUIDATE_EVENT_PREFIX) {
            continue;
        }
        let pj = &contents["json"];
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
                // The Move struct holds the UTF-8 bytes of the base58 digest, so the evidence in the
                // PolicyPaid event is readable as a digest.
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

#[cfg(test)]
mod test {
    use super::*;
    use crate::common::IntentMessage;
    use fastcrypto::encoding::{Encoding, Hex};

    /// Locks the exact bytes the enclave signs. The Move contract rebuilds this same message from the
    /// policy's own fields and verifies the signature over it, so any drift here surfaces on-chain
    /// only as abort 16 (EBadAttestation). Cross-checked against the TypeScript BCS encoder.
    #[test]
    fn attestation_bcs_layout_is_stable() {
        let att = LiquidationAttestation {
            obligation_id: [0xab; 32],
            tx_digest: b"7vgEBffKjhwxo5wHpNWCEc73GF6Pxmj3Kf7GjfWyNU3".to_vec(),
            repay_amount: 1_234_567,
            withdraw_amount: 7_654_321,
        };
        let msg = IntentMessage::new(att, 1_794_209_281_272u64, IntentScope::Liquidation as u8);
        let bytes = bcs::to_bytes(&msg).expect("serialises");
        println!("INTENT_MESSAGE_BCS={}", Hex::encode(&bytes));

        // intent(u8) || timestamp_ms(u64 LE) || obligation_id(32 raw) || digest(uleb len + bytes)
        //   || repay(u64 LE) || withdraw(u64 LE)
        assert_eq!(bytes[0], 1, "intent must be LIQUIDATION_INTENT = 1");
        assert_eq!(&bytes[1..9], &1_794_209_281_272u64.to_le_bytes(), "timestamp is u64 LE");
        assert_eq!(&bytes[9..41], &[0xab; 32], "obligation_id is 32 raw bytes, no length prefix");
        assert_eq!(bytes[41], 43, "digest length prefix (43 ASCII chars)");
        assert_eq!(bytes.len(), 1 + 8 + 32 + 1 + 43 + 8 + 8);
    }

    /// The signed timestamp decides whether a liquidation falls inside the cover window, so an
    /// off-by-anything here pays the wrong claims or rejects good ones.
    #[test]
    fn rfc3339_parses_to_epoch_millis() {
        // Live value from Mainnet digest HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV.
        assert_eq!(rfc3339_to_ms("2026-11-08T21:58:04.189Z"), Some(1_794_175_084_189));
        assert_eq!(rfc3339_to_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(rfc3339_to_ms("2026-11-08T21:58:04Z"), Some(1_794_175_084_000));
        // Leap day, and fractional digits that need padding rather than truncating.
        assert_eq!(rfc3339_to_ms("2000-02-29T12:00:00.5Z"), Some(951_825_600_500));
        // More than three fractional digits: truncate, never round.
        assert_eq!(rfc3339_to_ms("2026-11-08T21:58:04.189999Z"), Some(1_794_175_084_189));
    }

    // ---------- live Mainnet checks ----------
    //
    // These call Sui's public GraphQL endpoint for real, so they are #[ignore]d and run on demand:
    //
    //     cargo test --no-default-features --features ghostwriter -- --ignored --nocapture
    //
    // They are the free stand-in for the enclave exit checks in docs/P7_ENCLAVE_RUNBOOK.md: the only
    // thing they cannot prove is that the signing key came from Nitro hardware. Everything else —
    // the query, the event matching, the amounts, the timestamp and the signature — is the real
    // code path running against a real liquidation.
    //
    // Fixture: Mainnet transaction HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV liquidated Suilend
    // obligation 0xcc69…22e4 on 8 Nov 2026. Found with the `events` query in the runbook.
    const LIVE_DIGEST: &str = "HUKqRVpJNuhmzx7SsAPuHgb3Lq5kt2tT1FnR7mSEv3DV";
    const LIVE_OBLIGATION: &str = "0xcc698926b57d5b971bf1f05133909151f08f182d90b77ef280bbb1acb69422e4";
    /// A different obligation, liquidated in a different transaction.
    const OTHER_OBLIGATION: &str = "0x1040b150d07a3ccb920d01af5e315364844b9709f2ecea00e18a9bdbc507efdd";

    fn state() -> (Arc<AppState>, fastcrypto::ed25519::Ed25519PublicKey) {
        use fastcrypto::traits::KeyPair;
        let eph_kp = fastcrypto::ed25519::Ed25519KeyPair::generate(&mut rand::thread_rng());
        let pk = eph_kp.public().clone();
        (
            Arc::new(AppState {
                eph_kp,
                // GraphQL needs no credentials; the field exists for apps that do.
                api_key: String::new(),
            }),
            pk,
        )
    }

    fn request(digest: &str, obligation: &str) -> Json<ProcessDataRequest<LiquidationRequest>> {
        Json(ProcessDataRequest {
            payload: LiquidationRequest {
                tx_digest: digest.to_string(),
                obligation_id: obligation.to_string(),
            },
        })
    }

    #[tokio::test]
    #[ignore = "hits Sui Mainnet over the network"]
    async fn signs_a_real_mainnet_liquidation() {
        use fastcrypto::traits::{ToFromBytes, VerifyingKey};
        let (st, pk) = state();
        let Json(out) = process_data(State(st), request(LIVE_DIGEST, LIVE_OBLIGATION))
            .await
            .expect("the enclave should attest a liquidation that really happened");

        let att = &out.response.data;
        assert_eq!(att.obligation_id, parse_addr(LIVE_OBLIGATION).unwrap());
        assert_eq!(att.tx_digest, LIVE_DIGEST.as_bytes().to_vec());
        assert_eq!(out.response.intent, IntentScope::Liquidation as u8);
        // 8 Nov 2026 21:58:04.189Z, read from the chain rather than from our clock.
        assert_eq!(out.response.timestamp_ms, 1_794_175_084_189);
        assert!(att.withdraw_amount > 0, "a liquidation withdraws collateral");

        // The signature must verify over exactly the bytes the Move contract rebuilds.
        let signed = bcs::to_bytes(&out.response).expect("serialises");
        let sig = fastcrypto::ed25519::Ed25519Signature::from_bytes(
            &Hex::decode(&out.signature).expect("signature is hex"),
        )
        .expect("signature parses");
        pk.verify(&signed, &sig).expect("signature verifies over the intent message");

        println!("attested {} bytes, repay={} withdraw={}", signed.len(), att.repay_amount, att.withdraw_amount);
    }

    /// The security property, and the one the demo shows: asked to attest something that did not
    /// happen, the enclave refuses rather than signing. The backend cannot talk it round, because
    /// the enclave reads the chain itself.
    #[tokio::test]
    #[ignore = "hits Sui Mainnet over the network"]
    async fn refuses_an_obligation_that_transaction_did_not_liquidate() {
        let (st, _) = state();
        // `expect_err` would need Debug on the success type, which the template does not derive.
        let e = match process_data(State(st), request(LIVE_DIGEST, OTHER_OBLIGATION)).await {
            Ok(_) => panic!("the enclave signed an attestation for an obligation it never liquidated"),
            Err(e) => e,
        };
        let msg = format!("{e:?}");
        assert!(msg.contains("no LiquidateEvent"), "unexpected error: {msg}");
        println!("refused as expected: {msg}");
    }

    #[tokio::test]
    #[ignore = "hits Sui Mainnet over the network"]
    async fn refuses_a_digest_that_does_not_exist() {
        let (st, _) = state();
        let e = match process_data(
            State(st),
            request("11111111111111111111111111111111111111111111", LIVE_OBLIGATION),
        )
        .await
        {
            Ok(_) => panic!("the enclave signed an attestation for a transaction that does not exist"),
            Err(e) => e,
        };
        println!("refused as expected: {e:?}");
    }

    #[test]
    fn rfc3339_rejects_malformed_input() {
        for s in ["", "not-a-date", "2026-11-08", "2026/11/08T21:58:04Z", "2026-13-08T21:58:04Z", "2026-11-08T25:58:04Z"] {
            assert_eq!(rfc3339_to_ms(s), None, "should reject {s:?}");
        }
    }
}
