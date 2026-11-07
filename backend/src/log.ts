const REDACT = /(suiprivkey1[0-9a-z]+|sk-[A-Za-z0-9_-]{10,}|[0-9a-fA-F]{64})/g;
// API keys have no fixed shape, so also hide the exact values of every secret env var.
// Read at log time (not import time) so it works whatever order dotenv and this module load in.
const SECRET_NAMES = [
  'TATUM_API_KEY_MAINNET', 'TATUM_API_KEY_TESTNET', 'PYTH_API_KEY', 'VULTR_INFERENCE_API_KEY',
  'WALRUS_PRIVATE_KEY', 'MEMWAL_BORROWER_DELEGATE_KEY', 'SERVER_SUI_PRIVATE_KEY',
  'QUOTE_SIGNING_KEY_HEX', 'RECORD_SIGNING_KEY_HEX', 'ADMIN_TOKEN',
];
function clean(v: unknown): string {
  let s = (typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) ?? '';
  for (const name of SECRET_NAMES) { const secret = process.env[name]; if (secret && secret.length >= 8) s = s.split(secret).join('[redacted]'); }
  return s.replace(REDACT, '[redacted]');
}
export const log = {
  info: (msg: string, data?: unknown) => console.log(`[info] ${msg}`, data === undefined ? '' : clean(data)),
  warn: (msg: string, data?: unknown) => console.warn(`[warn] ${msg}`, data === undefined ? '' : clean(data)),
  error: (msg: string, data?: unknown) => console.error(`[error] ${msg}`, data === undefined ? '' : clean(data)),
};
