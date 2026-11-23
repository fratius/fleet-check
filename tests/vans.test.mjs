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

test('people: name in that order, accents and capitals ignored; Transporter ID; phone digits', async () => {
  const { personMatches } = await import('../src/lib/vans.ts');
  const people = [
    { name: 'Ana Pop', phone: '+49 151 2345678', transporterId: 'A1B2C3D4' },
    { name: 'Ioana Popescu' }, { name: 'Ștefan Ionescu', transporterId: 'ZZ9' }, { name: 'Max Mustermann' },
  ];
  const find = (q) => people.filter((p) => personMatches(p, q)).map((p) => p.name);
  assert.deepEqual(find('ana p'), ['Ana Pop', 'Ioana Popescu']);
  assert.deepEqual(find('STEFAN'), ['Ștefan Ionescu'], 'ș typed as s');
  assert.deepEqual(find('pop ana'), [], 'the words in that order');
  assert.deepEqual(find('b2c3'), ['Ana Pop'], 'Transporter ID');
  assert.deepEqual(find('2345'), ['Ana Pop'], 'phone digits');
  assert.deepEqual(find('12'), [], 'two digits are too few for a phone search');
  assert.equal(find('').length, 4);
});
