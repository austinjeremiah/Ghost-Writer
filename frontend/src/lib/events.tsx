// lib/events.tsx
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from './api';
import { EVENT_TYPES, type EventMap, type EventType, type Market } from './types';
import { qk } from '@/hooks/queries';

export type AnyEvent = { [K in EventType]: { id: string; type: K; data: EventMap[K]; receivedAt: number } }[EventType];
type Listener = (e: AnyEvent) => void;
type Ctx = { status: 'connecting' | 'live' | 'reconnecting'; recent: AnyEvent[]; lastCheckpoint: EventMap['chain.checkpoint'] | null; subscribe: (l: Listener) => () => void };

const EventsCtx = createContext<Ctx | null>(null);
const MAX = 200;

export function EventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [status, setStatus] = useState<Ctx['status']>('connecting');
  const [recent, setRecent] = useState<AnyEvent[]>([]);
  const [lastCheckpoint, setLastCheckpoint] = useState<Ctx['lastCheckpoint']>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/v1/events`);
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus('reconnecting'); // EventSource retries by itself

    const onAny = (type: EventType) => (msg: MessageEvent<string>) => {
      let data: unknown;
      try { data = JSON.parse(msg.data); } catch { return; }
      const ev = { id: msg.lastEventId, type, data, receivedAt: Date.now() } as AnyEvent;
      applyToCache(qc, ev);
      if (ev.type === 'chain.checkpoint') setLastCheckpoint(ev.data);
      else setRecent((r) => [ev, ...r].slice(0, MAX));
      listeners.current.forEach((l) => l(ev));
    };
    const handlers = EVENT_TYPES.map((t) => [t, onAny(t)] as const);
    handlers.forEach(([t, h]) => es.addEventListener(t, h as EventListener));
    return () => { handlers.forEach(([t, h]) => es.removeEventListener(t, h as EventListener)); es.close(); };
  }, [qc]);

  const subscribe = (l: Listener) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; };
  return <EventsCtx.Provider value={{ status, recent, lastCheckpoint, subscribe }}>{children}</EventsCtx.Provider>;
}

export function useEvents() {
  const c = useContext(EventsCtx);
  if (!c) throw new Error('useEvents must be inside EventsProvider');
  return c;
}

/** Run `fn` for each new event of the given types (e.g. toasts, local chart buffers). */
export function useOnEvent<T extends EventType>(types: T[], fn: (e: Extract<AnyEvent, { type: T }>) => void) {
  const { subscribe } = useEvents();
  const ref = useRef(fn); ref.current = fn;
  const key = types.join(',');
  useEffect(() => subscribe((e) => { if ((types as EventType[]).includes(e.type)) ref.current(e as Extract<AnyEvent, { type: T }>); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribe, key]);
}

/** §7 of this doc, as code. */
function applyToCache(qc: ReturnType<typeof useQueryClient>, ev: AnyEvent) {
  switch (ev.type) {
    case 'price.tick':
      qc.setQueryData<Market>(qk.market, (m) => m && {
        assets: m.assets.map((a) => {
          const p = ev.data.prices.find((x) => x.asset === a.asset);
          return p ? { ...a, spotUsd: p.spotUsd, publishMs: p.publishMs } : a;
        }),
      });
      break;
    case 'policy.bought':
      qc.setQueryData(qk.policy(ev.data.policyId), ev.data);
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'breach.reported': case 'breach.reset': case 'policy.paid': case 'policy.expired':
    case 'hedge.placed': case 'hedge.filled': case 'hedge.failed':
      qc.invalidateQueries({ queryKey: qk.policy(ev.data.policyId) });
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      if (ev.type === 'policy.paid' || ev.type === 'policy.expired') qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'x402.settled':
      qc.invalidateQueries({ queryKey: qk.policiesRoot });
      qc.invalidateQueries({ queryKey: qk.book });
      break;
    case 'rule.updated':
      qc.invalidateQueries({ queryKey: qk.book });
      qc.invalidateQueries({ queryKey: qk.uwMemory('rules') });
      break;
    case 'memory.queued': case 'memory.written': case 'memory.failed':
      qc.invalidateQueries({ queryKey: qk.memoryWrites });
      qc.invalidateQueries({ queryKey: qk.proof });
      if (ev.data.account === 'underwriter') qc.invalidateQueries({ queryKey: qk.uwMemoryRoot });
      else { qc.invalidateQueries({ queryKey: qk.history(ev.data.account) }); qc.invalidateQueries({ queryKey: qk.borrower(ev.data.account) }); }
      break;
    case 'ledger.anchored':
      qc.invalidateQueries({ queryKey: qk.history(ev.data.borrower) });
      qc.invalidateQueries({ queryKey: qk.borrower(ev.data.borrower) });
      break;
    default: break; // quote.issued, warning.issued, liquidation.seen: read from `recent` / useOnEvent
  }
}
