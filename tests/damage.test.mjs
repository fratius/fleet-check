// A van's damage record (src/lib/damage.ts): who found each damage.
//   node --import ./tests/alias.mjs --test tests/damage.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDamages } from '@/lib/damage';

const van = { id: 'v1', name: '', plate: 'B-DM 1', cls: 'large_van', stationId: 's1', createdAt: 1, createdBy: 'own' };
const walk = (id, by, at) => ({ id, vehicleId: 'v1', vehicleName: 'B-DM 1', cls: 'large_van', stationId: 's1', source: 'camera', createdAt: at, createdBy: by,
  totalMs: null, frames: 0, taken: 0, skipped: 0, retakes: 0, photos: [] });
const spot = { photo: 0, photoLabel: 'Front', box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, conf: 0.8, mightBe: null,
  closeup: '', refPath: null, closeups: [], verdict: null, feedback: null, markPath: null };
const reviewed = (id, walkId, extra) => ({
  id, vehicleId: 'v1', vehicleName: 'B-DM 1', cls: 'large_van', walkId, stationId: 's1', createdAt: 10, status: 'reviewed', tier: 'quick', model: 'm', photos: 1,
  spots: [spot], notVisible: [], missedNote: '',
  review: { decisions: { 0: { damage: true, note: '', by: 'mgr', byName: 'Max Manager', at: 11, known: null } }, manual: [], by: 'mgr', byName: 'Max Manager', at: 11 },
  ...extra,
});

// Blind test, 26 Nov 2026, cause 2 (A2): damage from a check is found by the driver who took the photos.
test('A2: damage is found by the driver who took the photos, also when the manager ran the check', () => {
  const [d] = buildDamages(van, [reviewed('k1', 'w1', { createdBy: 'mgr', createdByName: 'Max Manager', walkBy: 'dana' })], [walk('w1', 'dana', 5)]);
  assert.equal(d.foundById, 'dana');
  // The manager's name isn't put in as the finder's.
  assert.equal(d.foundBy, '');
});

test('A2: the automatic comparison (nobody ran it): the driver who took the photos', () => {
  const [d] = buildDamages(van, [reviewed('k2', 'w2', { createdBy: null, auto: 'compare', walkBy: 'dana' })], [walk('w2', 'dana', 5)]);
  assert.equal(d.foundById, 'dana');
});

test('A2: an older check without walkBy: the walk-around\'s photographer, else who ran it', () => {
  const [a] = buildDamages(van, [reviewed('k3', 'w3', { createdBy: 'mgr', createdByName: 'Max Manager' })], [walk('w3', 'dana', 5)]);
  assert.equal(a.foundById, 'dana');
  assert.equal(a.foundBy, '');
  const [b] = buildDamages(van, [reviewed('k4', 'w4', { createdBy: 'dana', createdByName: 'Dana Driver' })], []);
  assert.equal(b.foundById, 'dana');
  assert.equal(b.foundBy, 'Dana Driver');
});

test('A3: only finished reviews make the record; a reopened one is out of it until finished again', () => {
  const k = reviewed('k5', 'w5', { createdBy: 'dana', walkBy: 'dana' });
  assert.equal(buildDamages(van, [k], [walk('w5', 'dana', 5)]).length, 1);
  assert.equal(buildDamages(van, [{ ...k, status: 'submitted', reopens: [{ by: 'mgr', byName: 'Max Manager', at: 12 }] }], [walk('w5', 'dana', 5)]).length, 0);
});
