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

const TATUM_SUI_MAINNET_RPC: &str = "https://sui-mainnet.gateway.tatum.io";
// Field names confirmed from Suilend's lending_market docs; `pnpm peek:suilend <digest>` shows a live example.
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

/// Sui JSON-RPC returns u64 as a string; accept a number too in case that changes.
fn as_u64(v: &Value) -> Option<u64> {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64())
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

    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "sui_getTransactionBlock",
        "params": [digest, { "showEvents": true, "showEffects": true }]
    });
    let resp = reqwest::Client::new()
        .post(TATUM_SUI_MAINNET_RPC)
        .header("x-api-key", &state.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| err(format!("rpc request failed: {e}")))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| err(format!("rpc response not json: {e}")))?;

    let result = &v["result"];
    if result.is_null() {
        return Err(err(format!("transaction not found: {}", v["error"])));
    }
    if result["effects"]["status"]["status"].as_str() != Some("success") {
        return Err(err("transaction did not succeed"));
    }
    // timestampMs only exists once the transaction is in a checkpoint, i.e. final. The contract
    // checks this signed timestamp against the cover window, so it must come from the chain.
    let ts = as_u64(&result["timestampMs"]).ok_or_else(|| err("transaction not checkpointed yet"))?;

    let events = result["events"].as_array().ok_or_else(|| err("no events"))?;
    for ev in events {
        let ty = ev["type"].as_str().unwrap_or("");
        if !ty.starts_with(LIQUIDATE_EVENT_PREFIX) {
            continue;
        }
        let pj = &ev["parsedJson"];
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
