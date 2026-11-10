'use client';
import { Ban, TriangleExclamationPoint, Unplug } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { useConfig, useHealth } from '@/hooks/queries';

/** Shown above the page only when something is wrong (doc §4.3). */
export function HealthBanner() {
  const health = useHealth();
  const { data: cfg } = useConfig();

  const rows: Array<{ key: string; Icon: typeof Ban; text: string; warn?: boolean }> = [];
  if (health.isError) rows.push({ key: 'down', Icon: Unplug, text: `Ghostwriter backend is not reachable at ${API_URL}.` });
  // /v1/config returns pool: null when the chain read fails (Tatum rate limit, usually), so the
  // optional chain has to continue past cfg or a transient upstream error blanks the whole app.
  if (cfg?.pool?.paused) rows.push({ key: 'paused', Icon: Ban, text: 'New cover is paused.', warn: true });
  if (cfg && !cfg.pool) {
    rows.push({ key: 'pool', Icon: TriangleExclamationPoint, text: 'Pool state is unavailable right now; figures may be stale.', warn: true });
  }
  if (health.data?.workers.priceWatcher === 'stopped') {
    rows.push({ key: 'price', Icon: TriangleExclamationPoint, text: 'Price watching is stopped. Payouts are delayed.', warn: true });
  }
  if (!rows.length) return null;

  return (
    <div role="alert">
      {rows.map(({ key, Icon, text, warn }) => (
        <div key={key} className={`banner${warn ? ' banner--warn' : ''}`}><Icon size={16} /> {text}</div>
      ))}
    </div>
  );
}
