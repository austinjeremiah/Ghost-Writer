// x402 agent payments, Sui "exact" scheme (x402Version 2).
//
// The novel part: the payment payload IS the signed policy-purchase transaction. There is no separate
// transfer to verify and then a policy to mint — paying and getting insured are the same atomic
// on-chain step, and the Move contract enforces the quoted terms via the signed QuoteMessage.
//
// Honest difference from the spec: its final facilitator check is "payTo receives amount". Our premium
// goes into the shared Pool object inside `buy`, not to an address, so instead we verify the call is
// exactly one `ghostwriter::buy` for an issued quote by the quoted buyer, and the contract itself
// enforces premium >= quoted premium (abort 5).
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../config.js';
import { AppError, chainAbort } from '../errors.js';
import { testnet, tatum } from '../chain/clients.js';
import { getQuote, type QuoteDTO } from '../pricing/quote.js';
import { confirmFromDigest, type PolicyDTO } from '../policies/sync.js';
import { emit } from '../bus.js';

/** The spec publishes `sui:mainnet`; testnet follows the same `sui:<network>` pattern. */
export const X402_NETWORK = 'sui:testnet';
/** Index of `quote_id` in ghostwriter::buy — must match QuoteDTO.moveCall.argOrder. */
const QUOTE_ID_ARG = 9;

export function paymentRequired(quote: QuoteDTO, error: string) {
  const usd = (n: string) => (Number(n) / 10 ** env.COIN_DECIMALS).toFixed(2);
  return {
    x402Version: 2,
    error,
    resource: {
      url: `${env.PUBLIC_BASE_URL}/v1/agent/cover`,
      description: `Ghostwriter cover: ${quote.kind} ${quote.asset} below $${(Number(quote.strikeE8) / 1e8).toFixed(4)}`
        + ` until ${new Date(quote.endMs).toISOString()}, payout ${usd(quote.payout)} gUSD`,
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'exact',
      network: X402_NETWORK,
      amount: quote.premium,
      asset: env.COIN_TYPE,
      payTo: env.GHOSTWRITER_POOL_ID,
      maxTimeoutSeconds: 120,
      extra: {
        quote,
        how: 'Build a PTB calling quote.moveCall.target with arguments in quote.moveCall.argOrder, sign it'
          + ' WITHOUT executing, then send base64 JSON { x402Version, accepted, payload: { signature, transaction } }'
          + ' in the PAYMENT-SIGNATURE header.',
      },
    }],
  };
}

const PaymentPayload = z.object({
  x402Version: z.literal(2),
  accepted: z.object({ scheme: z.literal('exact'), network: z.literal(X402_NETWORK) }).passthrough(),
  payload: z.object({ signature: z.string().min(16), transaction: z.string().min(16) }),
}).passthrough();

export function decodeHeader(header: string) {
  try {
    return PaymentPayload.parse(JSON.parse(Buffer.from(header, 'base64').toString('utf8')));
  } catch {
    throw new AppError('BAD_REQUEST', 'payment header is not base64 JSON in the x402 v2 exact/sui shape');
  }
}

type Cmd = {
  $kind: string;
  MoveCall?: { package: string; module: string; function: string; arguments: Array<{ $kind: string; Input?: number }> };
};
type Inp = { $kind: string; Pure?: { bytes: string } };

/** Reads the sender and the quote id out of the signed transaction's single ghostwriter::buy call. */
function readBuy(bytes: Uint8Array): { payer: string; quoteId: string } {
  const data = Transaction.from(bytes).getData() as unknown as { sender?: string; commands: Cmd[]; inputs: Inp[] };
  const payer = normalizeSuiAddress(data.sender ?? '0x0');
  const pkg = normalizeSuiAddress(env.GHOSTWRITER_PACKAGE_ID);
  const buys = data.commands.filter(
    (c) => c.$kind === 'MoveCall' && c.MoveCall
      && normalizeSuiAddress(c.MoveCall.package) === pkg
      && c.MoveCall.module === 'ghostwriter'
      && c.MoveCall.function === 'buy',
  );
  if (buys.length !== 1) throw new AppError('BAD_REQUEST', 'transaction must contain exactly one ghostwriter::buy call');
  const arg = buys[0].MoveCall!.arguments[QUOTE_ID_ARG];
  const input = arg?.$kind === 'Input' && arg.Input !== undefined ? data.inputs[arg.Input] : undefined;
  if (!input?.Pure) throw new AppError('BAD_REQUEST', 'quote_id must be a pure input');
  return { payer, quoteId: Buffer.from(bcs.vector(bcs.u8()).parse(fromBase64(input.Pure.bytes))).toString('hex') };
}

/** For error replies: which quote a header points at, or null if it cannot be read. */
export function quoteIdFromHeader(header: string): string | null {
  try {
    return readBuy(fromBase64(decodeHeader(header).payload.transaction)).quoteId;
  } catch {
    return null;
  }
}

export async function settlePayment(header: string): Promise<{ policy: PolicyDTO; digest: string; payer: string; quote: QuoteDTO }> {
  const xp = decodeHeader(header);
  const bytes = fromBase64(xp.payload.transaction);
  const { payer, quoteId } = readBuy(bytes);

  const quote = getQuote(quoteId);
  if (!quote) throw new AppError('NOT_FOUND', 'unknown quote');
  if (quote.status === 'used') throw new AppError('CONFLICT', 'quote already used');
  if (quote.status === 'expired' || Date.now() > quote.expiresMs) {
    throw new AppError('QUOTE_EXPIRED', 'quote expired; request a new 402');
  }
  if (payer !== quote.buyer) throw new AppError('BAD_REQUEST', 'transaction sender is not the quoted buyer');

  // Execution is the settlement: a bad signature, a replayed transaction or tampered terms all fail here.
  const result = await tatum(
    () => testnet.executeTransaction({ transaction: bytes, signatures: [xp.payload.signature] }),
    'x402:execute',
    0,
  ).catch((e: Error) => {
    throw /abort/i.test(e.message) ? chainAbort(e.message) : e;
  });
  const t = result.Transaction ?? result.FailedTransaction;
  if (!t.status.success) throw chainAbort(t.status.error?.message ?? 'buy failed');

  db.prepare('INSERT OR IGNORE INTO payments(digest, quote_id, payer, created_at) VALUES (?, ?, ?, ?)')
    .run(t.digest, quote.quoteId, payer, Date.now());
  await tatum(() => testnet.waitForTransaction({ digest: t.digest }), 'x402:wait');

  const policy = await confirmFromDigest(t.digest, quote.quoteId);
  emit('x402.settled', { quoteId: quote.quoteId, payer, digest: t.digest, policyId: policy.policyId });
  return { policy, digest: t.digest, payer, quote };
}
