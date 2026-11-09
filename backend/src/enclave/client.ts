// Talks to the Nautilus enclave running on AWS Nitro.
//
// The enclave is the only thing that attests a Mainnet liquidation to our Testnet contract. It reads
// the transaction itself (through Tatum JSON-RPC, from inside the TEE), checks that it really contains
// a Suilend LiquidateEvent for the obligation, and signs an IntentMessage over the attestation. Our
// contract verifies that signature against an enclave key registered only via a Nitro attestation with
// matching PCRs — so the backend cannot forge a liquidation even if it wanted to.
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { log } from '../log.js';

export type Attestation = {
  obligationId: string;
  txDigest: string;
  repayAmount: bigint;
  withdrawAmount: bigint;
  timestampMs: number;
  signatureHex: string;
};

type ProcessDataResponse = {
  response?: { intent?: number; timestamp_ms?: number | string; data?: Record<string, unknown> };
  signature?: string;
};

const enclaveConfigured = () => env.ENCLAVE_URL !== '';

function requireEnclave(): string {
  if (!enclaveConfigured()) {
    throw new AppError('UPSTREAM_ENCLAVE', 'ENCLAVE_URL is not set: start the Nitro enclave and register it (P7)');
  }
  return env.ENCLAVE_URL.replace(/\/+$/, '');
}

export async function enclaveHealth(): Promise<unknown> {
  const base = requireEnclave();
  const res = await fetch(`${base}/health_check`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new AppError('UPSTREAM_ENCLAVE', `enclave health_check HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number => Number(v ?? 0);
const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    return 0n;
  }
};

/**
 * `obligation_id` is `[u8; 32]` in the Rust attestation, so serde serialises it as a JSON array of
 * byte values, not a hex string. Accept either, so this keeps working if the enclave ever switches
 * to a hex representation.
 */
function addrOf(v: unknown): string {
  if (typeof v === 'string') return v.startsWith('0x') ? v.toLowerCase() : `0x${v.toLowerCase()}`;
  if (Array.isArray(v) && v.length === 32) {
    return `0x${v.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`;
  }
  return '';
}

/**
 * Asks the enclave to attest one liquidation. The enclave refuses — and this throws — when the
 * transaction holds no LiquidateEvent for that obligation, which is the check that makes the whole
 * path trustworthy rather than decorative.
 */
export async function attestLiquidation(txDigest: string, obligationId: string): Promise<Attestation> {
  const base = requireEnclave();
  let res: Response;
  try {
    res = await fetch(`${base}/process_data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { tx_digest: txDigest, obligation_id: obligationId } }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new AppError('UPSTREAM_ENCLAVE', `enclave unreachable: ${(e as Error).message}`);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    // The enclave's own refusal reason is the useful part ("no LiquidateEvent for this obligation").
    throw new AppError('UPSTREAM_ENCLAVE', `enclave refused: HTTP ${res.status} ${bodyText.slice(0, 300)}`);
  }

  let body: ProcessDataResponse;
  try {
    body = JSON.parse(bodyText) as ProcessDataResponse;
  } catch {
    throw new AppError('UPSTREAM_ENCLAVE', 'enclave returned non-JSON');
  }

  const sig = body.signature;
  const data = body.response?.data;
  if (!sig || !data) throw new AppError('UPSTREAM_ENCLAVE', 'enclave response has no signature or data');

  const attested = {
    obligationId: addrOf(data.obligation_id),
    // `tx_digest` comes back as the UTF-8 bytes of the digest we sent; the signature only verifies
    // for that exact value, so reuse ours rather than re-decoding a byte array.
    txDigest,
    repayAmount: big(data.repay_amount),
    withdrawAmount: big(data.withdraw_amount),
    timestampMs: num(body.response?.timestamp_ms),
    signatureHex: sig.replace(/^0x/, ''),
  };

  // The contract rebuilds the attestation from the POLICY's obligation id, so a mismatch here would
  // only surface as abort 16. Fail early with a clear message instead.
  if (attested.obligationId !== addrOf(obligationId)) {
    throw new AppError('UPSTREAM_ENCLAVE', 'enclave attested a different obligation', {
      asked: obligationId, got: attested.obligationId,
    });
  }
  if (!attested.timestampMs) throw new AppError('UPSTREAM_ENCLAVE', 'enclave attestation has no timestamp');

  log.info('enclave attested liquidation', {
    obligationId: obligationId.slice(0, 12) + '…', txDigest, timestampMs: attested.timestampMs,
  });
  return attested;
}

export const enclaveReady = enclaveConfigured;
