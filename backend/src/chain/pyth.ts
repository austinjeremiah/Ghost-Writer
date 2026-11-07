import { bcs } from '@mysten/sui/bcs';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { tatum, testnet } from './clients.js';

/**
 * Prices come from Pyth's on-chain PriceInfoObjects on Sui Testnet, read through Tatum gRPC.
 *
 * The build doc pulls signed updates from Hermes and pushes them in each tx, but the Pyth free plan has
 * no API access. Others already push SUI/USD to Testnet about every 126 s, and our contract only reads the
 * object (`pyth::get_price_no_older_than` with the pool's max age), so no update step is needed.
 */

export type Spot = { feedId: string; priceE8: bigint; confE8: bigint; spotUsd: number; publishMs: number; priceObjectId: string };

const strip = (id: string) => id.toLowerCase().replace(/^0x/, '');
const priceObjects = new Map<string, string>();
let tableRef: { tableId: string; idType: string } | null = null;

type JsonObj = Record<string, unknown>;
const field = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as JsonObj)[k] : undefined), o);

/** Pyth's State holds a dynamic object field "price_info": Table<PriceIdentifier, ID>. */
async function priceTable(): Promise<{ tableId: string; idType: string }> {
  if (tableRef) return tableRef;
  const { dynamicFields } = await tatum(() => testnet.core.listDynamicFields({ parentId: env.PYTH_STATE_ID }), 'pyth:state fields');
  const f = dynamicFields.find((d) => (d.valueType ?? '').includes('::price_identifier::PriceIdentifier'));
  if (!f) throw new AppError('UPSTREAM_TATUM', 'pyth: price table not found on State', { state: env.PYTH_STATE_ID });
  const holder = await tatum(() => testnet.core.getObject({ objectId: f.fieldId, include: { json: true } }), 'pyth:price table');
  const tableId = field(holder.object.json, 'value');
  const idType = /<([^,]+::price_identifier::PriceIdentifier)/.exec(f.valueType ?? '')?.[1];
  if (typeof tableId !== 'string' || !idType) throw new AppError('UPSTREAM_TATUM', 'pyth: unexpected price table shape');
  tableRef = { tableId, idType };
  return tableRef;
}

/** PriceInfoObject id for a feed (cached; it never changes). */
export async function priceObjectFor(feedId: string): Promise<string> {
  const key = strip(feedId);
  const hit = priceObjects.get(key);
  if (hit) return hit;
  const { tableId, idType } = await priceTable();
  const name = bcs.vector(bcs.u8()).serialize(Array.from(Buffer.from(key, 'hex'))).toBytes();
  const r = await tatum(() => testnet.core.getDynamicField({ parentId: tableId, name: { type: idType, bcs: name } }), 'pyth:price object');
  const id = '0x' + Buffer.from(r.dynamicField.value.bcs).toString('hex');
  priceObjects.set(key, id);
  return id;
}

const signed = (v: unknown) => {
  const mag = BigInt(String(field(v, 'magnitude') ?? '0'));
  return field(v, 'negative') ? -mag : mag;
};
function toE8(v: bigint, expo: number): bigint {
  if (expo === -8) return v;
  if (expo > -8) return v * 10n ** BigInt(8 + expo);
  return v / 10n ** BigInt(-8 - expo);
}

/** Latest on-chain price for each feed. */
export async function latestSpots(feedIds: string[]): Promise<Map<string, Spot>> {
  const out = new Map<string, Spot>();
  for (const feedId of feedIds) {
    const priceObjectId = await priceObjectFor(feedId);
    const { object } = await tatum(() => testnet.core.getObject({ objectId: priceObjectId, include: { json: true } }), 'pyth:price');
    const p = field(object.json, 'price_info', 'price_feed', 'price');
    if (!p) throw new AppError('UPSTREAM_TATUM', 'pyth: price object has no price', { priceObjectId });
    const price = signed(field(p, 'price'));
    const expo = Number(signed(field(p, 'expo')));
    const conf = BigInt(String(field(p, 'conf') ?? '0'));
    const id = '0x' + strip(feedId);
    out.set(id, {
      feedId: id, priceObjectId,
      priceE8: toE8(price, expo), confE8: toE8(conf, expo),
      spotUsd: Number(price) * 10 ** expo,
      publishMs: Number(field(p, 'timestamp')) * 1000,
    });
  }
  return out;
}

/** Throws if the on-chain price is older than the pool allows, so we never send a tx that would abort. */
export function assertFresh(s: Spot, maxAgeS: number): void {
  const ageS = (Date.now() - s.publishMs) / 1000;
  if (ageS > maxAgeS) throw new AppError('UPSTREAM_TATUM', `pyth: on-chain price is ${Math.round(ageS)} s old (max ${maxAgeS} s)`, { feedId: s.feedId });
}
