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
  if (cfg && !cfg.pool) rows.push({ key: 'pool', Icon: TriangleExclamationPoint, text: "Can't read the pool on Sui right now. Buying and payouts are paused until chain data is back.", warn: true });
  if (cfg?.pool?.paused) rows.push({ key: 'paused', Icon: Ban, text: 'New cover is paused.', warn: true });
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
