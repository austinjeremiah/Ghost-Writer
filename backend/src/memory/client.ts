// Walrus Memory clients (Sui Mainnet, hosted relayer).
//
// Two kinds of account:
//   underwriter  — our own account; holds cases, rules, quotes, policies.
//   borrower     — one per user, owned by the user's wallet. We write to it with a delegate
//                  key the borrower added (and can revoke) — the memory is theirs, not ours.
import { MemWal } from '@mysten-incubation/memwal';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';

export type { MemWal };

/** Public key of the delegate key borrowers add to their own account (safe to publish). */
export const borrowerDelegatePubHex = bytesToHex(
  ed25519.getPublicKey(hexToBytes(env.MEMWAL_BORROWER_DELEGATE_KEY.replace(/^0x/, ''))),
);

export const underwriter = MemWal.create({
  key: env.WALRUS_PRIVATE_KEY,
  accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID,
  serverUrl: env.MEMWAL_SERVER_URL,
});

const borrowerClients = new Map<string, MemWal>();

/** Client for one borrower's own account, signed with the delegate key they registered. */
export function borrowerMem(accountId: string): MemWal {
  const hit = borrowerClients.get(accountId);
  if (hit) return hit;
  const m = MemWal.create({
    key: env.MEMWAL_BORROWER_DELEGATE_KEY,
    accountId,
    serverUrl: env.MEMWAL_SERVER_URL,
  });
  borrowerClients.set(accountId, m);
  return m;
}

const relayerFail = (label: string, e: unknown) =>
  new AppError('UPSTREAM_MEMWAL', `${label}: ${e instanceof Error ? e.message : String(e)}`);

export type Hit = { blobId: string; text: string; distance: number; createdAt: string | null };

/**
 * Vector recall inside one namespace. `sort: 'recent'` over-fetches candidates server-side and
 * orders by write time — needed when the newest version of a record must win (rules).
 */
export async function recall(
  mem: MemWal,
  namespace: string,
  query: string,
  limit = 20,
  sort: 'relevance' | 'recent' = 'relevance',
): Promise<Hit[]> {
  try {
    const r = await mem.recall({ query, namespace, limit, sort });
    return r.results.map((h) => ({ blobId: h.blob_id, text: h.text, distance: h.distance, createdAt: h.created_at ?? null }));
  } catch (e) {
    throw relayerFail(`recall ${namespace}`, e);
  }
}

export type Indexed = {
  blobId: string; namespace: string; createdAt: string | null; endEpoch: number | null; expiresAt: string | null;
};

/**
 * Every memory the relayer has indexed for an account, following the cursor to the end.
 * `has_more` is authoritative — a namespace-filtered page can be empty while more pages remain.
 */
export async function listAll(mem: MemWal, namespace?: string, maxPages = 20): Promise<Indexed[]> {
  const out: Indexed[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < maxPages; page++) {
      const r = await mem.listMemories({ cursor, limit: 100, namespace });
      for (const m of r.memories) {
        out.push({
          blobId: m.blob_id, namespace: m.namespace_id, createdAt: m.created_at,
          endEpoch: m.end_epoch, expiresAt: m.expires_at,
        });
      }
      if (r.must_resync) { out.length = 0; cursor = undefined; continue; }
      if (!r.has_more) break;
      cursor = r.next_cursor ?? undefined;
      if (!cursor) break;
    }
  } catch (e) {
    throw relayerFail('listMemories', e);
  }
  return out;
}

/** Re-indexes a namespace from its on-chain blobs. Used when recall returns fewer than are indexed. */
export async function restoreNamespace(mem: MemWal, namespace: string, limit = 50) {
  try {
    const r = await mem.restore(namespace, limit);
    log.info('memwal restore', { namespace, restored: r.restored, skipped: r.skipped, failed: r.failed, total: r.total, truncated: r.truncated });
    return r;
  } catch (e) {
    throw relayerFail(`restore ${namespace}`, e);
  }
}
