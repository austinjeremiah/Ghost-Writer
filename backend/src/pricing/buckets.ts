// Coarse buckets are what memory is keyed on: a case or rule learned at "SUI, high vol, 10-15% below
// spot" has to apply to the next similar quote, not only to an identical one.
export type VolBucket = 'low' | 'mid' | 'high';
export type MoneyBucket = '0-5' | '5-10' | '10-15' | '15-25' | '25+';
export type DurBucket = '1-3d' | '4-7d' | '8-30d';

export const volBucket = (sigmaAnnual: number): VolBucket =>
  sigmaAnnual < 0.5 ? 'low' : sigmaAnnual < 0.9 ? 'mid' : 'high';

export function moneyBucket(spot: number, trigger: number): MoneyBucket {
  // Rounded before comparing: 1 - 0.9/1 is 0.09999999999999998 in binary floating point, which would
  // put a trigger exactly 10% below spot in the 5-10 bucket. The bucket IS the memory key, so a
  // boundary quote keying to the wrong bucket would recall the wrong cases.
  const d = Math.round((1 - trigger / spot) * 1e6) / 1e6;
  return d < 0.05 ? '0-5' : d < 0.10 ? '5-10' : d < 0.15 ? '10-15' : d < 0.25 ? '15-25' : '25+';
}

export const durBucket = (days: number): DurBucket => (days <= 3 ? '1-3d' : days <= 7 ? '4-7d' : '8-30d');

/** Mid-point distance of a money bucket, used when back-testing a bucket rather than one quote. */
export const moneyBucketMid: Record<MoneyBucket, number> = {
  '0-5': 0.03, '5-10': 0.075, '10-15': 0.125, '15-25': 0.20, '25+': 0.30,
};
/** Representative horizon in days for a duration bucket. */
export const durBucketDays: Record<DurBucket, number> = { '1-3d': 2, '4-7d': 7, '8-30d': 14 };
