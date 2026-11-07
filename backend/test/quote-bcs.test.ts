// The backend's quote encoding must be byte-identical to what the Move contract verifies.
// Expected bytes and signature come from `sui move test print_quote_bytes` and the SIG_Q1 constant in
// backend/move/ghostwriter/tests/ghostwriter_tests.move (test key seed = 0x01 * 32).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DOTENV_CONFIG_QUIET = 'true';
const { quoteMessageBytes, signQuote } = await import('../src/chain/quoteMessage.js');

const MOVE_BYTES =
  '1467686f73747772697465722e71756f74652e7631a4137e2ed945e7f4e8c307001c32e97472fb3eebb8f7b4ab7534b447d22da89b' +
  '000000000000000000000000000000000000000000000000000000000000000b002023d7315113f5b1d3ba7a83604c44b94d79f4fd69' +
  'af77f804fc7f920a6dc65744804120050000000000000000000000000000000000000000000000000000000000000000000000008096' +
  '980000000000a068060000000000e80300000000000040420f00000000000271318813000000000000';
const MOVE_SIG_Q1 =
  '6f65002f5c1454d7e5f8fa197d275fa5c91c79ed4c7fc2c0144b2c462b478fec41bfe7e9c7ff1537adabb4a9fdb15cadf86622319e9889a1df448ebc4af11406';

const terms = {
  poolId: '0xa4137e2ed945e7f4e8c307001c32e97472fb3eebb8f7b4ab7534b447d22da89b',
  buyer: '0xb',
  kind: 0 as const,
  feedIdHex: '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  strikeE8: 86_000_000n,
  obligationId: '0x0',
  payout: 10_000_000n,
  premium: 420_000n,
  startMs: 1_000,
  endMs: 1_000_000,
  quoteIdHex: Buffer.from('q1').toString('hex'),
  expiresMs: 5_000,
};

test('quote message bytes match the Move contract', () => {
  assert.equal(Buffer.from(quoteMessageBytes(terms)).toString('hex'), MOVE_BYTES);
});

test('quote signature matches the one the Move tests accept', () => {
  assert.equal(signQuote(terms, '01'.repeat(32)), MOVE_SIG_Q1);
});
