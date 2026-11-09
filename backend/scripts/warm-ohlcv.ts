// Pre-fills the daily candle cache so the first quote does not wait on Tatum.
// Past days never change, so later runs only fetch days that are new.
// Usage: pnpm warm:ohlcv [days]
import { ENABLED_ASSETS } from '../src/config.js';
import { fetchCandles, annualizedVol } from '../src/pricing/vol.js';

const days = Number(process.argv[2] ?? '400');
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

for (const asset of ENABLED_ASSETS) {
  const t0 = Date.now();
  const c = await fetchCandles(asset, days);
  const vol = annualizedVol(c.slice(-31).map((x) => x.close));
  console.log(
    `✔ ${asset}: ${c.length} candles ${day(c[0].t)} → ${day(c[c.length - 1].t)}`
    + `  last close $${c[c.length - 1].close}  30d vol ${(vol * 100).toFixed(1)}%`
    + `  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
}
