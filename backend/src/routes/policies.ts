import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { AppError } from '../errors.js';
import { confirmFromDigest, getPolicy, getPolicyRow, listPolicies, type PolicyStatus } from '../policies/sync.js';
import { settleFromLiquidation } from '../workers/liquidationWatcher.js';
import { enclaveHealth, enclaveReady } from '../enclave/client.js';

const ConfirmBody = z.object({ digest: z.string().min(32), quoteId: z.string().regex(/^[0-9a-f]{32}$/) });
const ClaimBody = z.object({ txDigest: z.string().min(32) });
const ListQuery = z.object({
  holder: z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a)).optional(),
  status: z.enum(['active', 'breach', 'paid', 'expired']).optional(),
});

export async function policyRoutes(app: FastifyInstance) {
  /** Called by the frontend (or the x402 settler) once the buy transaction has executed. */
  app.post('/v1/policies/confirm', async (req) => {
    const { digest, quoteId } = ConfirmBody.parse(req.body);
    return confirmFromDigest(digest, quoteId);
  });

  app.get('/v1/policies', async (req) => {
    const q = ListQuery.parse(req.query);
    return { policies: listPolicies({ holder: q.holder, status: q.status as PolicyStatus | undefined }) };
  });

  app.get('/v1/policies/:id', async (req) => {
    const { id } = req.params as { id: string };
    const p = getPolicy(id);
    if (!p) throw new AppError('NOT_FOUND', 'unknown policy');
    return p;
  });

  /**
   * Settle liquidation cover from a Mainnet transaction digest. The liquidation watcher does this by
   * itself; this route exists for the demo and as a manual retry. The enclave — not this server —
   * decides whether that transaction really liquidated the covered obligation.
   */
  app.post('/v1/policies/:id/claim-liquidation', async (req) => {
    const { id } = req.params as { id: string };
    const { txDigest } = ClaimBody.parse(req.body);

    const row = getPolicyRow(id);
    if (!row) throw new AppError('NOT_FOUND', 'unknown policy');
    if (row.kind !== 1) throw new AppError('CONFLICT', 'this policy is price cover, not liquidation cover');
    if (row.status !== 'active' && row.status !== 'breach') {
      throw new AppError('CONFLICT', `policy is ${row.status}`, { status: row.status });
    }
    if (!enclaveReady()) {
      throw new AppError('UPSTREAM_ENCLAVE', 'the attestation enclave is not configured on this server');
    }

    const settleDigest = await settleFromLiquidation(row, txDigest);
    return { status: 'paid' as const, settleDigest };
  });

  /** Enclave liveness, so the UI can show the TEE is actually up before a claim is attempted. */
  app.get('/v1/enclave/health', async () => {
    if (!enclaveReady()) return { configured: false };
    return { configured: true, health: await enclaveHealth() };
  });
}
