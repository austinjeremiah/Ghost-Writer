// lib/buy.ts
'use client';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { dAppKit } from './dapp-kit';
import { api, ApiError } from './api';
import type { Config, PolicyDTO, QuoteDTO } from './types';

const bytes = (hex: string) => Array.from(fromHex(hex.replace(/^0x/, '')));

export function buildBuyTx(q: QuoteDTO, cfg: Config): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: q.moveCall.target,
    typeArguments: q.moveCall.typeArguments,
    arguments: [
      tx.object(cfg.poolId),                       // pool
      tx.pure.u8(q.kindU8),                        // kind
      tx.pure.vector('u8', bytes(q.feedId)),       // feedId (32 raw bytes)
      tx.pure.u64(q.strikeE8),                     // strikeE8
      tx.pure.address(q.obligationId),             // obligationId (0x0 for price cover)
      tx.pure.u64(q.payout),                       // payout
      tx.pure.u64(q.premium),                      // premium
      tx.pure.u64(q.startMs),                      // startMs
      tx.pure.u64(q.endMs),                        // endMs
      tx.pure.vector('u8', bytes(q.quoteId)),      // quoteId (16 raw bytes)
      tx.pure.u64(q.expiresMs),                    // expiresMs
      tx.pure.vector('u8', bytes(q.signatureHex)), // signature
      coinWithBalance({ type: cfg.coinType, balance: BigInt(q.premium) }), // payment: exactly the premium
      tx.object.clock(),                           // clock
    ],
  });
  return tx;
}

export type BuyStep = 'wallet' | 'confirming' | 'done';

/** Sign on Testnet, then tell the backend so it can index the policy and write the borrower record. */
export async function buyAndConfirm(q: QuoteDTO, cfg: Config, onStep: (s: BuyStep, digest?: string) => void): Promise<PolicyDTO> {
  onStep('wallet');
  const r = await dAppKit.signAndExecuteTransaction({ transaction: buildBuyTx(q, cfg), network: 'testnet' });
  if (r.$kind === 'FailedTransaction') {
    throw new Error(r.FailedTransaction.status.error?.message ?? 'Transaction failed on chain');
  }
  const digest = r.Transaction.digest;
  onStep('confirming', digest);
  // The tx is final, but the backend reads it through Tatum; retry briefly if it is not visible yet.
  for (let i = 0; ; i++) {
    try {
      const p = await api.confirmPolicy(digest, q.quoteId);
      onStep('done', digest);
      return p;
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status === 404 || e.status === 502);
      if (!retryable || i >= 4) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

/** gUSD the connected wallet holds on Testnet (base units string). */
export async function dusdcBalance(cfg: Config, owner: string): Promise<string> {
  const { balance } = await dAppKit.getClient('testnet').getBalance({ owner, coinType: cfg.coinType });
  return balance.balance;
}
