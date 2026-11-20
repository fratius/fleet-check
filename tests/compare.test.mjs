// The automatic damage comparison (functions/src/compare.ts): which earlier photo each frame is compared with, and
// what goes to the fleet manager from the AI's answers. No AI here; the AI's side runs on the emulators
// (tests/history.test.mjs, "the AI compares every walk-around with the van's earlier photos").
//
// Run: node --import ./tests/alias.mjs --test tests/compare.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_SPOTS, cleanBox, compareSchema, confirmSchema, foundIn, grow, pickRefs, pickSpots } from '../functions/src/compare.ts';

const photo = (n, label, path = `p/${label}-${n}.jpg`, takenAt = 1000 + n) => ({ n, label, path, takenAt });
const walk = (id, createdAt, photos, extra = {}) => ({ id, createdAt, source: 'camera', photos, ...extra });

test('each frame is compared with the newest earlier photo of the same frame name', () => {
  const now = walk('w3', 3000, [photo(1, 'Front'), photo(2, 'Front left corner'), photo(3, 'Rear')]);
  const earlier = [
    walk('w1', 1000, [photo(1, 'Front', 'old/front.jpg', 900), photo(2, 'Front left corner', 'old/flc.jpg'), photo(3, 'Rear', 'old/rear.jpg')]),
    // The newer one skipped the rear: the rear is compared with the one before.
    walk('w2', 2000, [photo(1, 'Front', 'mid/front.jpg', 1900), photo(2, 'Front left corner', 'mid/flc.jpg')]),
  ];
  const refs = pickRefs(now, earlier);
  assert.deepEqual(refs.map((r) => r && `${r.walkId}:${r.path}`), ['w2:mid/front.jpg', 'w2:mid/flc.jpg', 'w1:old/rear.jpg']);
  assert.equal(refs[0].at, 1900, 'when the earlier photo was taken');
});

test('nothing to compare with: the first walk-around, later ones, library photos, deleted photos, demo drawings', () => {
  const now = walk('w2', 2000, [photo(1, 'Front')]);
  assert.deepEqual(pickRefs(now, []), [null]);
  assert.deepEqual(pickRefs(now, [walk('w9', 5000, [photo(1, 'Front')])]), [null], 'taken after this one');
  assert.deepEqual(pickRefs(now, [walk('w0', 1000, [photo(1, 'Front')], { source: 'library' })]), [null]);
  assert.deepEqual(pickRefs(now, [walk('w0', 1000, [photo(1, 'Front')], { mediaDeletedAt: 1500 })]), [null]);
  assert.deepEqual(pickRefs(now, [walk('w0', 1000, [photo(1, 'Front')], { demo: true })]), [null]);
  assert.deepEqual(pickRefs(now, [walk('w0', 1000, [{ n: 1, label: 'Front' }])]), [null], 'a photo that was never uploaded');
  assert.deepEqual(pickRefs(now, [walk('w2', 1000, [photo(1, 'Front')])]), [null], 'not with itself');
  // Another frame set (the van's type changed): frames are matched by name, not number.
  assert.deepEqual(pickRefs(now, [walk('w0', 1000, [photo(1, 'Front left corner')])]), [null]);
});

const ref = { walkId: 'w1', n: 1, label: 'Front', path: 'p.jpg', at: 1000 };
const marked = [
  { box: [0.1, 0.1, 0.2, 0.2], beforeBox: [0.1, 0.1, 0.2, 0.2], panel: 'front bumper', type: 'scratch' },
  { box: [0.5, 0.5, 0.6, 0.6], beforeBox: null, panel: 'bonnet', type: 'dent' },
  { box: [0.7, 0.7, 0.8, 0.8], beforeBox: null, panel: 'grille', type: 'crack' },
];

