import { usd } from '@/lib/format';

export type PricePoint = { t: number; v: number };

/**
 * Live price vs trigger. Plain SVG: the line is the buffer filled from price.tick,
 * the shaded band under the trigger is the payout zone. No made-up history.
 */
export function PriceChart({ points, trigger }: { points: PricePoint[]; trigger: number }) {
  const W = 640, H = 220, PAD_L = 8, PAD_R = 8, PAD_T = 12, PAD_B = 12;
  const values = points.map((p) => p.v).concat(trigger);
  let lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || Math.max(hi * 0.02, 1e-6);
  lo -= span * 0.25; hi += span * 0.25;

  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const t0 = points[0]?.t ?? 0, t1 = points[points.length - 1]?.t ?? 1;
  const x = (t: number) => PAD_L + (t1 === t0 ? 1 : (t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const ty = y(trigger);
  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Live price against the trigger at ${usd(trigger)}`}>
      <rect x={0} y={ty} width={W} height={Math.max(0, H - ty)} fill="var(--cl-deny)" opacity={0.07} />
      <line x1={0} x2={W} y1={ty} y2={ty} stroke="var(--cl-deny)" strokeDasharray="6 5" strokeWidth={1.5} />
      <text x={W - PAD_R} y={ty - 6} textAnchor="end" fontSize={12} fill="var(--cl-deny)">Trigger {usd(trigger)}</text>
      <text x={W - PAD_R} y={Math.min(H - 4, ty + 16)} textAnchor="end" fontSize={11} fill="var(--cl-deny)" opacity={0.8}>payout zone</text>
      {points.length > 1 && <polyline points={line} fill="none" stroke="var(--cl-ink)" strokeWidth={2} strokeLinejoin="round" />}
      {points.length > 0 && (
        <circle cx={x(points[points.length - 1].t)} cy={y(points[points.length - 1].v)} r={4} fill="var(--cl-ink)" />
      )}
    </svg>
  );
}
