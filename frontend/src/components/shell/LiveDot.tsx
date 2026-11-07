'use client';
import { useEffect, useState } from 'react';
import { useEvents } from '@/lib/events';
import { useHealth } from '@/hooks/queries';

export function LiveDot() {
  const { status, lastCheckpoint } = useEvents();
  const { data: health } = useHealth();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const live = status === 'live';
  const age = lastCheckpoint ? Math.max(0, Math.round((Date.now() - lastCheckpoint.at) / 1000)) : null;
  const polling = health?.workers.checkpointPulse === 'polling';
  const tip = lastCheckpoint
    ? `Testnet checkpoint #${lastCheckpoint.seq}, ${age}s ago${polling ? ' (polling)' : ''}`
    : live ? `Connected, waiting for the first checkpoint${polling ? ' (polling)' : ''}` : 'Connecting to the live event stream';

  return (
    <span className="pill" title={tip} aria-label={tip}>
      <span className={`dot ${live ? 'dot--live' : 'dot--warn'}`} />
      {live ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
    </span>
  );
}
