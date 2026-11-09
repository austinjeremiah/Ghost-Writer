// Volatility and historical candles from Tatum's Data API.
//
// Tatum's OHLCV endpoint returns ONE record per call (the one closest to `unix`), so days are
// fetched individually and cached forever: a past day never changes. `low` is kept as well as
// `close`, because a barrier is touched intraday — back-testing on closes alone undercounts hits.
import { env, type Asset } from '../config.js';
import { AppError } from '../errors.js';
import { db } from '../db.js';
import { sleep } from '../util/sleep.js';
import { TokenBucket } from '../util/ratelimit.js';

export type Candle = { t: number; open: number; high: number; low: number; close: number };
const DAY = 86_400_000;

db.exec(`CREATE TABLE IF NOT EXISTS ohlcv_daily (
  asset TEXT NOT NULL, day_ms INTEGER NOT NULL,
  open REAL NOT NULL DEFAULT 0, high REAL NOT NULL DEFAULT 0, low REAL NOT NULL DEFAULT 0,
  close REAL NOT NULL, PRIMARY KEY (asset, day_ms))`);

// The Data API is a separate service from the gRPC gateways, so it gets its own bucket.
const bucket = new TokenBucket(env.TATUM_RPS);

const num = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
};

/** Accepts a bare record, `{ data: {…} }`, or a one-item array. */
function pickRecord(body: unknown): Record<string, unknown> | null {
  let b: unknown = body;
  if (b && typeof b === 'object' && !Array.isArray(b) && 'data' in b) b = (b as { data: unknown }).data;
  if (Array.isArray(b)) b = b[0];
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
}

const ZERO: Omit<Candle, 't'> = { open: 0, high: 0, low: 0, close: 0 };

async function fetchDay(asset: Asset, dayMs: number): Promise<Omit<Candle, 't'>> {
  const q = env.TATUM_OHLCV_QUERY.replace('{symbol}', asset).replace('{unix}', String(dayMs));
  for (let attempt = 0; attempt < 4; attempt++) {
    await bucket.take();
    const res = await fetch(`${env.TATUM_API_BASE}/v4/data/rate/symbol/OHLCV?${q}`, {
      headers: { 'x-api-key': env.TATUM_API_KEY_MAINNET },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) { await sleep(1000 * 2 ** attempt); continue; }
    if (res.status === 404) return ZERO;
    if (!res.ok) throw new AppError('UPSTREAM_TATUM', `tatum OHLCV HTTP ${res.status}`);
    const r = pickRecord(await res.json());
    if (!r) return ZERO;
    // "Closest record" can be far off for a day Tatum has no data for; reject anything > 2 days away.
    let t = num(r, ['openTime', 'timestamp', 'time', 't', 'unix', 'timeOpen']);
    if (t === null && typeof r.date === 'string') t = Date.parse(r.date);
    if (t !== null && Math.abs((t < 1e12 ? t * 1000 : t) - dayMs) > 2 * DAY) return ZERO;
    const close = num(r, ['close', 'c', 'Close', 'closePrice']) ?? 0;
    if (close <= 0) return ZERO;
    return {
      open: num(r, ['open', 'o']) ?? close,
      high: num(r, ['high', 'h']) ?? close,
      low: num(r, ['low', 'l']) ?? close,
      close,
    };
  }
  throw new AppError('RATE_LIMITED', 'tatum OHLCV: rate limited after retries');
}

/** Daily candles for the last `days` complete days, oldest first. One Tatum call per uncached day. */
export async function fetchCandles(asset: Asset, days: number): Promise<Candle[]> {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const want = Array.from({ length: days }, (_, i) => today - (days - i) * DAY);
  const rows = db.prepare('SELECT day_ms, open, high, low, close FROM ohlcv_daily WHERE asset = ? AND day_ms >= ?')
    .all(asset, want[0]) as Array<{ day_ms: number; open: number; high: number; low: number; close: number }>;
  const have = new Map(rows.map((r) => [r.day_ms, r]));
  const ins = db.prepare('INSERT OR REPLACE INTO ohlcv_daily(asset, day_ms, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?)');

  for (const d of want) {
    if (have.has(d)) continue;
    const c = await fetchDay(asset, d);
    ins.run(asset, d, c.open, c.high, c.low, c.close);
    have.set(d, { day_ms: d, ...c });
  }

  const candles = want
    .map((d) => have.get(d))
    .filter((r): r is { day_ms: number; open: number; high: number; low: number; close: number } => !!r && r.close > 0)
    .map((r) => ({ t: r.day_ms, open: r.open, high: r.high, low: r.low, close: r.close }));

  if (candles.length < Math.min(10, days)) {
    throw new AppError('UPSTREAM_TATUM', `tatum OHLCV: only ${candles.length} usable daily candles for ${asset}`);
  }
  return candles;
}

export function annualizedVol(closes: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 2) return 0;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const varr = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varr) * Math.sqrt(365);
}

const volCache = new Map<Asset, { at: number; value: number }>();

/** Annualised vol from the last 30 daily returns. Cached 10 minutes: it moves slowly. */
export async function annualVol(asset: Asset): Promise<number> {
  const hit = volCache.get(asset);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const c = await fetchCandles(asset, 45);
  const value = annualizedVol(c.slice(-31).map((x) => x.close));
  volCache.set(asset, { at: Date.now(), value });
  return value;
}
