/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). Max error ~1.5e-7. */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Probability that a zero-drift GBM price starting at S touches barrier B (< S) within T years.
 *
 * Log-price is mu*t + sigma*W_t with mu = -sigma^2/2 (so the price itself is driftless). For the
 * running minimum, P(min <= b) = Phi((b - mu T)/s) + e^(2 mu b / sigma^2) * Phi((b + mu T)/s),
 * which with mu = -sigma^2/2 gives the form below (e^(-b) = S/B).
 *
 * Deliberately conservative for this product: it ignores the "must stay below for confirmDelayMs"
 * requirement, so it over-prices slightly rather than under-reserving.
 */
export function firstPassageProb(S: number, B: number, sigma: number, T: number): number {
  if (!(S > 0 && B > 0 && sigma > 0 && T > 0)) return 0;
  if (B >= S) return 1;
  const b = Math.log(B / S);
  const s = sigma * Math.sqrt(T);
  const h = (sigma * sigma * T) / 2;
  const p = normCdf((b + h) / s) + (S / B) * normCdf((b - h) / s);
  return Math.min(1, Math.max(0, p));
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
