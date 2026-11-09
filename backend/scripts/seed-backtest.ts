// Seeds the underwriter's memory with back-tested base rates, one case per bucket, on Sui MAINNET.
//
// Method: walk real daily candles from Tatum. At each day, take that day's close as spot, place the
// barrier at the bucket's distance below it, and ask whether the LOW of any day in the horizon
// pierced it. Using intraday lows (not closes) makes these true barrier touches, so the rate is a
// fair base rate rather than an undercount.
//
// Usage: pnpm seed [--days 400] [--dry] [--force]
import { ENABLED_ASSETS, C, type Asset } from '../src/config.js';
import { fetchCandles, annualizedVol, type Candle } from '../src/pricing/vol.js';
import { volBucket, moneyBucketMid, durBucketDays, type MoneyBucket, type DurBucket } from '../src/pricing/buckets.js';
import { caseText, type CaseRec } from '../src/memory/cases.js';
import { underwriter, listAll } from '../src/memory/client.js';
import { sleep } from '../src/util/sleep.js';

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const DAYS = arg('days', 400);
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const MIN_SAMPLES = 20;
const VOL_WINDOW = 30;

type Tally = { n: number; hits: number };
const key = (a: Asset, v: string, m: string, d: string) => `${a}|${v}|${m}|${d}`;

function backtest(asset: Asset, candles: Candle[]): Map<string, Tally> {
  const tally = new Map<string, Tally>();
  const closes = candles.map((c) => c.close);

  for (let i = VOL_WINDOW; i < candles.length - 1; i++) {
    // Vol as it would have been known that day — no look-ahead.
    const vol = annualizedVol(closes.slice(i - VOL_WINDOW, i + 1));
    if (!(vol > 0)) continue;
    const vb = volBucket(vol);
    const spot = candles[i].close;

    for (const [mb, mid] of Object.entries(moneyBucketMid) as Array<[MoneyBucket, number]>) {
      const trigger = spot * (1 - mid);
      for (const [dbk, days] of Object.entries(durBucketDays) as Array<[DurBucket, number]>) {
        const end = i + days;
        if (end >= candles.length) continue;
        let touched = false;
        for (let j = i + 1; j <= end; j++) {
          if (candles[j].low <= trigger) { touched = true; break; }
        }
        const k = key(asset, vb, mb, dbk);
        const t = tally.get(k) ?? { n: 0, hits: 0 };
        t.n += 1;
        if (touched) t.hits += 1;
        tally.set(k, t);
      }
    }
  }
  return tally;
}

// ---- run ----
if (!FORCE && !DRY) {
  const already = await listAll(underwriter, C.NS.cases);
  if (already.length > 0) {
    console.log(`${C.NS.cases} already holds ${already.length} memories. Re-run with --force to seed again, or --dry to preview.`);
    process.exit(0);
  }
}

const records: CaseRec[] = [];
for (const asset of ENABLED_ASSETS) {
  process.stdout.write(`fetching ${DAYS} daily candles for ${asset} (cached days are free)… `);
  const candles = await fetchCandles(asset, DAYS);
  console.log(`${candles.length} candles ${new Date(candles[0].t).toISOString().slice(0, 10)} → ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)}`);

  for (const [k, t] of backtest(asset, candles)) {
    if (t.n < MIN_SAMPLES) continue;
    const [, vb, mb, dbk] = k.split('|');
    records.push({
      v: 1, asset, volBucket: vb as CaseRec['volBucket'], moneyBucket: mb as MoneyBucket, durBucket: dbk as DurBucket,
      outcome: 'backtest', source: 'backtest', n: t.n, hits: t.hits,
      note: `${DAYS}d daily candles, intraday lows`, at: Date.now(),
    });
  }
}

records.sort((a, b) => a.moneyBucket.localeCompare(b.moneyBucket) || a.durBucket.localeCompare(b.durBucket));
console.log(`\n${records.length} buckets with ≥ ${MIN_SAMPLES} samples:`);
for (const r of records) {
  const rate = ((r.hits! / r.n!) * 100).toFixed(1);
  console.log(`  ${r.asset} ${r.volBucket.padEnd(4)} vol  ${r.moneyBucket.padEnd(6)} below  ${r.durBucket.padEnd(6)}  ${String(r.hits).padStart(3)}/${String(r.n).padEnd(4)} = ${rate.padStart(5)}% touched`);
}
if (DRY) { console.log('\n--dry: nothing written.'); process.exit(0); }

console.log(`\nwriting to Walrus Memory on Mainnet (namespace ${C.NS.cases}); each write takes ~20-30 s…`);
let written = 0;
for (const r of records) {
  try {
    const res = await underwriter.rememberAndWait(caseText(r), C.NS.cases);
    written++;
    console.log(`✔ ${String(written).padStart(2)}/${records.length}  ${r.asset} ${r.volBucket} ${r.moneyBucket} ${r.durBucket}  blob ${res.blob_id}`);
  } catch (e) {
    console.log(`✘ ${r.asset} ${r.volBucket} ${r.moneyBucket} ${r.durBucket}: ${(e as Error).message}`);
  }
  await sleep(C.MEMWAL_WRITE_GAP_MS);
}
console.log(`\n${written}/${records.length} cases on Mainnet. Indexed now: ${(await listAll(underwriter, C.NS.cases)).length}`);
