import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { testnet, tatum } from './clients.js';
import { env } from '../config.js';
import { AppError } from '../errors.js';

const PoolBcs = bcs.struct('Pool', {
  id: bcs.Address,
  vault: bcs.struct('Balance', { value: bcs.u64() }),
  locked: bcs.u64(),
  quote_pubkey: bcs.vector(bcs.u8()),
  premiums_collected: bcs.u64(),
  payouts_made: bcs.u64(),
  confirm_delay_ms: bcs.u64(),
  max_conf_bps: bcs.u64(),
  max_price_age_s: bcs.u64(),
  paused: bcs.bool(),
  used_quotes: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
});

const PolicyBcs = bcs.struct('Policy', {
  id: bcs.Address,
  pool_id: bcs.Address,
  holder: bcs.Address,
  kind: bcs.u8(),
  feed_id: bcs.vector(bcs.u8()),
  strike_e8: bcs.u64(),
  obligation_id: bcs.Address,
  payout: bcs.u64(),
  premium: bcs.u64(),
  start_ms: bcs.u64(),
  end_ms: bcs.u64(),
  quote_id: bcs.vector(bcs.u8()),
  status: bcs.u8(),
  breach_started_ms: bcs.u64(),
});

const LedgerBcs = bcs.struct('Ledger', {
  id: bcs.Address,
  borrower: bcs.Address,
  memwal_account: bcs.Address,
  seq: bcs.u64(),
  head: bcs.vector(bcs.u8()),
});

const hex = (b: number[]) => Buffer.from(b).toString('hex');

async function content(objectId: string): Promise<{ type: string; bytes: Uint8Array }> {
  const { object } = await tatum(() => testnet.getObject({ objectId, include: { content: true } }), 'getObject');
  if (!object.content) throw new AppError('NOT_FOUND', 'object has no content', { objectId });
  return { type: object.type, bytes: object.content };
}

export type PoolState = {
  vault: bigint; locked: bigint; free: bigint; quotePubkeyHex: string; premiumsCollected: bigint; payoutsMade: bigint;
  confirmDelayMs: number; maxConfBps: number; maxPriceAgeS: number; paused: boolean;
};
export async function readPool(): Promise<PoolState> {
  const { type, bytes } = await content(env.GHOSTWRITER_POOL_ID);
  if (!type.includes('::ghostwriter::Pool<')) throw new AppError('INTERNAL', 'GHOSTWRITER_POOL_ID is not a Pool', { type });
  const p = PoolBcs.parse(bytes);
  const vault = BigInt(p.vault.value);
  const locked = BigInt(p.locked);
  return {
    vault, locked, free: vault - locked, quotePubkeyHex: hex(p.quote_pubkey),
    premiumsCollected: BigInt(p.premiums_collected), payoutsMade: BigInt(p.payouts_made),
    confirmDelayMs: Number(p.confirm_delay_ms), maxConfBps: Number(p.max_conf_bps), maxPriceAgeS: Number(p.max_price_age_s), paused: p.paused,
  };
}

export type PolicyState = {
  id: string; poolId: string; holder: string; kind: 0 | 1; feedId: string; strikeE8: bigint; obligationId: string;
  payout: bigint; premium: bigint; startMs: number; endMs: number; quoteId: string; status: 0 | 1 | 2; breachStartedMs: number;
};
export async function readPolicy(objectId: string): Promise<PolicyState> {
  const { type, bytes } = await content(objectId);
  if (!type.includes('::ghostwriter::Policy<')) throw new AppError('NOT_FOUND', 'not a Policy object', { objectId });
  const p = PolicyBcs.parse(bytes);
  return {
    id: normalizeSuiAddress(p.id), poolId: normalizeSuiAddress(p.pool_id), holder: normalizeSuiAddress(p.holder),
    kind: p.kind as 0 | 1, feedId: '0x' + hex(p.feed_id), strikeE8: BigInt(p.strike_e8),
    obligationId: normalizeSuiAddress(p.obligation_id), payout: BigInt(p.payout), premium: BigInt(p.premium),
    startMs: Number(p.start_ms), endMs: Number(p.end_ms), quoteId: hex(p.quote_id),
    status: p.status as 0 | 1 | 2, breachStartedMs: Number(p.breach_started_ms),
  };
}

export type LedgerState = { id: string; borrower: string; memwalAccount: string; seq: number; headHex: string };
export async function readLedger(objectId: string): Promise<LedgerState> {
  const { type, bytes } = await content(objectId);
  if (!type.includes('::ghostwriter::Ledger')) throw new AppError('NOT_FOUND', 'not a Ledger object', { objectId });
  const l = LedgerBcs.parse(bytes);
  return { id: normalizeSuiAddress(l.id), borrower: normalizeSuiAddress(l.borrower), memwalAccount: normalizeSuiAddress(l.memwal_account), seq: Number(l.seq), headHex: hex(l.head) };
}
