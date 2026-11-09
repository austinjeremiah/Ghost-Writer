import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { pool } from '../chain/poolCache.js';
import { allRules } from '../memory/rules.js';

export async function underwriterRoutes(app: FastifyInstance) {
  /** The underwriter's book: capital, exposure, loss ratio, and every rule it has learned. */
  app.get('/v1/underwriter/book', async () => {
    const p = await pool();
    const counts = db.prepare(
      `SELECT SUM(status IN ('active','breach')) AS live, SUM(status = 'paid') AS paid, SUM(status = 'expired') AS expired, COUNT(*) AS total FROM policies`,
    ).get() as { live: number | null; paid: number | null; expired: number | null; total: number };

    const history = db.prepare(
      `SELECT id, created_at, dto FROM quotes ORDER BY created_at DESC LIMIT 50`,
    ).all() as Array<{ id: string; created_at: number; dto: string }>;

    return {
      vault: p.vault.toString(),
      locked: p.locked.toString(),
      free: p.free.toString(),
      premiumsCollected: p.premiumsCollected.toString(),
      payoutsMade: p.payoutsMade.toString(),
      lossRatio: p.premiumsCollected > 0n ? Number(p.payoutsMade) / Number(p.premiumsCollected) : 0,
      paused: p.paused,
      policies: { active: counts.live ?? 0, paid: counts.paid ?? 0, expired: counts.expired ?? 0, total: counts.total },
      activePolicies: counts.live ?? 0,
      rules: allRules().map((r) => ({
        ruleId: r.ruleId, asset: r.asset, volBucket: r.volBucket, moneyBucket: r.moneyBucket,
        multiplier: r.multiplier, status: r.status, lesson: r.lesson,
        payouts: r.payouts, quietExpiries: r.quietExpiries, blobId: r.blobId, updatedAt: r.updatedAt,
      })),
      multiplierHistory: history
        .map((q) => {
          const d = JSON.parse(q.dto) as { pricing?: { multiplier?: number } };
          return { at: q.created_at, quoteId: q.id, multiplier: d.pricing?.multiplier ?? 1 };
        })
        .reverse(),
    };
  });
}
