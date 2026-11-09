// Reads a borrower's MemWalAccount on Sui MAINNET through Tatum, so registration is checked against
// the chain rather than trusted from the request body.
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { bytesToHex } from '@noble/hashes/utils';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { mainnet, tatumMain } from './clients.js';

export type MemWalAccountState = {
  accountId: string;
  owner: string;
  active: boolean;
  quarantined: boolean;
  /** Delegate public keys, hex (the object stores them base64-encoded). */
  delegatePubHexes: string[];
};

type JsonObj = Record<string, unknown>;
const field = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as JsonObj)[k] : undefined), o);

/** Delegate public keys come back base64 in the object JSON; normalise to lowercase hex. */
function toHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(v)) return v.replace(/^0x/, '').toLowerCase();
  try {
    const b = Buffer.from(v, 'base64');
    return b.length === 32 ? bytesToHex(new Uint8Array(b)) : null;
  } catch {
    return null;
  }
}

export async function readMemWalAccount(accountId: string): Promise<MemWalAccountState> {
  const { object } = await tatumMain(
    () => mainnet.core.getObject({ objectId: accountId, include: { json: true } }),
    'memwal account',
  );
  if (!object.type?.includes('::account::MemWalAccount')) {
    throw new AppError('BAD_REQUEST', 'that object is not a Walrus Memory account', { type: object.type });
  }
  const json = object.json as JsonObj;
  const owner = field(json, 'owner');
  if (typeof owner !== 'string') throw new AppError('UPSTREAM_TATUM', 'memwal account: no owner field');

  const keys = field(json, 'delegate_keys');
  const delegatePubHexes = Array.isArray(keys)
    ? keys.map((k) => toHex(field(k, 'public_key'))).filter((h): h is string => h !== null)
    : [];

  return {
    accountId: normalizeSuiAddress(accountId),
    owner: normalizeSuiAddress(owner),
    active: field(json, 'active') !== false,
    quarantined: field(json, 'admin_quarantined') === true,
    delegatePubHexes,
  };
}

/** The Walrus Memory package this account must belong to (guards against a lookalike object). */
export const memwalPackageId = env.MEMWAL_PACKAGE_ID;
