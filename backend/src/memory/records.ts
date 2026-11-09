// Borrower history: signed, hash-chained records in the borrower's OWN Walrus Memory account,
// with the latest (seq, head) anchored on Sui Testnet in a Ledger object.
//
// Why both: the records live in the borrower's account, so the history is portable and they can
// revoke our access. Signing stops them forging a clean record (they have no key); the hash chain
// plus the on-chain anchor stops them hiding a bad one (a gap breaks the chain or the anchor).
// Any other underwriter the borrower authorises can verify exactly the same way.
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { db } from '../db.js';
import { env, C } from '../config.js';
import { canonical } from '../util/canon.js';
import { enqueueMemory, onMemoryWritten } from './queue.js';
import { borrowerMem, recall, listAll } from './client.js';
import { anchor } from '../chain/ghostwriterTx.js';
import { readLedger } from '../chain/objects.js';
import { emit } from '../bus.js';
import { log } from '../log.js';

export type RecordKind = 'onboarded' | 'policy_bought' | 'warning' | 'response' | 'payout' | 'expired';
type Body = {
  v: 1; borrower: string; seq: number; prev: string; kind: RecordKind;
  at: number; data: Record<string, unknown>; evidence: string[];
};
export type Parsed = Body & { hash: string; sig: string; pub: string };

const recordPriv = hexToBytes(env.RECORD_SIGNING_KEY_HEX);
/** Published in /v1/config so anyone can verify a borrower's records themselves. */
export const recordPubHex = bytesToHex(ed25519.getPublicKey(recordPriv));
const GENESIS = '0'.repeat(64);

const hashBody = (b: Body) => bytesToHex(sha256(utf8ToBytes(canonical(b))));

export function buildRecord(b: Body): { hash: string; text: string } {
  const hash = hashBody(b);
  const sig = bytesToHex(ed25519.sign(hexToBytes(hash), recordPriv));
  return { hash, text: C.PREFIX.record + JSON.stringify({ ...b, hash, sig, pub: recordPubHex }) };
}

export function parseRecord(text: string): Parsed | null {
  const i = text.indexOf(C.PREFIX.record);
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i + C.PREFIX.record.length)) as Parsed;
  } catch {
    return null;
  }
}

export function checkRecord(r: Parsed, trustedPubHex: string): { hashOk: boolean; sigOk: boolean } {
  const { hash, sig, pub, ...body } = r;
  const hashOk = hashBody(body as Body) === hash;
  let sigOk = false;
  try {
    sigOk = pub === trustedPubHex && ed25519.verify(hexToBytes(sig), hexToBytes(hash), hexToBytes(pub));
  } catch {
    sigOk = false;
  }
  return { hashOk, sigOk };
}

export type BorrowerRow = { address: string; memwal_account_id: string; ledger_id: string | null };
export const getBorrower = (address: string): BorrowerRow | undefined =>
  db.prepare('SELECT address, memwal_account_id, ledger_id FROM borrowers WHERE address = ?').get(address) as BorrowerRow | undefined;

