// Numbers that can't be right (blind test, 26 Nov 2026, cause 2b, B3 and B6): the app's rule and the server's are
// twins (src/lib/numbers.ts, functions/src/numbers.ts), and firestore.rules holds the same fields.
//   node --import ./tests/alias.mjs --test tests/numbers.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { NON_NEGATIVE, POSITIVE, maxYear, numProblem } from '@/lib/numbers';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the app and the server have the same rule', () => {
  assert.equal(read('../src/lib/numbers.ts'), read('../functions/src/numbers.ts'));
});

test('B3: km of 0 or less are refused; B6: a tank, battery or range of 0 or less, negative money, keys and sizes, and model years out of range', () => {
  for (const k of ['odometerKm', 'kmAtStart', 'kmPerYear', 'due.serviceKm']) {
    assert.equal(numProblem(k, 0), 'positive', k);
    assert.equal(numProblem(k, -5), 'positive', k);
    assert.equal(numProblem(k, 1), null, k);
  }
  for (const k of ['tankL', 'batteryKwh', 'rangeKm']) assert.equal(numProblem(k, 0), 'positive', k);
  for (const [k, n] of [['keys', -3], ['monthly', -840], ['purchasePrice', -500], ['purchasePrice', -1], ['heightM', -2.7]]) assert.equal(numProblem(k, n), 'negative', k);
  for (const [k, n] of [['keys', 0], ['purchasePrice', 0], ['monthly', 840]]) assert.equal(numProblem(k, n), null, k);
  const now = Date.UTC(2026, 10, 26);
  assert.equal(numProblem('modelYear', 1066, now), 'year');
  assert.equal(numProblem('modelYear', 1949, now), 'year');
  assert.equal(numProblem('modelYear', 2028, now), 'year');
  assert.equal(numProblem('modelYear', 2027, now), null);
  assert.equal(numProblem('modelYear', 2026.5, now), 'year');
  assert.equal(maxYear(now), 2027);
  // Text fields and others are left alone.
  assert.equal(numProblem('vin', -1), null);
});

test('firestore.rules checks every one of these fields', () => {
  const rules = read('../firestore.rules');
  for (const k of [...POSITIVE, ...NON_NEGATIVE, 'modelYear']) assert.match(rules, new RegExp(`'${k}'`), k);
});
