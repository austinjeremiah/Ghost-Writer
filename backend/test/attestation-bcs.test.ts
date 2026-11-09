// Cross-language lock on the bytes the enclave signs.
//
// Three implementations must agree byte-for-byte or liquidation settlement fails on-chain with
// abort 16 (EBadAttestation), which is almost impossible to diagnose from the chain alone:
//
//   Rust  enclave/mod.rs            LiquidationAttestation  (what the TEE signs)
//   Move  ghostwriter.move          LiquidationAttestation  (what the contract rebuilds)
//   here  the same layout in BCS    (the referee)
//
// The expected value below is the literal output of the Rust test
// `attestation_bcs_layout_is_stable` in enclave/mod.rs. If you change either struct, both tests
// fail together and you know before you deploy, not after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';

const IntentMessage = bcs.struct('IntentMessage', {
  intent: bcs.u8(),
  timestamp_ms: bcs.u64(),
  payload: bcs.struct('LiquidationAttestation', {
    obligation_id: bcs.Address,
    tx_digest: bcs.vector(bcs.u8()),
    repay_amount: bcs.u64(),
    withdraw_amount: bcs.u64(),
  }),
});

const LIQUIDATION_INTENT = 1;
const FROM_RUST =
  '01f8f434bfa1010000'
  + 'abababababababababababababababababababababababababababababababab'
  + '2b377667454266664b6a6877786f357748704e57434563373347463650786d6a334b6637476a6657794e5533'
  + '87d6120000000000'
  + 'b1cb740000000000';

test('the intent message we sign matches the Rust enclave byte for byte', () => {
  const digest = '7vgEBffKjhwxo5wHpNWCEc73GF6Pxmj3Kf7GjfWyNU3';
  const bytes = IntentMessage.serialize({
    intent: LIQUIDATION_INTENT,
    timestamp_ms: 1_794_209_281_272n,
    payload: {
      obligation_id: '0x' + 'ab'.repeat(32),
      tx_digest: Array.from(Buffer.from(digest, 'utf8')),
      repay_amount: 1_234_567n,
      withdraw_amount: 7_654_321n,
    },
  }).toBytes();

  assert.equal(Buffer.from(bytes).toString('hex'), FROM_RUST);
});

test('the layout is what the Move struct declares, field by field', () => {
  const digest = '7vgEBffKjhwxo5wHpNWCEc73GF6Pxmj3Kf7GjfWyNU3';
  const b = Buffer.from(FROM_RUST, 'hex');

  assert.equal(b[0], LIQUIDATION_INTENT, 'intent u8 comes first and is 1');
  assert.equal(b.readBigUInt64LE(1), 1_794_209_281_272n, 'timestamp_ms is u64 little-endian');
  // Move `address` and Rust `[u8; 32]` are both 32 raw bytes — no length prefix, unlike a vector.
  assert.equal(b.subarray(9, 41).toString('hex'), 'ab'.repeat(32), 'obligation_id is 32 raw bytes');
  assert.equal(b[41], digest.length, 'tx_digest is a vector: ULEB length prefix first');
  assert.equal(b.subarray(42, 42 + digest.length).toString('utf8'), digest, 'digest stored as UTF-8 text');
  assert.equal(b.readBigUInt64LE(85), 1_234_567n, 'repay_amount');
  assert.equal(b.readBigUInt64LE(93), 7_654_321n, 'withdraw_amount');
  assert.equal(b.length, 101, 'nothing trailing');
});
