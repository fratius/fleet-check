// The walk-around outlines in perspective (src/lib/outline.ts, src/lib/shape.ts), where a photo's point lands on the
// van (src/lib/van3d.ts), and the photo check's maths (src/lib/quality.ts).
// Run: node --import ./tests/alias.mjs --test tests/outline.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLASSES, buildFrames, makeSpec, overlaySVG } from '../src/lib/frames.ts';
import { frameCam, inside, project, solid } from '../src/lib/outline.ts';
import { familyOf } from '../src/lib/shape.ts';
import { locateInFrame } from '../src/lib/van3d.ts';
import { measure } from '../src/lib/quality.ts';

const VANS = [
  ['large_van', 'Mercedes-Benz', 'Sprinter 316 CDI', 'sprinter'],
  ['large_van', 'Mercedes-Benz', 'eSprinter', 'sprinter'],
  ['large_van', 'Ford', 'Transit', 'transit'],
  ['large_van', 'Ford', 'E-Transit', 'transit'],
  ['midsize_van', 'Ford', 'Transit Custom', 'transit_custom'],
  ['compact_van', 'Ford', 'Transit Connect', 'connect'],
  ['large_van', 'Volkswagen', 'Crafter', 'crafter'],
  ['large_van', 'MAN', 'TGE', 'crafter'],
  ['large_van', 'Fiat', 'Ducato', 'ducato'],
  ['large_van', 'Citroën', 'Jumper', 'ducato'],
  ['large_van', 'Renault', 'Master', 'master'],
  ['large_van', 'Iveco', 'eDaily', 'daily'],
  ['midsize_van', 'Mercedes-Benz', 'eVito', 'vito'],
  ['midsize_van', 'Opel', 'Vivaro', 'expert'],
  ['compact_van', 'Volkswagen', 'Caddy Cargo', 'caddy'],
];

test('make and model pick the family, but only one with the class\'s body', () => {
  for (const [cls, make, model, id] of VANS) {
    const sp = makeSpec(cls, { make, model });
    assert.equal(sp.ver, 2);
    assert.equal(sp.fam?.id, id, `${make} ${model}`);
  }
  // The class wins: a Transit Custom read as a large van gets the large van's own shape.
  assert.equal(familyOf('Ford', 'Transit Custom', 'large'), null);
  assert.equal(makeSpec('large_van', { make: 'Ford', model: 'Transit Custom' }).fam, null);
  // The extra-long class takes the long version.
  assert.ok(makeSpec('large_van_long', { make: 'Mercedes-Benz', model: 'Sprinter' }).L > 6.9);
});

test('frame names stay as they were (they are stored with every photo and matched later)', () => {
  for (const c of CLASSES) {
    for (const slide of ['yes', 'no', 'unknown']) {
      const attrs = { slideL: slide, slideR: slide };
      const before = buildFrames(makeSpec(c.id, attrs, 1)).map((f) => f.label);
      const now = buildFrames(makeSpec(c.id, { ...attrs, make: 'Ford', model: 'Transit' })).map((f) => f.label);
      assert.deepEqual(now, before, c.id);
    }
  }
});

test('older photos keep the first outlines', () => {
  const sp = makeSpec('large_van', { make: 'Ford', model: 'Transit' }, 1);
  assert.equal(sp.ver, 1);
  assert.equal(sp.fam, null);
  assert.ok(!overlaySVG(sp, buildFrames(sp)[0], 3 / 4, 300).includes('viewBox="0 0 300 400"'));
});

test('every frame draws an outline, with a sensible distance to stand at', () => {
  for (const c of CLASSES) {
    const sp = makeSpec(c.id, { slideR: 'yes' });
    for (const f of buildFrames(sp)) {
      const svg = overlaySVG(sp, f, 3 / 4, 300);
      assert.ok((svg.match(/<path /g) || []).length > 10, `${c.id} ${f.label}`);
      assert.ok(!svg.includes('NaN'), `${c.id} ${f.label}`);
      assert.ok(f.dist >= 1 && f.dist <= 6, `${c.id} ${f.label}: ${f.dist} m`);
    }
  }
});

