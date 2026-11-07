import { Transaction } from '@mysten/sui/transactions';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '../config.js';
import { priceObjectFor } from './pyth.js';
import { execServer, idsOfType } from './clients.js';
import { AppError } from '../errors.js';

const T = () => `${env.GHOSTWRITER_PACKAGE_ID}::ghostwriter`;
const bytes = (hex: string) => Array.from(hexToBytes(hex.replace(/^0x/, '')));

async function priceCall(fn: 'report_breach' | 'reset_breach' | 'confirm_breach', policyId: string, feedId: string) {
  // The contract reads Pyth's shared PriceInfoObject as-is (kept fresh on Testnet by others); no update call.
  const pio = await priceObjectFor(feedId);
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::${fn}`,
    typeArguments: [env.COIN_TYPE],
    arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(policyId), tx.object(pio), tx.object.clock()],
  });
  return execServer(tx, fn);
}

export const reportBreach = (policyId: string, feedId: string) => priceCall('report_breach', policyId, feedId);
export const resetBreach = (policyId: string, feedId: string) => priceCall('reset_breach', policyId, feedId);
export const confirmBreach = (policyId: string, feedId: string) => priceCall('confirm_breach', policyId, feedId);

export async function expirePolicy(policyId: string) {
  const tx = new Transaction();
  tx.moveCall({ target: `${T()}::expire`, typeArguments: [env.COIN_TYPE], arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(policyId), tx.object.clock()] });
  return execServer(tx, 'expire');
}

export async function settleLiquidation(args: {
  policyId: string; txDigest: string; repayAmount: bigint; withdrawAmount: bigint; timestampMs: number; signatureHex: string;
}) {
  if (!env.ENCLAVE_OBJECT_ID || !env.ENCLAVE_CONFIG_OBJECT_ID) throw new AppError('UPSTREAM_ENCLAVE', 'enclave not registered (ENCLAVE_OBJECT_ID empty)');
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::settle_liquidation`,
    typeArguments: [env.COIN_TYPE],
    arguments: [
      tx.object(env.GHOSTWRITER_POOL_ID),
      tx.object(args.policyId),
      tx.object(env.ENCLAVE_OBJECT_ID),
      tx.object(env.ENCLAVE_CONFIG_OBJECT_ID),
      tx.pure.vector('u8', Array.from(Buffer.from(args.txDigest, 'utf8'))),
      tx.pure.u64(args.repayAmount),
      tx.pure.u64(args.withdrawAmount),
      tx.pure.u64(args.timestampMs),
      tx.pure.vector('u8', bytes(args.signatureHex)),
    ],
  });
  return execServer(tx, 'settle_liquidation');
}

export async function createLedger(borrower: string, memwalAccount: string): Promise<{ ledgerId: string; digest: string }> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::create_ledger`,
    arguments: [tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.pure.address(borrower), tx.pure.address(memwalAccount)],
  });
  const r = await execServer(tx, 'create_ledger');
  const [ledgerId] = idsOfType(r.objectTypes, '::ghostwriter::Ledger');
  if (!ledgerId) throw new AppError('INTERNAL', 'create_ledger: Ledger not found in effects', { digest: r.digest });
  return { ledgerId, digest: r.digest };
}

export async function anchor(ledgerId: string, seq: number, headHex: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${T()}::anchor`,
    arguments: [tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.object(ledgerId), tx.pure.u64(seq), tx.pure.vector('u8', bytes(headHex)), tx.object.clock()],
  });
  return execServer(tx, 'anchor');
}

export async function setPaused(paused: boolean) {
  const tx = new Transaction();
  tx.moveCall({ target: `${T()}::set_paused`, typeArguments: [env.COIN_TYPE], arguments: [tx.object(env.GHOSTWRITER_POOL_ID), tx.object(env.GHOSTWRITER_ADMIN_CAP_ID), tx.pure.bool(paused)] });
  return execServer(tx, 'set_paused');
}
