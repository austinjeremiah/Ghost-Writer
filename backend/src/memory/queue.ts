// Durable, paced write queue for Walrus Memory (Mainnet).
//
// Why a queue: the hosted relayer accepts roughly 24 writes/min per account and a write is a real
// Mainnet job, so nothing user-facing may block on one. Rows live in SQLite, survive restarts, and
// retry with backoff. Callers enqueue and move on; `onMemoryWritten` fires once a blob id exists.
import { db } from '../db.js';
import { C, env } from '../config.js';
import { emit } from '../bus.js';
import { log } from '../log.js';
import { workerState } from '../state.js';
import { sleep } from '../util/sleep.js';
import { underwriter, borrowerMem } from './client.js';

export type MemoryWriteStatus = 'queued' | 'writing' | 'done' | 'failed';
export type WriteRow = {
  id: number; account: string; account_id: string; namespace: string; text: string;
  purpose: string; ref: string | null; status: MemoryWriteStatus; attempts: number;
  blob_id: string | null; error: string | null; next_at: number; created_at: number; updated_at: number;
};

const MAX_ATTEMPTS = 6;
/** 'underwriter' writes use our delegate key; anything else is a borrower address. */
const clientFor = (row: Pick<WriteRow, 'account' | 'account_id'>) =>
  row.account === 'underwriter' ? underwriter : borrowerMem(row.account_id);

export type EnqueueArgs = {
  account: 'underwriter' | string;
  accountId: string;
  namespace: string;
  text: string;
  purpose: string;
  ref?: string;
};

export function enqueueMemory(a: EnqueueArgs): number {
  const now = Date.now();
  const info = db.prepare(
    `INSERT INTO memory_writes(account, account_id, namespace, text, purpose, ref, status, attempts, next_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
  ).run(a.account, a.accountId, a.namespace, a.text, a.purpose, a.ref ?? null, now, now, now);
  const id = Number(info.lastInsertRowid);
  emit('memory.queued', { id, account: a.account, namespace: a.namespace, purpose: a.purpose });
  kick();
  return id;
}

// ---- hooks: run when a write lands, matched by purpose prefix ("record:", "rule:", …) ----
type Hook = (row: WriteRow) => void | Promise<void>;
const hooks: Array<{ prefix: string; fn: Hook }> = [];
export function onMemoryWritten(prefix: string, fn: Hook): void {
  hooks.push({ prefix, fn });
}

async function runHooks(row: WriteRow): Promise<void> {
  for (const h of hooks) {
    if (!row.purpose.startsWith(h.prefix)) continue;
    try {
      await h.fn(row);
    } catch (e) {
      log.error('memory hook failed', { purpose: row.purpose, message: (e as Error).message });
    }
  }
}

// ---- worker ----
const lastWriteAt = new Map<string, number>();
let running = false;
let wake: (() => void) | null = null;

/** Wakes the loop immediately instead of waiting out the idle sleep. */
function kick(): void {
  wake?.();
}

function dueRow(): WriteRow | undefined {
  return db.prepare(
    `SELECT * FROM memory_writes WHERE status = 'queued' AND next_at <= ? ORDER BY id ASC LIMIT 1`,
  ).get(Date.now()) as WriteRow | undefined;
}

async function writeOne(row: WriteRow): Promise<void> {
  // One account at a time, MEMWAL_WRITE_GAP_MS apart: the relayer's cap is per account.
  const gap = C.MEMWAL_WRITE_GAP_MS - (Date.now() - (lastWriteAt.get(row.account) ?? 0));
  if (gap > 0) await sleep(gap);

  db.prepare(`UPDATE memory_writes SET status = 'writing', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(Date.now(), row.id);
  try {
    const res = await clientFor(row).rememberAndWait(row.text, row.namespace);
    lastWriteAt.set(row.account, Date.now());
    db.prepare(`UPDATE memory_writes SET status = 'done', blob_id = ?, error = NULL, updated_at = ? WHERE id = ?`)
      .run(res.blob_id, Date.now(), row.id);
    const done: WriteRow = { ...row, status: 'done', blob_id: res.blob_id };
    emit('memory.written', { id: row.id, account: row.account, namespace: row.namespace, purpose: row.purpose, blobId: res.blob_id });
    await runHooks(done);
  } catch (e) {
    lastWriteAt.set(row.account, Date.now());
    const message = e instanceof Error ? e.message : String(e);
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare(`UPDATE memory_writes SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(message, Date.now(), row.id);
      emit('memory.failed', { id: row.id, account: row.account, namespace: row.namespace, purpose: row.purpose, error: message });
      log.error('memory write failed permanently', { id: row.id, purpose: row.purpose, message });
      return;
    }
    // 401s right after a delegate key is added are expected (relayer caches for ~30 s): back off and retry.
    const delay = Math.min(60_000, 2000 * 2 ** row.attempts);
    db.prepare(`UPDATE memory_writes SET status = 'queued', error = ?, next_at = ?, updated_at = ? WHERE id = ?`)
      .run(message, Date.now() + delay, Date.now(), row.id);
    log.warn('memory write retrying', { id: row.id, purpose: row.purpose, attempt: attempts, inMs: delay, message });
  }
}

export function startMemoryQueue(): void {
  if (running) return;
  running = true;
  workerState.memoryQueue = 'running';
  // Anything left 'writing' by a crash is retried.
  db.prepare(`UPDATE memory_writes SET status = 'queued' WHERE status = 'writing'`).run();

  void (async () => {
    for (;;) {
      const row = dueRow();
      if (row) {
        await writeOne(row);
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 2000);
      });
      wake = null;
    }
  })();
  log.info('memory queue started', { gapMs: C.MEMWAL_WRITE_GAP_MS, account: env.MEMWAL_UNDERWRITER_ACCOUNT_ID.slice(0, 10) + '…' });
}

export function writeStats() {
  const r = db.prepare(
    `SELECT COUNT(*) AS total, SUM(status = 'done') AS done, SUM(status = 'failed') AS failed FROM memory_writes`,
  ).get() as { total: number; done: number | null; failed: number | null };
  return { total: r.total, done: r.done ?? 0, failed: r.failed ?? 0 };
}

export function recentWrites(limit = 50) {
  const rows = db.prepare(
    `SELECT id, account, namespace, purpose, status, blob_id, error, created_at FROM memory_writes ORDER BY id DESC LIMIT ?`,
  ).all(limit) as Array<Pick<WriteRow, 'id' | 'account' | 'namespace' | 'purpose' | 'status' | 'blob_id' | 'error' | 'created_at'>>;
  return rows.map((r) => ({
    id: r.id, account: r.account, namespace: r.namespace, purpose: r.purpose,
    status: r.status, blobId: r.blob_id, error: r.error, createdAt: r.created_at,
  }));
}

/** Blob ids of the most recent successful writes (used by /v1/proof). */
export function lastBlobIds(limit = 5): string[] {
  const rows = db.prepare(
    `SELECT blob_id FROM memory_writes WHERE status = 'done' AND blob_id IS NOT NULL ORDER BY id DESC LIMIT ?`,
  ).all(limit) as Array<{ blob_id: string }>;
  return rows.map((r) => r.blob_id);
}
