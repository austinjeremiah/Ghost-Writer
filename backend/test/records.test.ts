// Borrower record tamper-evidence. Needs .env (it loads the real record signing key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, parseRecord, checkRecord, recordPubHex, scoreFrom, type Parsed } from '../src/memory/records.js';
import { C } from '../src/config.js';

const GENESIS = '0'.repeat(64);
const borrower = '0x' + 'ab'.repeat(32);

const body = (seq: number, prev: string, kind: Parsed['kind'] = 'onboarded') => ({
  v: 1 as const, borrower, seq, prev, kind, at: 1_700_000_000_000,
  data: { hello: 'world' }, evidence: ['digest1'],
});

test('a built record round-trips and verifies', () => {
  const b = body(1, GENESIS);
  const { hash, text } = buildRecord(b);
  assert.ok(text.startsWith(C.PREFIX.record), 'text carries the version prefix');

  const parsed = parseRecord(text);
  assert.ok(parsed, 'parses back');
  assert.equal(parsed.hash, hash);
  assert.equal(parsed.pub, recordPubHex);

  const { hashOk, sigOk } = checkRecord(parsed, recordPubHex);
  assert.ok(hashOk && sigOk, 'verifies against the trusted key');
});

test('hashing is deterministic and independent of key order', () => {
  const a = buildRecord({ ...body(1, GENESIS), data: { x: 1, y: 2 } });
  const b = buildRecord({ ...body(1, GENESIS), data: { y: 2, x: 1 } });
  assert.equal(a.hash, b.hash, 'canonical JSON sorts keys');
});

test('editing the data breaks the hash', () => {
  const { text } = buildRecord(body(1, GENESIS));
  const parsed = parseRecord(text)!;
  const forged = { ...parsed, data: { hello: 'tampered' } };
  const { hashOk } = checkRecord(forged, recordPubHex);
  assert.equal(hashOk, false, 'a borrower cannot rewrite their own history');
});

test('a record signed by another key is rejected', () => {
  const { text } = buildRecord(body(1, GENESIS));
  const parsed = parseRecord(text)!;
  const otherKey = 'ff'.repeat(32);
  const { sigOk } = checkRecord(parsed, otherKey);
  assert.equal(sigOk, false, 'only the underwriter key is trusted');
});

test('claiming our public key without our signature is rejected', () => {
  // The attack: keep our pub field, swap in a signature made by someone else.
  const { text } = buildRecord(body(1, GENESIS));
  const parsed = parseRecord(text)!;
  const forged = { ...parsed, sig: 'aa'.repeat(64) };
  const { sigOk } = checkRecord(forged, recordPubHex);
  assert.equal(sigOk, false);
});

test('the chain links and a dropped record is detectable', () => {
  const r1 = buildRecord(body(1, GENESIS));
  const r2 = buildRecord(body(2, r1.hash, 'policy_bought'));
  const r3 = buildRecord(body(3, r2.hash, 'payout'));

  const p2 = parseRecord(r2.text)!;
  const p3 = parseRecord(r3.text)!;
  assert.equal(p2.prev, r1.hash, 'each record names its predecessor');
  assert.notEqual(p3.prev, r1.hash, 'hiding record 2 breaks the link to 3');
});

test('malformed text parses to null instead of throwing', () => {
  assert.equal(parseRecord('not a ghostwriter record'), null);
  assert.equal(parseRecord(C.PREFIX.record + '{not json'), null);
});

test('scoreFrom rewards responding and never rewards unverifiable history', () => {
  const rec = (kind: Parsed['kind'], seq: number) => parseRecord(buildRecord(body(seq, GENESIS, kind)).text)!;

  const clean = scoreFrom([rec('onboarded', 1), rec('policy_bought', 2)], true);
  assert.ok(clean.discountFactor <= 1, 'a clean record is never a surcharge');

  const responded = scoreFrom([rec('warning', 1), rec('response', 2)], true);
  const ignored = scoreFrom([rec('warning', 1)], true);
  assert.ok(responded.discountFactor < ignored.discountFactor, 'reacting to a warning is cheaper than ignoring it');

  const paid = scoreFrom([rec('payout', 1)], true);
  assert.ok(paid.discountFactor > 1, 'a past payout costs more');

  const unverified = scoreFrom([rec('onboarded', 1), rec('policy_bought', 2)], false);
  assert.ok(unverified.discountFactor > 1, 'unverifiable history gets no discount');

  for (const s of [clean, responded, ignored, paid, unverified]) {
    assert.ok(s.discountFactor >= 0.75 && s.discountFactor <= 1.3, 'factor stays bounded');
  }
});
