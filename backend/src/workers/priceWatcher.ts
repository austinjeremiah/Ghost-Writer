// Price trigger, expiry, near-miss tagging and warnings.
//
// A payout needs the breach to persist: report_breach records it, confirm_breach pays only after the
// pool's confirm delay with the price still below the strike, and reset_breach clears it if the price
// recovers. Both legs are real Testnet transactions against the on-chain Pyth price, so a momentary
// wick cannot trigger a payout.
import { env, C, ASSET_BY_FEED, ENABLED_ASSETS, FEED_BY_ASSET } from '../config.js';
import { latestSpots } from '../chain/pyth.js';
import { pool, invalidatePool } from '../chain/poolCache.js';
import { reportBreach, resetBreach, confirmBreach, expirePolicy } from '../chain/ghostwriterTx.js';
import { activePolicies, setPolicyStatus, getPolicyRow, type PolicyRow } from '../policies/sync.js';
import { appendRecord, anchorPending, getBorrower } from '../memory/records.js';
import { db } from '../db.js';
import { emit, emitTransient } from '../bus.js';
import { workerState } from '../state.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';

const e8 = (usd: number) => BigInt(Math.round(usd * 1e8));
/** Aborts that just mean "the chain moved between our read and our write"; the next tick retries. */
const HARMLESS = new Set([9, 12, 13, 14, 15, 19]);

function abortCode(e: unknown): number | null {
  if (e instanceof AppError && e.code === 'CHAIN_ABORT') {
    const a = e.details.abort as { code?: number } | null | undefined;
    return a?.code ?? null;
  }
  return null;
}

async function handle(row: PolicyRow, spotE8: bigint, confirmDelayMs: number): Promise<void> {
  const strikeE8 = BigInt(row.strike_e8);
  const now = Date.now();
  const expired = now > row.end_ms + confirmDelayMs;

  // Warn before the trigger, not after: a borrower who reacts earns a discount on the next quote.
  if (!row.warned_at && spotE8 <= (strikeE8 * BigInt(Math.round(C.WARNING_BAND * 1000))) / 1000n) {
    db.prepare('UPDATE policies SET warned_at = ? WHERE id = ?').run(now, row.id);
    if (getBorrower(row.holder)) {
      appendRecord(row.holder, 'warning', {
        policyId: row.id, asset: row.asset, spotE8: spotE8.toString(), strikeE8: row.strike_e8,
      }, []);
      void anchorPending(row.holder);
    }
    emit('warning.issued', {
      policyId: row.id, borrower: row.holder,
      spotUsd: Number(spotE8) / 1e8, strikeUsd: Number(strikeE8) / 1e8,
    });
  }

  // Near miss: never paid, but close enough that the bucket should price higher next time.
  if (!row.near_miss && spotE8 <= (strikeE8 * BigInt(Math.round(C.NEAR_MISS_BAND * 1000))) / 1000n) {
    db.prepare('UPDATE policies SET near_miss = 1 WHERE id = ?').run(row.id);
  }

  if (row.kind === 1) {
    // Liquidation cover settles through the enclave (P7); here it can only expire.
    if (expired) {
      const r = await expirePolicy(row.id);
      setPolicyStatus(row.id, 'expired');
      emit('policy.expired', { policyId: row.id, digest: r.digest });
    }
    return;
  }

  if (row.status === 'breach') {
    if (spotE8 > strikeE8) {
      const r = await resetBreach(row.id, row.feed_id);
      setPolicyStatus(row.id, 'active', { breachStartedMs: 0 });
      emit('breach.reset', { policyId: row.id, priceE8: spotE8.toString(), digest: r.digest });
      return;
    }
    const ready = now >= row.breach_started_ms + confirmDelayMs;
    // The contract also refuses to confirm after end + confirmDelay, so expiry wins past that point.
    if (ready && !expired) {
      const r = await confirmBreach(row.id, row.feed_id);
      setPolicyStatus(row.id, 'paid', { settleDigest: r.digest, settlePath: 'price' });
      invalidatePool();
      emit('policy.paid', {
        policyId: row.id, holder: row.holder, payout: row.payout, path: 'price', digest: r.digest,
      });
      log.info('policy paid on price trigger', { policyId: row.id, digest: r.digest });
      return;
    }
    if (expired) {
      const r = await expirePolicy(row.id);
      setPolicyStatus(row.id, 'expired');
      emit('policy.expired', { policyId: row.id, digest: r.digest });
    }
    return;
  }

  // active
  if (expired) {
    const r = await expirePolicy(row.id);
    setPolicyStatus(row.id, 'expired');
    emit('policy.expired', { policyId: row.id, digest: r.digest });
    return;
  }
  if (now >= row.start_ms && now <= row.end_ms && spotE8 <= strikeE8) {
    const r = await reportBreach(row.id, row.feed_id);
    const fresh = getPolicyRow(row.id);
    setPolicyStatus(row.id, 'breach', { breachStartedMs: fresh ? Date.now() : now });
    emit('breach.reported', { policyId: row.id, priceE8: spotE8.toString(), digest: r.digest });
    log.info('breach reported', { policyId: row.id, digest: r.digest });
  }
}

let ticking = false;

/** One pass: read prices once, then act on every live policy. */
export async function priceTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const spots = await latestSpots(ENABLED_ASSETS.map((a) => FEED_BY_ASSET[a]));
    emitTransient('price.tick', {
      prices: [...spots.values()].map((s) => ({
        asset: ASSET_BY_FEED[s.feedId] ?? 'SUI', spotUsd: s.spotUsd, publishMs: s.publishMs,
      })),
    });

    const rows = activePolicies();
    if (rows.length === 0) return;
    const { confirmDelayMs } = await pool();

    for (const row of rows) {
      const s = spots.get(row.feed_id);
      if (!s) continue;
      // Never send a settlement transaction on a price the contract would reject as stale.
      if ((Date.now() - s.publishMs) / 1000 > env.MAX_PRICE_AGE_S) continue;
      try {
        await handle(row, e8(s.spotUsd), confirmDelayMs);
      } catch (e) {
        const code = abortCode(e);
        if (code !== null && HARMLESS.has(code)) {
          log.info('policy action raced the chain; retrying next tick', { policyId: row.id, abort: code });
          continue;
        }
        log.error('price watcher policy failed', { policyId: row.id, message: (e as Error).message });
      }
    }
  } catch (e) {
    log.warn('price tick failed', { message: (e as Error).message });
  } finally {
    ticking = false;
  }
}

export function startPriceWatcher(): void {
  workerState.priceWatcher = 'running';
  void priceTick();
  setInterval(() => void priceTick(), env.PRICE_POLL_MS);
  log.info('price watcher started', { everyMs: env.PRICE_POLL_MS, assets: ENABLED_ASSETS });
}
