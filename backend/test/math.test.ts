// Pure pricing maths — runs without .env or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, firstPassageProb, clamp } from '../src/pricing/math.js';
import { volBucket, moneyBucket, durBucket, moneyBucketMid } from '../src/pricing/buckets.js';

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-4);
  assert.ok(normCdf(-8) >= 0 && normCdf(8) <= 1);
});

test('firstPassageProb stays a probability and refuses nonsense', () => {
  for (const [S, B, s, T] of [[1, 0.9, 0.7, 0.02], [100, 10, 2, 1], [0.8, 0.79, 1.5, 0.003]] as const) {
    const p = firstPassageProb(S, B, s, T);
    assert.ok(p >= 0 && p <= 1, `${p} out of range`);
  }
  assert.equal(firstPassageProb(1, 1, 0.5, 1), 1, 'barrier at spot is certain');
  assert.equal(firstPassageProb(1, 1.5, 0.5, 1), 1, 'barrier above spot is certain');
  assert.equal(firstPassageProb(1, 0.5, 0, 1), 0, 'zero vol cannot reach the barrier');
  assert.equal(firstPassageProb(1, 0.5, 0.5, 0), 0, 'zero time cannot reach the barrier');
});

test('firstPassageProb is monotone in the ways that matter', () => {
  const p = (B: number, s: number, T: number) => firstPassageProb(1, B, s, T);
  assert.ok(p(0.95, 0.7, 0.02) > p(0.80, 0.7, 0.02), 'a nearer barrier is likelier');
  assert.ok(p(0.9, 1.2, 0.02) > p(0.9, 0.4, 0.02), 'more volatility is likelier');
  assert.ok(p(0.9, 0.7, 0.08) > p(0.9, 0.7, 0.01), 'more time is likelier');
});

test('a 7-day 8% barrier at 73% vol prices in a sane range', () => {
  // Sanity anchor against the live SUI numbers the backend quotes on.
  const p = firstPassageProb(0.81, 0.75, 0.728, 7 / 365);
  assert.ok(p > 0.2 && p < 0.7, `got ${p}`);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('buckets split where the config says', () => {
  assert.equal(volBucket(0.49), 'low');
  assert.equal(volBucket(0.5), 'mid');
  assert.equal(volBucket(0.89), 'mid');
  assert.equal(volBucket(0.9), 'high');

  assert.equal(moneyBucket(1, 0.98), '0-5');
  assert.equal(moneyBucket(1, 0.95), '5-10');
  assert.equal(moneyBucket(1, 0.9), '10-15');
  assert.equal(moneyBucket(1, 0.85), '15-25');
  assert.equal(moneyBucket(1, 0.7), '25+');

  assert.equal(durBucket(1), '1-3d');
  assert.equal(durBucket(3), '1-3d');
  assert.equal(durBucket(7), '4-7d');
  assert.equal(durBucket(30), '8-30d');
});

test('each bucket midpoint lands back in its own bucket', () => {
  // The seeder prices a bucket at its midpoint, so the two must agree or cases key wrongly.
  for (const [name, mid] of Object.entries(moneyBucketMid)) {
    assert.equal(moneyBucket(1, 1 - mid), name, `midpoint ${mid} should be ${name}`);
  }
});
