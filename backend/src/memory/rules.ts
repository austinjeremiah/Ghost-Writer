// Rules: the underwriter's own learned adjustments, one per (asset, vol, distance) bucket.
//
// Walrus is canonical. SQLite is a cache for fast quoting; on a fresh machine the rules are rebuilt
// from memory, which is what makes "the underwriter remembers" true rather than decorative.
import { db } from '../db.js';
import { C, env, type Asset } from '../config.js';
import { enqueueMemory, onMemoryWritten } from './queue.js';
import { underwriter, recall } from './client.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export type RuleStatus = 'trial' | 'active' | 'retired';
export type Rule = {
  ruleId: string; asset: Asset; volBucket: string; moneyBucket: string; multiplier: number;
  status: RuleStatus; lesson: string; payouts: number; quietExpiries: number;
  blobId: string | null; updatedAt: number;
};
type Row = {
  rule_id: string; asset: string; vol_bucket: string; money_bucket: string; multiplier: number;
  status: string; lesson: string; payouts: number; quiet_expiries: number; blob_id: string | null; updated_at: number;
};

const toRule = (r: Row): Rule => ({
  ruleId: r.rule_id, asset: r.asset as Asset, volBucket: r.vol_bucket, moneyBucket: r.money_bucket,
  multiplier: r.multiplier, status: r.status as RuleStatus, lesson: r.lesson, payouts: r.payouts,
  quietExpiries: r.quiet_expiries, blobId: r.blob_id, updatedAt: r.updated_at,
});

export const ruleId = (asset: string, vol: string, money: string) => `${asset}:${vol}:${money}`;

export const allRules = (): Rule[] =>
  (db.prepare('SELECT * FROM rules ORDER BY updated_at DESC').all() as Row[]).map(toRule);

export function matchRule(asset: string, vol: string, money: string): Rule | null {
  const r = db.prepare(`SELECT * FROM rules WHERE rule_id = ? AND status != 'retired'`).get(ruleId(asset, vol, money)) as Row | undefined;
  return r ? toRule(r) : null;
}

/** blobId is per-copy, so it is not part of the remembered text. */
function ruleText(r: Rule): string {
  const { blobId: _blobId, ...pub } = r;
  return `underwriting rule asset=${r.asset} vol=${r.volBucket} distance=${r.moneyBucket}% ${C.PREFIX.rule}${JSON.stringify(pub)}`;
}

export function saveRule(r: Rule): void {
  db.prepare(
    `INSERT INTO rules(rule_id, asset, vol_bucket, money_bucket, multiplier, status, lesson, payouts, quiet_expiries, blob_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(rule_id) DO UPDATE SET multiplier = excluded.multiplier, status = excluded.status,
       lesson = excluded.lesson, payouts = excluded.payouts, quiet_expiries = excluded.quiet_expiries,
       updated_at = excluded.updated_at`,
  ).run(r.ruleId, r.asset, r.volBucket, r.moneyBucket, r.multiplier, r.status, r.lesson, r.payouts, r.quietExpiries, r.updatedAt);
  enqueueMemory({
    account: 'underwriter', accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, namespace: C.NS.rules,
    text: ruleText(r), purpose: `rule:${r.ruleId}`, ref: r.ruleId,
  });
  emit('rule.updated', { ruleId: r.ruleId, multiplier: r.multiplier, status: r.status });
}

onMemoryWritten('rule:', (row) => {
  if (row.ref) db.prepare('UPDATE rules SET blob_id = ? WHERE rule_id = ?').run(row.blob_id, row.ref);
});

/** Memory is canonical: on a fresh database, rebuild the rule cache from Walrus. */
export async function rebuildRulesFromMemory(): Promise<number> {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n;
  if (n > 0) return n;
  try {
    // 'recent' so the newest version of each rule wins; rules are written append-only.
    const hits = await recall(underwriter, C.NS.rules, 'underwriting rule', 100, 'recent');
    const latest = new Map<string, Rule>();
    for (const h of hits) {
      const i = h.text.indexOf(C.PREFIX.rule);
      if (i < 0) continue;
      let r: Rule;
      try {
        r = JSON.parse(h.text.slice(i + C.PREFIX.rule.length)) as Rule;
      } catch {
        continue;
      }
      const cur = latest.get(r.ruleId);
      if (!cur || r.updatedAt > cur.updatedAt) latest.set(r.ruleId, { ...r, blobId: h.blobId });
    }
    for (const r of latest.values()) {
      db.prepare(
        `INSERT OR REPLACE INTO rules(rule_id, asset, vol_bucket, money_bucket, multiplier, status, lesson, payouts, quiet_expiries, blob_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(r.ruleId, r.asset, r.volBucket, r.moneyBucket, r.multiplier, r.status, r.lesson, r.payouts, r.quietExpiries, r.blobId, r.updatedAt);
    }
    if (latest.size > 0) log.info('rules rebuilt from Walrus Memory', { count: latest.size });
    return latest.size;
  } catch (e) {
    log.warn('rules rebuild from memory failed', { message: (e as Error).message });
    return 0;
  }
}
