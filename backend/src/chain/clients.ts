import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { env } from '../config.js';
import { TokenBucket } from '../util/ratelimit.js';
import { sleep } from '../util/sleep.js';
import { Mutex } from '../util/mutex.js';
import { AppError, chainAbort } from '../errors.js';

/**
 * Native gRPC over HTTP/2 to Tatum, x-api-key as gRPC metadata. Tatum's Sui gateways speak native
 * gRPC only (grpc-web gets `application/grpc` back, and the JSON-RPC URLs return 404).
 */
function tatumGrpc(network: 'mainnet' | 'testnet', host: string, apiKey: string) {
  const transport = new GrpcTransport({
    host,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': apiKey },
  });
  return new SuiGrpcClient({ network, transport });
}

export const mainnet = tatumGrpc('mainnet', env.TATUM_GRPC_MAINNET, env.TATUM_API_KEY_MAINNET);
export const testnet = tatumGrpc('testnet', env.TATUM_GRPC_TESTNET, env.TATUM_API_KEY_TESTNET);
export const serverKeypair = Ed25519Keypair.fromSecretKey(env.SERVER_SUI_PRIVATE_KEY);
export const serverAddress = serverKeypair.toSuiAddress();

// One bucket per key: each Tatum key has its own rate limit.
const buckets = { mainnet: new TokenBucket(env.TATUM_RPS), testnet: new TokenBucket(env.TATUM_RPS) };
const RETRYABLE = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']);

function grpcCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && (e as { name?: string }).name === 'RpcError') {
    return String((e as { code: unknown }).code);
  }
  return null;
}

/**
 * Every Tatum call goes through here: paced to TATUM_RPS per network, retried on transient gRPC codes.
 * `net` picks the rate bucket; pass the network of the client used inside `fn`.
 */
export async function tatum<T>(fn: () => Promise<T>, label = 'tatum', retries = 3, net: 'mainnet' | 'testnet' = 'testnet'): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await buckets[net].take();
    try {
      return await fn();
    } catch (e) {
      const code = grpcCode(e);
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      if (e instanceof AppError) throw e;
      if (code === 'NOT_FOUND') throw new AppError('NOT_FOUND', `${label}: not found (pruned or wrong id)`, { code });
      if (code === 'RESOURCE_EXHAUSTED') throw new AppError('RATE_LIMITED', `${label}: Tatum rate limit`, { code });
      if (code) throw new AppError('UPSTREAM_TATUM', `${label}: ${code}`, { code });
      throw e;
    }
  }
}

/** Mainnet variant of `tatum()` (uses the Mainnet key's rate bucket). */
export const tatumMain = <T>(fn: () => Promise<T>, label = 'tatum', retries = 3) => tatum(fn, label, retries, 'mainnet');

export async function txObjectTypes(client: SuiGrpcClient, digest: string): Promise<Record<string, string>> {
  const net = client === mainnet ? 'mainnet' : 'testnet';
  const r = await tatum(() => client.getTransaction({ digest, include: { effects: true, objectTypes: true } }), 'getTransaction', 3, net);
  const t = r.Transaction ?? r.FailedTransaction;
  return ((t as unknown as { objectTypes?: Record<string, string> }).objectTypes) ?? {};
}

export function idsOfType(types: Record<string, string>, needle: string): string[] {
  return Object.entries(types).filter(([, ty]) => ty.includes(needle)).map(([id]) => id);
}

const serverTx = new Mutex();

/** Signs with the server key on Testnet. Serialized; never retried (execution is not idempotent from our side). */
export async function execServer(tx: Transaction, label: string): Promise<{ digest: string; objectTypes: Record<string, string> }> {
  return serverTx.run(async () => {
    let result;
    try {
      result = await tatum(() => serverKeypair.signAndExecuteTransaction({ transaction: tx, client: testnet }), label, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg)) throw chainAbort(msg);
      throw e;
    }
    const t = result.Transaction ?? result.FailedTransaction;
    if (!t.status.success) throw chainAbort(t.status.error?.message ?? `${label} failed`);
    await tatum(() => testnet.waitForTransaction({ digest: t.digest }), `${label}:wait`);
    const objectTypes = await txObjectTypes(testnet, t.digest);
    return { digest: t.digest, objectTypes };
  });
}
