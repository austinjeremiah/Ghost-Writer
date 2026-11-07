// SQLite via Node's built-in `node:sqlite` (no native build step, unlike better-sqlite3 on Windows).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(env.DB_PATH)), { recursive: true });
export const db = new DatabaseSync(env.DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS borrowers (
  address TEXT PRIMARY KEY, memwal_account_id TEXT NOT NULL, ledger_id TEXT, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS ledger_records (
  borrower TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL, prev TEXT NOT NULL,
  text TEXT NOT NULL, write_id INTEGER, blob_id TEXT, anchor_digest TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (borrower, seq));

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, buyer TEXT NOT NULL, kind INTEGER NOT NULL, asset TEXT NOT NULL, feed_id TEXT NOT NULL,
  strike_e8 TEXT NOT NULL, obligation_id TEXT NOT NULL, payout TEXT NOT NULL, premium TEXT NOT NULL,
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, signature TEXT NOT NULL,
  dto TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL, holder TEXT NOT NULL, kind INTEGER NOT NULL,
  asset TEXT NOT NULL, feed_id TEXT NOT NULL, strike_e8 TEXT NOT NULL, obligation_id TEXT NOT NULL,
  payout TEXT NOT NULL, premium TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  status TEXT NOT NULL, breach_started_ms INTEGER NOT NULL DEFAULT 0, buy_digest TEXT, settle_digest TEXT,
  settle_path TEXT, near_miss INTEGER NOT NULL DEFAULT 0, warned_at INTEGER, responded INTEGER NOT NULL DEFAULT 0,
  hedge_status TEXT NOT NULL DEFAULT 'none', hedge_detail TEXT, learned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS memory_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, account_id TEXT NOT NULL, namespace TEXT NOT NULL,
  text TEXT NOT NULL, purpose TEXT NOT NULL, ref TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  blob_id TEXT, error TEXT, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS rules (
  rule_id TEXT PRIMARY KEY, asset TEXT NOT NULL, vol_bucket TEXT NOT NULL, money_bucket TEXT NOT NULL,
  multiplier REAL NOT NULL, status TEXT NOT NULL, lesson TEXT NOT NULL, payouts INTEGER NOT NULL DEFAULT 0,
  quiet_expiries INTEGER NOT NULL DEFAULT 0, blob_id TEXT, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS payments (
  digest TEXT PRIMARY KEY, quote_id TEXT NOT NULL, payer TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_holder ON policies(holder);
CREATE INDEX IF NOT EXISTS idx_mw_status ON memory_writes(status, next_at);
`);

export function kvGet(key: string): string | null {
  const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function kvSet(key: string, value: string): void {
  db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
