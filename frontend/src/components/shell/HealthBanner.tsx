'use client';
import { Ban, Info, TriangleExclamationPoint } from 'lucide-react';
import { useConfig, useHealth } from '@/hooks/queries';

/** Set on a frontend-only deploy to link the recorded run from the offline notice. */
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;

/** Shown above the page only when something is wrong (doc §4.3). */
export function HealthBanner() {
  const health = useHealth();
  const { data: cfg } = useConfig();

  // No backend: say so calmly, once, and stop. Naming the unreachable URL helped while
  // developing and reads as a crash to anyone else — and on a cold-starting host this is
  // the first thing a visitor sees for the ~50 s before the service wakes up.
  if (health.isError) {
    return (
      <div role="status" className="banner banner--info">
        <Info size={16} />
        <span>
          Live data is offline, so quotes, policies and memory are not loading. The interface is
          real; the full run is in the demo.
          {DEMO_VIDEO_URL && (
            <>
              {' '}
              <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">Watch it</a>.
            </>
          )}
        </span>
      </div>
    );
  }

  const rows: Array<{ key: string; Icon: typeof Ban; text: string; warn?: boolean }> = [];
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