test('the second look decides: new damage and unclear go to the manager, old and not damage don\'t', () => {
  const out = foundIn(0, 'Front', ref, marked, {
    decisions: [
      { spot: 1, verdict: 'new', type: 'scuff', sizeCm: 7.4, severity: 'repair', confidence: 0.92, reason: 'A scuff that isn\'t in the photo before.' },
      { spot: 2, verdict: 'not_damage', type: null, sizeCm: null, severity: null, confidence: 0.8, reason: 'Reflection.' },
      { spot: 3, verdict: 'unclear', type: 'crack', sizeCm: null, severity: 'repair', confidence: 0.4, reason: 'Too dark.' },
      { spot: 9, verdict: 'new', type: 'dent', sizeCm: 3, severity: null, confidence: 1, reason: 'A spot that wasn\'t marked.' },
    ],
    more: [{ box: [0.9, 0.2, 0.95, 0.3], beforeBox: null, panel: 'right headlight', type: 'crack', sizeCm: 4, severity: 'repair', confidence: 0.7, reason: 'Cracked lens.' }],
  });
  assert.deepEqual(out.map((f) => [f.panel, f.verdict, f.type]), [
    ['front bumper', 'damage', 'scuff'], ['grille', 'unclear', 'crack'], ['right headlight', 'damage', 'crack'],
  ]);
  assert.equal(out[0].sizeCm, 7);
  assert.equal(out[0].severity, 'repair');
  assert.equal(out[1].severity, null, 'no severity for what isn\'t called damage');
  assert.equal(out[0].ref, ref);
});

test('a marked spot the answer left out still goes to the manager, as unclear', () => {
  const out = foundIn(2, 'Front', ref, marked.slice(0, 2), { decisions: [{ spot: 1, verdict: 'old', confidence: 0.9, reason: 'Was there before.' }], more: [] });
  assert.deepEqual(out.map((f) => [f.panel, f.verdict, f.frame]), [['bonnet', 'unclear', 2]]);
});

test('an answer that isn\'t one: nothing made up, the marked spots stay unclear', () => {
  assert.deepEqual(foundIn(0, 'Front', ref, [], { decisions: 'x', more: [{ box: 'nope' }] }), []);
  assert.equal(foundIn(0, 'Front', ref, marked.slice(0, 1), {}).length, 1);
});

test('at most a few spots per walk-around: new damage first, then the most confident', () => {
  const f = (verdict, confidence) => ({ verdict, confidence, panel: `${verdict} ${confidence}` });
  const picked = pickSpots([f('unclear', 0.9), f('damage', 0.5), f('damage', 0.8), ...Array.from({ length: 10 }, (_, i) => f('unclear', i / 20))]);
  assert.equal(picked.length, MAX_SPOTS);
  assert.deepEqual(picked.slice(0, 3).map((x) => x.panel), ['damage 0.8', 'damage 0.5', 'unclear 0.9']);
});

test('boxes: tidied, at least 4% wide, and grown around their middle', () => {
  assert.deepEqual(cleanBox([0.5, 0.6, 0.4, 0.3]), [0.4, 0.3, 0.5, 0.6]);
  const tiny = cleanBox([0.5, 0.5, 0.5, 0.5]);
  assert.ok(Math.abs(tiny[2] - tiny[0] - 0.04) < 1e-9 && Math.abs(tiny[3] - tiny[1] - 0.04) < 1e-9);
  assert.equal(cleanBox([1, 2]), null);
  assert.equal(cleanBox('x'), null);
  assert.deepEqual(grow([0.4, 0.4, 0.6, 0.6], 2).map((x) => Math.round(x * 100) / 100), [0.3, 0.3, 0.7, 0.7]);
  assert.deepEqual(grow([0, 0, 0.2, 0.2], 3), [0, 0, 0.4, 0.4], 'not past the photo');
});

test('the answer schemas: every property required, nothing extra (structured output)', () => {
  const check = (s, path) => {
    if (s?.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) check(v, `${path}.${k}`);
    }
    if (s?.type === 'array') check(s.items, `${path}[]`);
    for (const x of s?.anyOf || []) check(x, path);
  };
  check(compareSchema, 'compare');
  check(confirmSchema, 'confirm');
  // The emulators' stand-in for the AI (functions/src/claude.ts) tells these apart from the other answers by them.
  assert.ok('comparable' in compareSchema.properties && 'decisions' in confirmSchema.properties);
});