test('a point on the van seen in a photo is placed back where it is (within 3 cm)', () => {
  for (const [cls, make, model] of [VANS[0], VANS[4], VANS[8], ['car', '', ''], ['box_truck', '', '']]) {
    const sp = makeSpec(cls, { make, model, slideR: 'yes' });
    const S = solid(sp);
    let n = 0;
    for (const f of buildFrames(sp)) {
      const c = frameCam(sp, f);
      const pts = [];
      for (let x = 0.2; x < sp.L - 0.2; x += 0.35) for (let y = sp.b.sill + 0.1; y < sp.H - 0.2; y += 0.3) {
        if (inside(S, [x, y, 0], 0.03)) for (const s of [1, -1]) pts.push({ p: [x, y, s * S.hw(y)], n: [0, 0, s] });
      }
      for (let y = sp.b.sill + 0.05; y < sp.H - 0.2; y += 0.25) for (let z = -0.6; z <= 0.6; z += 0.4) {
        // Only the real ends (a box van's cab wall under the box is behind the rear wheel, not its rear).
        if (S.front(y) < 1.2) pts.push({ p: [S.front(y), y, z], n: [-1, 0, 0] });
        if (S.rear(y) > sp.L - 0.3) pts.push({ p: [S.rear(y), y, z], n: [1, 0, 0] });
      }
      for (const { p, n: nn } of pts) {
        const [u, v, z] = project(c, p);
        if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95 || z < 0.5) continue;
        const d = [p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]], len = Math.hypot(...d);
        if (-(nn[0] * d[0] + nn[1] * d[1] + nn[2] * d[2]) / len < 0.3) continue; // seen nearly edge-on
        let hidden = false;
        for (let t = 0.02; t < 0.98 && !hidden; t += 0.01) hidden = inside(S, [c.eye[0] + d[0] * t, c.eye[1] + d[1] * t, c.eye[2] + d[2] * t]);
        if (hidden) continue;
        const q = locateInFrame(sp, f, u, v).p;
        assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.03, `${cls} ${model} ${f.label}: ${p} came back as ${q}`);
        n++;
      }
    }
    assert.ok(n > 150, `${cls}: only ${n} points tested`);
  }
});

/** A made-up RGBA photo: f(x, y) gives the grey level. */
const img = (w, h, f) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = f(x, y), i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = g; px[i + 3] = 255; }
  return px;
};

test('the photo check: dark, bright, glare and blurred photos are named, a good one is not', () => {
  const W = 200, H = 260;
  // Sharp edges both ways (panel seams and a wheel), on a mid-grey van.
  const sharp = (x, y) => ((Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? 170 : 110);
  assert.deepEqual(measure(img(W, H, sharp), W, H).issues, []);
  // The same scene with no edges left.
  assert.deepEqual(measure(img(W, H, () => 140), W, H).issues, ['blur']);
  // Smeared sideways (a shaken phone): the edges across are gone, the ones along the shake are left.
  const shaken = (x, y) => 140 + 30 * Math.sin(x / 9) * (Math.floor(y / 20) % 2 ? 1 : -1);
  assert.ok(measure(img(W, H, shaken), W, H).issues.includes('blur'));
  assert.deepEqual(measure(img(W, H, (x, y) => sharp(x, y) * 0.25), W, H).issues, ['dark']);
  assert.ok(measure(img(W, H, (x, y) => Math.min(255, sharp(x, y) + 110)), W, H).issues.includes('bright'));
  const glare = measure(img(W, H, (x, y) => (x > 40 && x < 160 && y > 60 && y < 200 ? 255 : sharp(x, y))), W, H);
  assert.ok(glare.issues.includes('glare'), JSON.stringify(glare));
});
