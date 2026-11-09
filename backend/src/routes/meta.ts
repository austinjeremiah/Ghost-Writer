import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, C, ENABLED_ASSETS, FEED_BY_ASSET } from '../config.js';
import { workerState } from '../state.js';
import { AppError } from '../errors.js';
import { pool } from '../chain/poolCache.js';
import { latestSpots } from '../chain/pyth.js';
import { annualVol } from '../pricing/vol.js';
import { volBucket } from '../pricing/buckets.js';
import { quotePubHex } from '../pricing/quote.js';
import { recordPubHex } from '../memory/records.js';
import { borrowerDelegatePubHex, underwriter, listAll, recall, restoreNamespace } from '../memory/client.js';
import { writeStats, recentWrites, lastBlobIds } from '../memory/queue.js';
import { setPaused } from '../chain/ghostwriterTx.js';
import { invalidatePool } from '../chain/poolCache.js';

const started = Date.now();

function requireAdmin(req: { headers: Record<string, unknown> }): void {
  const given = req.headers['x-admin-token'];
  if (typeof given !== 'string' || given !== env.ADMIN_TOKEN) {
    throw new AppError('UNAUTHORIZED', 'admin token required');
  }
}

export async function metaRoutes(app: FastifyInstance) {
  app.get('/v1/health', async () => ({
    ok: true, version: '1.0.0', uptimeS: Math.round((Date.now() - started) / 1000), workers: workerState,
  }));

  /** Everything the frontend needs, all public. */
  app.get('/v1/config', async () => {
    const p = await pool().catch(() => null);
    return {
      network: { policies: 'testnet', memory: 'mainnet' },
      packageId: env.GHOSTWRITER_PACKAGE_ID,
      poolId: env.GHOSTWRITER_POOL_ID,
      coinType: env.COIN_TYPE,
      coinDecimals: env.COIN_DECIMALS,
      coinFaucetId: env.GUSD_FAUCET_ID,
      clockId: '0x6',
      enabledAssets: ENABLED_ASSETS,
      feeds: Object.fromEntries(ENABLED_ASSETS.map((a) => [a, FEED_BY_ASSET[a]])),
      pool: p
        ? {
            confirmDelayMs: p.confirmDelayMs, maxConfBps: p.maxConfBps, maxPriceAgeS: p.maxPriceAgeS,
            quotePubkeyHex: p.quotePubkeyHex, quotePubkeyMatches: p.quotePubkeyHex === quotePubHex,
            paused: p.paused, vault: p.vault.toString(), free: p.free.toString(),
          }
        : null,
      memwal: {
        packageId: env.MEMWAL_PACKAGE_ID,
        registryId: env.MEMWAL_REGISTRY_ID,
        serverUrl: env.MEMWAL_SERVER_URL,
        borrowerDelegatePublicKeyHex: borrowerDelegatePubHex,
        borrowerDelegateLabel: 'Ghostwriter underwriter',
        underwriterAccountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
        historyNamespace: C.NS.history,
      },
      recordPubkeyHex: recordPubHex,
      enclave: { objectId: env.ENCLAVE_OBJECT_ID, configId: env.ENCLAVE_CONFIG_OBJECT_ID, url: env.ENCLAVE_URL },
      limits: {
        payoutMin: C.PAYOUT_MIN.toString(), payoutMax: C.PAYOUT_MAX.toString(),
        durationDaysMin: 1, durationDaysMax: 30, quoteTtlMs: C.QUOTE_TTL_MS, minPremium: C.MIN_PREMIUM.toString(),
      },
      explorers: {
        // SuiVision rather than Suiscan: Suiscan's Testnet indexer lags by many minutes and renders
        // a just-settled transaction as "Unknown", which makes a live settlement look like it did
        // not happen. SuiVision showed the same digests within seconds.
        testnetObject: 'https://testnet.suivision.xyz/object/',
        testnetTx: 'https://testnet.suivision.xyz/txblock/',
        mainnetObject: 'https://suivision.xyz/object/',
        mainnetTx: 'https://suivision.xyz/txblock/',
        walrusBlob: 'https://walruscan.com/mainnet/blob/',
      },
    };
  });

  /** Spot (on-chain Pyth) and volatility (Tatum daily candles) per enabled asset. */
  app.get('/v1/market', async () => {
    const feeds = ENABLED_ASSETS.map((a) => FEED_BY_ASSET[a]);
    const spots = await latestSpots(feeds);
    const assets = [];
    for (const asset of ENABLED_ASSETS) {
      const s = spots.get(FEED_BY_ASSET[asset]);
      if (!s) continue;
      const volAnnual = await annualVol(asset);
      assets.push({
        asset, feedId: s.feedId, priceObjectId: s.priceObjectId,
        spotUsd: s.spotUsd, publishMs: s.publishMs,
        ageS: Math.round((Date.now() - s.publishMs) / 1000),
        volAnnual: Number(volAnnual.toFixed(4)), volBucket: volBucket(volAnnual),
      });
    }
    return { assets, maxPriceAgeS: env.MAX_PRICE_AGE_S };
  });

  /** Submission proof: the Mainnet memory account, its agent id, and how many memories exist. */
  app.get('/v1/proof', async () => {
    const perNamespace: Record<string, number> = {};
    let mainnetMemories = 0;
    try {
      for (const m of await listAll(underwriter)) {
        perNamespace[m.namespace] = (perNamespace[m.namespace] ?? 0) + 1;
        mainnetMemories++;
      }
    } catch {
      /* relayer down: report what we know locally instead of failing the page */
    }
    return {
      memwalAgentId: await underwriter.getPublicKeyHex().catch(() => null),
      underwriterAccountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
      memoryNetwork: 'mainnet',
      mainnetMemories,
      perNamespace,
      lastBlobIds: lastBlobIds(5),
      writes: writeStats(),
      packageId: env.GHOSTWRITER_PACKAGE_ID,
      poolId: env.GHOSTWRITER_POOL_ID,
      enclaveObjectId: env.ENCLAVE_OBJECT_ID,
      recordPubkeyHex: recordPubHex,
      quotePubkeyHex: quotePubHex,
    };
  });

  app.get('/v1/memory/writes', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return { ...writeStats(), items: recentWrites(limit) };
  });

  /** What the underwriter remembers in one namespace: indexed count plus recalled text. */
  app.get('/v1/underwriter/memory', async (req) => {
    const { namespace, limit } = z.object({
      namespace: z.enum(['cases', 'rules', 'quotes', 'policies', 'decisions']).default('cases'),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    const ns = C.NS[namespace];
    const [indexed, hits] = await Promise.all([
      listAll(underwriter, ns).catch(() => []),
      recall(underwriter, ns, namespace === 'rules' ? 'underwriting rule'
        : namespace === 'decisions' ? 'underwriting decision verdict'
        : `ghostwriter ${namespace}`, limit, 'recent').catch(() => []),
    ]);
    const byBlob = new Map(hits.map((h) => [h.blobId, h.text]));
    return {
      namespace: ns,
      indexedCount: indexed.length,
      items: indexed.slice(0, limit).map((m) => ({
        blobId: m.blobId, createdAt: m.createdAt, endEpoch: m.endEpoch, expiresAt: m.expiresAt,
        text: byBlob.get(m.blobId) ?? null,
      })),
    };
  });

  // ---- admin ----
  app.post('/v1/admin/pause', async (req) => {
    requireAdmin(req as never);
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    const r = await setPaused(paused);
    invalidatePool();
    return { digest: r.digest, paused };
  });

  app.post('/v1/admin/restore', async (req) => {
    requireAdmin(req as never);
    const { namespace } = z.object({ namespace: z.string().min(3) }).parse(req.body);
    return restoreNamespace(underwriter, namespace);
  });
}
