import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { readMemWalAccount } from '../chain/memwalAccount.js';
import { createLedger } from '../chain/ghostwriterTx.js';
import { listObligations } from '../chain/suilend.js';
import { borrowerDelegatePubHex } from '../memory/client.js';
import { env } from '../config.js';
import {
  getBorrower, appendRecord, anchorPending, verifyHistory, scoreFrom, localScore,
  recordCount, anchoredSeq, type HistoryRecord,
} from '../memory/records.js';
import { log } from '../log.js';

const Addr = z.string().refine(isValidSuiAddress, 'invalid Sui address').transform((a) => normalizeSuiAddress(a));
const PutBody = z.object({ memwalAccountId: Addr });

export type BorrowerDTO = {
  address: string; memwalAccountId: string; ledgerId: string | null;
  records: number; anchoredSeq: number;
  score: { verified: boolean; warnings: number; responses: number; payouts: number; discountFactor: number };
};

function toDTO(address: string): BorrowerDTO {
  const b = getBorrower(address);
  if (!b) throw new AppError('NOT_FOUND', 'borrower not registered');
  const s = localScore(address);
  return {
    address, memwalAccountId: b.memwal_account_id, ledgerId: b.ledger_id,
    records: recordCount(address), anchoredSeq: anchoredSeq(address),
    score: { verified: s.verified, warnings: s.warnings, responses: s.responses, payouts: s.payouts, discountFactor: s.discountFactor },
  };
}

export async function borrowerRoutes(app: FastifyInstance) {
  /**
   * Registers a borrower after their own wallet created a MemWalAccount on Mainnet and added our
   * delegate key. We verify both against the chain — the request body is not trusted.
   */
  app.put('/v1/borrowers/:address', async (req) => {
    const address = Addr.parse((req.params as { address: string }).address);
    const { memwalAccountId } = PutBody.parse(req.body);

    const existing = getBorrower(address);
    if (existing && existing.memwal_account_id !== memwalAccountId) {
      throw new AppError('CONFLICT', 'this address is already registered with a different memory account', {
        reason: 'ALREADY_REGISTERED', memwalAccountId: existing.memwal_account_id,
      });
    }

    const acct = await readMemWalAccount(memwalAccountId);
    if (acct.owner !== address) {
      throw new AppError('CONFLICT', 'that memory account is owned by a different address', { reason: 'NOT_OWNER', owner: acct.owner });
    }
    if (!acct.active || acct.quarantined) {
      throw new AppError('CONFLICT', 'that memory account is not active', { reason: 'ACCOUNT_INACTIVE' });
    }
    if (!acct.delegatePubHexes.includes(borrowerDelegatePubHex)) {
      throw new AppError('CONFLICT', 'add the Ghostwriter delegate key to your memory account first', {
        reason: 'DELEGATE_NOT_REGISTERED', expectedPublicKeyHex: borrowerDelegatePubHex,
      });
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO borrowers(address, memwal_account_id, ledger_id, created_at) VALUES (?, ?, NULL, ?)
       ON CONFLICT(address) DO UPDATE SET memwal_account_id = excluded.memwal_account_id`,
    ).run(address, memwalAccountId, now);

    // One shared Ledger per borrower holds the anchored (seq, head) of their record chain.
    let row = getBorrower(address)!;
    if (!row.ledger_id) {
      const { ledgerId } = await createLedger(address, memwalAccountId);
      db.prepare('UPDATE borrowers SET ledger_id = ? WHERE address = ?').run(ledgerId, address);
      row = getBorrower(address)!;
    }

    if (recordCount(address) === 0) {
      appendRecord(address, 'onboarded', { memwalAccountId, ledgerId: row.ledger_id }, []);
      void anchorPending(address);
    }
    return toDTO(address);
  });

  app.get('/v1/borrowers/:address', async (req) => toDTO(Addr.parse((req.params as { address: string }).address)));

  /** Re-verified from Walrus plus the on-chain anchor on every call (cached 30 s inside). */
  app.get('/v1/borrowers/:address/history', async (req) => {
    const address = Addr.parse((req.params as { address: string }).address);
    const b = getBorrower(address);
    if (!b?.ledger_id) throw new AppError('NOT_FOUND', 'borrower not registered');
    const { verification, records } = await verifyHistory(address);
    const score = scoreFrom(records, verification.valid);
    return {
      address, memwalAccountId: b.memwal_account_id, ledgerId: b.ledger_id,
      verification, score,
      records: records.map((r: HistoryRecord) => ({
        seq: r.seq, kind: r.kind, at: r.at, data: r.data, evidence: r.evidence,
        hash: r.hash, prev: r.prev, blobId: r.blobId, sigValid: r.sigValid,
      })),
    };
  });

  /** Best-effort Suilend positions on Mainnet; [] with a note until the cap type is configured. */
  app.get('/v1/borrowers/:address/positions', async (req) => {
    const address = Addr.parse((req.params as { address: string }).address);
    if (!env.SUILEND_OBLIGATION_CAP_TYPE) {
      return { obligations: [], note: 'SUILEND_OBLIGATION_CAP_TYPE is not configured on the server' };
    }
    const obligations = await listObligations(address);
    if (obligations.length === 0) log.info('no suilend obligations found', { address: address.slice(0, 10) + '…' });
    return { obligations };
  });
}
