import { bcs } from '@mysten/sui/bcs';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { C } from '../config.js';

/** Must match `QuoteMessage` in ghostwriter.move field-for-field (BCS is order sensitive). */
export const QuoteMessageBcs = bcs.struct('QuoteMessage', {
  domain: bcs.vector(bcs.u8()),
  pool_id: bcs.Address,
  buyer: bcs.Address,
  kind: bcs.u8(),
  feed_id: bcs.vector(bcs.u8()),
  strike_e8: bcs.u64(),
  obligation_id: bcs.Address,
  payout: bcs.u64(),
  premium: bcs.u64(),
  start_ms: bcs.u64(),
  end_ms: bcs.u64(),
  quote_id: bcs.vector(bcs.u8()),
  expires_ms: bcs.u64(),
});

export type QuoteTerms = {
  poolId: string; buyer: string; kind: 0 | 1; feedIdHex: string; strikeE8: bigint; obligationId: string;
  payout: bigint; premium: bigint; startMs: number; endMs: number; quoteIdHex: string; expiresMs: number;
};

const raw = (hex: string) => Array.from(hexToBytes(hex.replace(/^0x/, '')));

export function quoteMessageBytes(q: QuoteTerms): Uint8Array {
  return QuoteMessageBcs.serialize({
    domain: Array.from(Buffer.from(C.QUOTE_DOMAIN, 'utf8')),
    pool_id: q.poolId,
    buyer: q.buyer,
    kind: q.kind,
    feed_id: raw(q.feedIdHex),
    strike_e8: q.strikeE8,
    obligation_id: q.obligationId,
    payout: q.payout,
    premium: q.premium,
    start_ms: BigInt(q.startMs),
    end_ms: BigInt(q.endMs),
    quote_id: raw(q.quoteIdHex),
    expires_ms: BigInt(q.expiresMs),
  }).toBytes();
}

/** Ed25519 signature (hex) over the quote message, checked on-chain by `buy`. */
export function signQuote(q: QuoteTerms, signingKeyHex: string): string {
  return Buffer.from(ed25519.sign(quoteMessageBytes(q), hexToBytes(signingKeyHex))).toString('hex');
}
