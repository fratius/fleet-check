// The Fleet search (src/lib/vans.ts, vanMatches): typed characters in that order, in the plate or the van's own name.
// Run: node --import ./tests/alias.mjs --test tests/vans.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { vanMatches } from '../src/lib/vans.ts';

const vans = [{ plate: 'B-DX 3141' }, { plate: 'B-DX 1314' }, { plate: 'M-AB 413' }, { plate: 'HH-Q 9', name: 'Van 314' }, { plate: null, name: 'Spare' }];
const find = (q) => vans.filter((v) => vanMatches(v, q)).map((v) => v.plate || v.name);

test('digits in that order, anywhere in the plate', () => {
  assert.deepEqual(find('314'), ['B-DX 3141', 'B-DX 1314', 'HH-Q 9'], '413 has the digits, not in that order; the own name counts');
  assert.deepEqual(find('3141'), ['B-DX 3141']);
});

test('spaces, dashes and capitals don\'t matter', () => {
  assert.deepEqual(find('dx 31'), ['B-DX 3141']);
  assert.deepEqual(find('b-dx1'), ['B-DX 1314']);
  assert.deepEqual(find('mab'), ['M-AB 413']);
});

test('nothing typed shows every van; no match shows none', () => {
  assert.equal(find('').length, vans.length);
  assert.equal(find(' - ').length, vans.length);
  assert.deepEqual(find('777'), []);
});
