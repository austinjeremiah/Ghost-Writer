import { EventEmitter } from 'node:events';
import { db } from './db.js';

export type BusEvent = { id: number; type: string; payload: unknown; at: number };
export const bus = new EventEmitter();
bus.setMaxListeners(1000);

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export function emit(type: string, payload: unknown): void {
  const at = Date.now();
  const info = db.prepare('INSERT INTO events(type, payload, created_at) VALUES (?, ?, ?)').run(type, toJson(payload), at);
  const ev: BusEvent = { id: Number(info.lastInsertRowid), type, payload, at };
  bus.emit('event', ev);
}

/** Non-persisted, high-frequency events (ticks). */
export function emitTransient(type: string, payload: unknown): void {
  bus.emit('event', { id: 0, type, payload, at: Date.now() } satisfies BusEvent);
}

export function eventsAfter(lastId: number, limit = 200): BusEvent[] {
  const rows = db.prepare('SELECT id, type, payload, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT ?').all(lastId, limit) as
    Array<{ id: number; type: string; payload: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), at: r.created_at }));
}
