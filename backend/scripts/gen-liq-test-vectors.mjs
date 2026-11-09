import { ed25519 } from '@noble/curves/ed25519';
import { bcs } from '@mysten/sui/bcs';

const hex = (u8) => Buffer.from(u8).toString('hex');
const seed = (b) => new Uint8Array(32).fill(b);

// 1. The quote signature `buy` verifies, over the bytes printed by `print_quote_bytes`.
const QUOTE_SEED = seed(0x01);
const liqQuoteBytes = Buffer.from(
  '1467686f73747772697465722e71756f74652e7631a4137e2ed945e7f4e8c307001c32e97472fb3eebb8f7b4ab7534b447d22da89b000000000000000000000000000000000000000000000000000000000000000b012023d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc6574480412005000000000000000000000000000000000000000000000000000000000000000000c0ffee8096980000000000a068060000000000e80300000000000040420f0000000000036c69718813000000000000',
  'hex');
console.log('QUOTE_PK (expect 8a88e3dd…) =', hex(ed25519.getPublicKey(QUOTE_SEED)));
console.log('SIG_LIQ                     =', hex(ed25519.sign(liqQuoteBytes, QUOTE_SEED)));

// 2. The enclave signature `settle_liquidation` verifies. Same layout as the Rust enclave signs and
//    as backend/test/attestation-bcs.test.ts locks.
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

const ENCLAVE_SEED = seed(0x02);
const DIGEST = '7vgEBffKjhwxo5wHpNWCEc73GF6Pxmj3Kf7GjfWyNU3'; // 43 chars, as a real Sui digest is
const TS_MS = 500_000n;      // inside the policy window [1_000, 1_000_000]
const REPAY = 1_234_567n;
const WITHDRAW = 7_654_321n;
const OBLIGATION = '0x' + '00'.repeat(29) + 'c0ffee';

const msg = IntentMessage.serialize({
  intent: 1,
  timestamp_ms: TS_MS,
  payload: {
    obligation_id: OBLIGATION,
    tx_digest: Array.from(Buffer.from(DIGEST, 'utf8')),
    repay_amount: REPAY,
    withdraw_amount: WITHDRAW,
  },
}).toBytes();

console.log('\nintent message bytes        =', hex(msg), `(${msg.length} bytes)`);
console.log('ENCLAVE_PK                  =', hex(ed25519.getPublicKey(ENCLAVE_SEED)));
console.log('ENCLAVE_SIG                 =', hex(ed25519.sign(msg, ENCLAVE_SEED)));
console.log('DIGEST hex                  =', hex(Buffer.from(DIGEST, 'utf8')));
console.log('self-check verify           =', ed25519.verify(ed25519.sign(msg, ENCLAVE_SEED), msg, ed25519.getPublicKey(ENCLAVE_SEED)));
