// Checks every external dependency once. Prints ✔/✘ per line, never secret values.
import OpenAI from 'openai';
import { MemWal } from '@mysten-incubation/memwal';
import { env, ENABLED_ASSETS, FEED_BY_ASSET } from '../src/config.js';
import { mainnet, testnet, tatum, tatumMain, serverAddress } from '../src/chain/clients.js';
import { latestSpots } from '../src/chain/pyth.js';
import { readPool } from '../src/chain/objects.js';

const ok = (name: string, v?: unknown) => console.log(`✔ ${name}`, v ?? '');
const bad = (name: string, e: unknown) => console.log(`✘ ${name}`, e instanceof Error ? e.message : e);

try { const { object } = await tatumMain(() => mainnet.getObject({ objectId: '0x6' })); ok('tatum mainnet gRPC getObject(0x6)', object.type); } catch (e) { bad('tatum mainnet', e); }
try { const { object } = await tatum(() => testnet.getObject({ objectId: '0x6' })); ok('tatum testnet gRPC getObject(0x6)', object.type); } catch (e) { bad('tatum testnet', e); }
try { const { balance } = await tatum(() => testnet.getBalance({ owner: serverAddress })); ok(`server ${serverAddress.slice(0, 10)}… SUI`, Number(balance.balance) / 1e9); } catch (e) { bad('server SUI', e); }
try { const { balance } = await tatum(() => testnet.getBalance({ owner: serverAddress, coinType: env.COIN_TYPE })); ok('server gUSD (base units)', balance.balance); } catch (e) { bad('server gUSD', e); }
try {
  const assets = ['SUI', 'BTC'] as const;
  const spots = await latestSpots(assets.map((a) => FEED_BY_ASSET[a]));
  for (const a of assets) {
    const s = spots.get(FEED_BY_ASSET[a])!;
    const age = Math.round((Date.now() - s.publishMs) / 1000);
    const enabled = ENABLED_ASSETS.includes(a);
    const line = `$${s.spotUsd.toFixed(a === 'SUI' ? 4 : 2)}, ${age} s old, conf ${((Number(s.confE8) / Number(s.priceE8)) * 1e4).toFixed(1)} bps${enabled ? '' : ' (disabled)'}`;
    if (!enabled || age <= env.MAX_PRICE_AGE_S) ok(`pyth on-chain ${a}/USD`, line); else bad(`pyth on-chain ${a}/USD`, `${line}: older than MAX_PRICE_AGE_S`);
  }
} catch (e) { bad('pyth on-chain', e); }
try {
  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 86_400_000;
  const q = env.TATUM_OHLCV_QUERY.replace('{symbol}', 'SUI').replace('{unix}', String(day));
  const res = await fetch(`${env.TATUM_API_BASE}/v4/data/rate/symbol/OHLCV?${q}`, { headers: { 'x-api-key': env.TATUM_API_KEY_MAINNET } });
  ok(`tatum OHLCV HTTP ${res.status} body:`, (await res.text()).slice(0, 200));
} catch (e) { bad('tatum OHLCV', e); }
if (env.GHOSTWRITER_POOL_ID) {
  try { const p = await readPool(); ok('pool', { vault: p.vault.toString(), free: p.free.toString(), maxPriceAgeS: p.maxPriceAgeS, confirmDelayMs: p.confirmDelayMs, paused: p.paused }); } catch (e) { bad('pool', e); }
} else console.log('… pool not created yet (pnpm pool:create)');
try {
  const m = MemWal.create({ key: env.WALRUS_PRIVATE_KEY, accountId: env.MEMWAL_UNDERWRITER_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL });
  ok('memwal health', await m.health());
  ok('memwal signed call listNamespaces', (await m.listNamespaces({ limit: 5 })).namespaces.map((n) => n.name));
} catch (e) { bad('memwal (delegate key / account id?)', e); }
try {
  const c = new OpenAI({ apiKey: env.VULTR_INFERENCE_API_KEY, baseURL: env.VULTR_INFERENCE_BASE_URL });
  const r = await c.chat.completions.create({ model: env.VULTR_INFERENCE_MODEL, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with OK' }] });
  ok(`vultr ${env.VULTR_INFERENCE_MODEL}`, r.choices[0]?.message?.content?.trim().slice(0, 40));
} catch (e) { bad('vultr inference', e); }