export const recordCount = (address: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM ledger_records WHERE borrower = ?').get(address) as { n: number }).n;

export const anchoredSeq = (address: string): number =>
  (db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM ledger_records WHERE borrower = ? AND anchor_digest IS NOT NULL').get(address) as { s: number }).s;

/** Appends a signed, chained record and queues its Mainnet write. No-op for unregistered borrowers. */
export function appendRecord(
  borrower: string,
  kind: RecordKind,
  data: Record<string, unknown>,
  evidence: string[] = [],
): { seq: number; hash: string } | null {
  const b = getBorrower(borrower);
  if (!b) return null;
  const last = db.prepare('SELECT seq, hash FROM ledger_records WHERE borrower = ? ORDER BY seq DESC LIMIT 1')
    .get(borrower) as { seq: number; hash: string } | undefined;
  const body: Body = {
    v: 1, borrower, seq: (last?.seq ?? 0) + 1, prev: last?.hash ?? GENESIS,
    kind, at: Date.now(), data, evidence,
  };
  const { hash, text } = buildRecord(body);
  db.prepare('INSERT INTO ledger_records(borrower, seq, kind, hash, prev, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(borrower, body.seq, kind, hash, body.prev, text, body.at);
  const writeId = enqueueMemory({
    account: borrower, accountId: b.memwal_account_id, namespace: C.NS.history,
    text, purpose: `record:${body.seq}`, ref: `${borrower}:${body.seq}`,
  });
  db.prepare('UPDATE ledger_records SET write_id = ? WHERE borrower = ? AND seq = ?').run(writeId, borrower, body.seq);
  invalidateHistory(borrower);
  return { seq: body.seq, hash };
}

const anchoring = new Set<string>();
/** Anchors stored-but-unanchored records strictly in order (the contract enforces seq = last + 1). */
export async function anchorPending(borrower: string): Promise<void> {
  if (anchoring.has(borrower)) return;
  anchoring.add(borrower);
  try {
    const b = getBorrower(borrower);
    if (!b?.ledger_id) return;
    for (;;) {
      const next = db.prepare('SELECT seq, hash, blob_id FROM ledger_records WHERE borrower = ? AND seq = ?')
        .get(borrower, anchoredSeq(borrower) + 1) as { seq: number; hash: string; blob_id: string | null } | undefined;
      // Anchor only once the record is actually on Walrus, so the anchor always points at readable data.
      if (!next?.blob_id) return;
      const { digest } = await anchor(b.ledger_id, next.seq, next.hash);
      db.prepare('UPDATE ledger_records SET anchor_digest = ? WHERE borrower = ? AND seq = ?').run(digest, borrower, next.seq);
      invalidateHistory(borrower);
      emit('ledger.anchored', { borrower, seq: next.seq, head: next.hash, digest });
    }
  } catch (e) {
    log.error('anchor failed', { borrower, message: (e as Error).message });
  } finally {
    anchoring.delete(borrower);
  }
}

onMemoryWritten('record:', async (row) => {
  const [borrower, seq] = (row.ref ?? '').split(':');
  if (!borrower || !seq) return;
  db.prepare('UPDATE ledger_records SET blob_id = ? WHERE borrower = ? AND seq = ?').run(row.blob_id, borrower, Number(seq));
  invalidateHistory(borrower);
  await anchorPending(borrower);
});

export type Verification = {
  valid: boolean; reasons: string[]; recalled: number; indexed: number | null;
  anchoredSeq: number; anchoredHead: string; partial: boolean;
};
export type HistoryRecord = Parsed & { blobId: string; sigValid: boolean };
export type Score = {
  verified: boolean; warnings: number; responses: number; payouts: number; policies: number; discountFactor: number;
};

const cache = new Map<string, { at: number; value: { verification: Verification; records: HistoryRecord[] } }>();
export const invalidateHistory = (address: string) => void cache.delete(address);

/** Verifies a borrower's history exactly as another underwriter would: from Walrus plus the on-chain anchor. */
export async function verifyHistory(address: string, maxAgeMs = 30_000) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const b = getBorrower(address);
  if (!b?.ledger_id) throw new Error('borrower not registered');
  const mem = borrowerMem(b.memwal_account_id);
  const [ledger, hits, indexedList] = await Promise.all([
    readLedger(b.ledger_id),
    recall(mem, C.NS.history, 'ghostwriter borrower record history', 100),
    listAll(mem, C.NS.history).catch(() => null),
  ]);

  const reasons: string[] = [];
  const bySeq = new Map<number, HistoryRecord>();
  for (const h of hits) {
    const r = parseRecord(h.text);
    if (!r || r.borrower !== address) continue;
    const { hashOk, sigOk } = checkRecord(r, recordPubHex);
    if (!hashOk) reasons.push(`seq ${r.seq}: hash mismatch`);
    if (!sigOk) reasons.push(`seq ${r.seq}: signature invalid or untrusted key`);
    const prev = bySeq.get(r.seq);
    if (prev && prev.hash !== r.hash) reasons.push(`seq ${r.seq}: two different records`);
    bySeq.set(r.seq, { ...r, blobId: h.blobId, sigValid: hashOk && sigOk });
  }

  const records = [...bySeq.values()].sort((a, c) => a.seq - c.seq);
  records.forEach((r, i) => {
    if (r.seq !== i + 1) reasons.push(`gap before seq ${r.seq}`);
    const expectedPrev = i === 0 ? GENESIS : records[i - 1].hash;
    if (r.prev !== expectedPrev) reasons.push(`seq ${r.seq}: prev hash does not link`);
  });

  const lastAnchored = records.find((r) => r.seq === ledger.seq);
  if (ledger.seq > 0 && (!lastAnchored || lastAnchored.hash !== ledger.headHex)) {
    reasons.push(`anchored head (seq ${ledger.seq}) not matched by Walrus records`);
  }

  const indexed = indexedList ? indexedList.length : null;
  const partial = indexed !== null && indexed > records.length;
  if (partial) reasons.push(`recall returned ${records.length} of ${indexed} indexed records`);

  const verification: Verification = {
    valid: reasons.length === 0, reasons, recalled: records.length, indexed,
    anchoredSeq: ledger.seq, anchoredHead: ledger.headHex, partial,
  };
  const value = { verification, records };
  cache.set(address, { at: Date.now(), value });
  return value;
}

/**
 * Turns verified history into a premium factor. Responding to a warning earns a discount; ignoring
 * one costs; past payouts cost. Unverifiable history gets no discount at all (never a reward).
 */
export function scoreFrom(records: Parsed[], valid: boolean): Score {
  const count = (k: RecordKind) => records.filter((r) => r.kind === k).length;
  const warnings = count('warning'), responses = count('response'), payouts = count('payout'), policies = count('policy_bought');
  let f: number;
  if (!valid) f = 1.10;
  else if (warnings === 0) f = 1.0 - Math.min(0.05, 0.01 * policies);
  else {
    const resp = Math.min(1, responses / warnings);
    f = 1.0 - 0.2 * resp + 0.1 * (1 - resp);
  }
  f += Math.min(0.2, 0.05 * payouts);
  return {
    verified: valid, warnings, responses, payouts, policies,
    discountFactor: Math.max(0.75, Math.min(1.3, Number(f.toFixed(4)))),
  };
}

/** Score without touching the relayer (DB mirror only) — used where a quote must not block. */
export function localScore(address: string): Score {
  const rows = db.prepare('SELECT text FROM ledger_records WHERE borrower = ? ORDER BY seq ASC').all(address) as Array<{ text: string }>;
  const records = rows.map((r) => parseRecord(r.text)).filter((r): r is Parsed => r !== null);
  return scoreFrom(records, records.length > 0);
}
