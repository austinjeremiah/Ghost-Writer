// The Pool is read on nearly every quote and health check; cache it briefly so Tatum's rate limit is
// spent on things that change.
import { readPool, type PoolState } from './objects.js';

let cached: { at: number; value: PoolState } | null = null;

export async function pool(maxAgeMs = 15_000): Promise<PoolState> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
  const value = await readPool();
  cached = { at: Date.now(), value };
  return value;
}

export const invalidatePool = () => { cached = null; };
