/**
 * Numbers that can't be right are refused everywhere (product owner, 2026-11-26; blind test, cause 2b): km of 0 or
 * less, a fuel tank, battery or range of 0 or less, negative money, keys, sizes and weights, and a model year before
 * 1950 or after next year. The same rule is in functions/src/numbers.ts, src/lib/numbers.ts (twins: change both) and
 * firestore.rules (okVanNums, okDetailNums, okCostNums); tests/numbers.test.mjs keeps the twins the same.
 */
export const POSITIVE = ['odometerKm', 'kmAtStart', 'kmPerYear', 'serviceKm', 'rangeKm', 'tankL', 'batteryKwh'];
export const NON_NEGATIVE = ['keys', 'powerKw', 'heightM', 'lengthM', 'grossKg', 'emptyKg', 'payloadKg', 'cargoM3',
  'monthly', 'purchasePrice', 'excessPerKm', 'premium', 'deductible'];
export const MIN_YEAR = 1950;
export const maxYear = (now = Date.now()) => new Date(now).getUTCFullYear() + 1;
export type NumProblem = 'positive' | 'negative' | 'year' | null;

/** What's wrong with a number for a field (by the key's last part: due.serviceKm is serviceKm), or null. */
export function numProblem(key: string, n: number, now = Date.now()): NumProblem {
  const k = key.split('.').pop() || key;
  if (k === 'modelYear') return Number.isInteger(n) && n >= MIN_YEAR && n <= maxYear(now) ? null : 'year';
  if (POSITIVE.includes(k)) return n > 0 ? null : 'positive';
  if (NON_NEGATIVE.includes(k)) return n >= 0 ? null : 'negative';
  return null;
}
