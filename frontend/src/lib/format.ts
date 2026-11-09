// lib/format.ts
import type { Config, RecordKind } from './types';

const DEC = 6; // gUSD decimals (also in /v1/config.coinDecimals)

/** "1940000" → "1.94" */
export function fromBase(units: string, decimals = DEC, dp = 2): string {
  const n = BigInt(units);
  const whole = n / 10n ** BigInt(decimals);
  const frac = (n % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').slice(0, dp);
  return dp > 0 ? `${whole}.${frac}` : whole.toString();
}
/** strikeE8 "86000000" → 0.86 */
export const e8ToUsd = (e8: string) => Number(e8) / 1e8;
export const usd = (n: number, dp = n < 10 ? 4 : 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
export const shortId = (id: string, head = 6, tail = 4) => (id.length <= head + tail + 2 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`);

/** Distance from spot down to trigger, as a fraction. 0.037 = 3.7% above trigger. */
export const distanceToTrigger = (spotUsd: number, strikeUsd: number) => (spotUsd - strikeUsd) / spotUsd;

export function timeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const link = {
  testnetTx: (c: Config, d: string) => `${c.explorers.testnetTx}${d}`,
  testnetObject: (c: Config, id: string) => `${c.explorers.testnetObject}${id}`,
  mainnetTx: (c: Config, d: string) => `${c.explorers.mainnetTx}${d}`,
  mainnetObject: (c: Config, id: string) => `${c.explorers.mainnetObject}${id}`,
  blob: (c: Config, blobId: string) => `${c.explorers.walrusBlob}${blobId}`,
};

/**
 * Which chain a record's evidence digest lives on (from the backend's appendRecord calls):
 * 'response' carries a Mainnet Suilend deposit/repay digest; 'policy_bought', 'payout', 'expired' carry Testnet digests.
 */
export const evidenceNetwork = (kind: RecordKind): 'mainnet' | 'testnet' => (kind === 'response' ? 'mainnet' : 'testnet');

/** ms timestamp → "7 Nov 2026, 14:05" in the viewer's locale. */
export const date = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Seconds since a ms timestamp, for "12s ago". */
export const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
