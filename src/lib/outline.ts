/**
 * The walk-around outlines in perspective (Spec.ver 2): a 3D line drawing of the van (body edges, wheel arches,
 * wheels, doors, windows, lights, grille, bumpers, mirrors) seen through a phone camera standing where the driver
 * stands for each frame. Lines on the far side of the van or hidden behind it are left out, so the outline looks
 * like the van in front of the camera, not like a flat drawing.
 *
 * World coordinates are metres: x along the length (0 = front bumper), y up, z across (+ = the van's left side).
 * The picture is the portrait 3:4 camera box: u across (0..1), v down (0..1).
 *
 * Only types come from frames.ts (it imports this file).
 */
import type { Frame, Spec } from './frames';

export type V3 = [number, number, number];
type P2 = [number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Phone main camera (about 26 mm equivalent, 4:3), held upright: field of view across and up. */
const HFOV = (53.1 * Math.PI) / 180, VFOV = (67.3 * Math.PI) / 180;
const FX = 0.5 / Math.tan(HFOV / 2), FY = 0.5 / Math.tan(VFOV / 2);
/** Where the phone is held. */
const EYE_Y = 1.45;
/** Share of the camera box the framed part of the van fills. */
export const FILL = 0.82;

/* ---------- the body as a solid: what hides what ---------- */

interface Solid { H: number; rows: number[][]; step: number; hw: (y: number) => number; front: (y: number) => number; rear: (y: number) => number }
const solids = new WeakMap<Spec, Solid>();
/** The van's body for hidden-line tests: the side profile pushed across its width (narrower above the windows). */
export function solid(sp: Spec): Solid {
  let s = solids.get(sp);
  if (s) return s;
  const pts = sp.b.pts, n = pts.length, f = sp.b.face;
  const H = Math.max(...pts.map((p) => p[1])), step = 0.01;
  const rows: number[][] = [];
  for (let k = 0; k * step <= H + step; k++) {
    const y = k * step + step / 2, xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    rows.push(xs.sort((p, q) => p - q));
  }
  const W2 = sp.W / 2;
  const hw = (y: number) => (y <= f.belt ? W2 : W2 * (1 - (1 - f.top) * clamp((y - f.belt) / Math.max(0.1, sp.H - f.belt), 0, 1)));
  const row = (y: number) => rows[clamp(Math.floor(y / step), 0, rows.length - 1)];
  const front = (y: number) => row(y)[0] ?? 0, rear = (y: number) => { const r = row(y); return r[r.length - 1] ?? sp.L; };
  s = { H, rows, step, hw, front, rear };
  solids.set(sp, s);
  return s;
}
/** Inside the body, a little in from its surface (so lines on the surface don't hide themselves). */
export function inside(s: Solid, p: V3, e = 0.012): boolean {
  const [x, y, z] = p;
  if (y <= e || y >= s.H - e) return false;
  if (Math.abs(z) >= s.hw(y) - e) return false;
  const xs = s.rows[Math.floor(y / s.step)];
  if (!xs) return false;
  for (let i = 0; i + 1 < xs.length; i += 2) if (x > xs[i] + e && x < xs[i + 1] - e) return true;
  return false;
}

/* ---------- the line drawing ---------- */

/** One line of the drawing: points, the normals of the surfaces it lies on (seen when any faces the camera), weight. */
interface Ln { pts: V3[]; ns: V3[]; w: 0 | 1 | 2; dash?: boolean }

const lines3 = new WeakMap<Spec, Ln[]>();
/** Splits a polyline so no piece is longer than `d` (perspective bends what is straight in the drawing's plane). */
function dense(pts: V3[], closed: boolean, d = 0.05): V3[] {
  const src = closed ? [...pts, pts[0]] : pts, out: V3[] = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / d));
    for (let j = 1; j <= k; j++) out.push(add(a, mul(sub(b, a), j / k)));
  }
  return out;
}
const circle = (cx: number, cy: number, z: number, r: number, k = 28): V3[] =>
  Array.from({ length: k + 1 }, (_, i) => [cx + r * Math.cos((i / k) * Math.PI * 2), cy + r * Math.sin((i / k) * Math.PI * 2), z] as V3);

export function lineModel(sp: Spec): Ln[] {
  const cached = lines3.get(sp);
  if (cached) return cached;
  const b = sp.b, x = b.x, S = solid(sp), pts = b.pts, n = pts.length;
  const out: Ln[] = [];
  const area = pts.reduce((a, p, i) => { const q = pts[(i + 1) % n]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
  const sgn = area > 0 ? 1 : -1;
  const edgeN = pts.map((p, i) => { const q = pts[(i + 1) % n]; return norm([sgn * (q[1] - p[1]), -sgn * (q[0] - p[0]), 0]); });
  const hw = S.hw;
  // Body edges: the profile on each side, where the side meets the front, roof, rear and bottom.
  for (const s of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push({ pts: dense([[p[0], p[1], s * hw(p[1])], [q[0], q[1], s * hw(q[1])]], false), ns: [[0, 0, s], edgeN[i]], w: 0 });
    }
  }
  // Creases across the width (top of the bumper, the bonnet's front edge, the windscreen's bottom and top, the roof's ends).
  // Not round the wheel arches (their creases would cross the wheels).
  const archR = x?.arch ?? b.r + 0.06;
  const inArch = (p: P2) => p[1] <= b.r + archR + 0.01 && b.wheels.some((wx) => Math.abs(p[0] - wx) <= archR + 0.01);
  for (let i = 0; i < n; i++) {
    const a = edgeN[(i - 1 + n) % n], c = edgeN[i], p = pts[i];
    if (inArch(p) || dot(a, c) > Math.cos((18 * Math.PI) / 180)) continue;
    out.push({ pts: dense([[p[0], p[1], hw(p[1])], [p[0], p[1], -hw(p[1])]], false, 0.08), ns: [a, c], w: 1 });
  }
  const sideZ = (s: number, y: number) => s * (hw(y) + 0.005);
  const onSide = (s: number, p: P2[], closed: boolean, w: 0 | 1 | 2, dash?: boolean) =>
    out.push({ pts: dense(p.map(([px, py]) => [px, py, sideZ(s, py)] as V3), closed), ns: [[0, 0, s]], w, dash });
  // The front and rear surfaces at height y (the profile's first and last crossing), and their outward normal there.
  const endN = (front: boolean, y: number): V3 => {
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) continue;
      const xx = p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      if (Math.abs(xx - (front ? S.front(y) : S.rear(y))) < 0.02) return edgeN[i];
    }
    return [front ? -1 : 1, 0, 0];
  };
  const onEnd = (front: boolean, p: P2[], closed: boolean, w: 0 | 1 | 2) => {
    const d = dense(p.map(([pz, py]) => [0, py, pz] as V3), closed, 0.03)
      .map(([, py, pz]) => [front ? S.front(py) - 0.006 : S.rear(py) + 0.006, py, pz] as V3);
    const mid = d[Math.floor(d.length / 2)][1];
    out.push({ pts: d, ns: [endN(front, mid)], w });
  };
  const mirrorZ = (p: P2[]): P2[] => p.map(([z, y]) => [-z, y]);

  for (const s of [1, -1]) {
    const side = s > 0 ? 'left' : 'right';
    onSide(s, b.glass, true, 1);
    (x?.seams ?? b.doors.map(([dx, dy]) => [[dx, b.sill + 0.04], [dx, dy]] as P2[])).forEach((sm) => onSide(s, sm, false, 1));
    if (b.slide && sp.slide[side] !== 'no' && (sp.body === 'compact' || sp.body === 'mid' || sp.body === 'large')) {
      const z = b.slide, y0 = b.sill + 0.06, c = 0.05;
      onSide(s, [[z.x, y0], [z.x + z.w, y0], [z.x + z.w, z.top - c], [z.x + z.w - c, z.top], [z.x + c, z.top], [z.x, z.top - c]], true, 1, sp.slide[side] === 'unknown');
      if (x?.rail && sp.slide[side] === 'yes') onSide(s, [[z.x + z.w + 0.02, x.rail], [sp.L - 0.3, x.rail]], false, 2);
      if (x && sp.slide[side] === 'yes') onSide(s, [[z.x + 0.1, b.face.belt - 0.1], [z.x + 0.28, b.face.belt - 0.1]], false, 1);
    }
    if (x?.handle) onSide(s, [x.handle, [x.handle[0] + 0.18, x.handle[1]]], false, 1);
    if (x) {
      const [w0, w1] = [b.wheels[0], b.wheels[b.wheels.length - 1]];
      const ext = (wx: number, y: number) => { const d = Math.sqrt(Math.max(0, x.arch * x.arch - (y - b.r) ** 2)); return [wx - d, wx + d]; };
      if (x.trim != null) onSide(s, [[ext(w0, x.trim)[1], x.trim], [ext(w1, x.trim)[0], x.trim]], false, 2);
      // Bumpers where they reach the side: from the nose to the front arch, from the rear arch to the back.
      if (x.bumperTop < b.r + x.arch) onSide(s, [[S.front(x.bumperTop) + 0.01, x.bumperTop], [ext(w0, x.bumperTop)[0], x.bumperTop]], false, 1);
      if (x.rearBumperTop < b.r + x.arch) onSide(s, [[ext(w1, x.rearBumperTop)[1], x.rearBumperTop], [S.rear(x.rearBumperTop) - 0.01, x.rearBumperTop]], false, 1);
      if (x.lampSide) onSide(s, x.lampSide, true, 1);
      const m = x.mirror;
      if (m) {
        const z0 = s * (hw(m.y0) + 0.03), z1 = s * (hw(m.y0) + m.out);
        out.push({ pts: dense([[m.x0, m.y0, z0], [m.x0, m.y0, z1], [m.x0, m.y1, z1], [m.x0, m.y1, z0]], true, 0.03), ns: [[-1, 0, 0]], w: 1 });
        out.push({ pts: dense([[m.x0, m.y0, z1], [m.x1, m.y0, z1], [m.x1, m.y1, z1], [m.x0, m.y1, z1]], true, 0.03), ns: [[0, 0, s]], w: 1 });
      }
    }
    // Wheels: the tyre and the rim, just inside the body side.
    b.wheels.forEach((wx) => {
      const z = s * (sp.W / 2 - 0.03);
      out.push({ pts: circle(wx, b.r, z, b.r), ns: [[0, 0, s]], w: 0 });
      out.push({ pts: circle(wx, b.r, z + s * 0.01, b.r * 0.62, 22), ns: [[0, 0, s]], w: 2 });
    });
  }
  if (x) {
    const F = x.front, R = x.rear;
    onEnd(true, F.lamp, true, 1); onEnd(true, mirrorZ(F.lamp), true, 1);
    onEnd(true, F.grille, true, 1);
    if (F.intake) onEnd(true, F.intake, true, 2);
    onEnd(true, [[-0.26, F.plate - 0.055], [0.26, F.plate - 0.055], [0.26, F.plate + 0.055], [-0.26, F.plate + 0.055]], true, 2);
    const [s0, s1] = F.screen, ya = s0 + 0.05, yb = s1 - 0.05;
    onEnd(true, [[hw(ya) - 0.1, ya], [hw(yb) - 0.14, yb], [-(hw(yb) - 0.14), yb], [-(hw(ya) - 0.1), ya]], true, 1);
    const [t0, t1, tw] = R.tail;
    for (const s of [1, -1]) onEnd(false, [[s * (hw(t0) - 0.03), t0], [s * (hw(t0) - 0.03 - tw), t0], [s * (hw(t1) - 0.03 - tw), t1], [s * (hw(t1) - 0.03), t1]], true, 1);
    const [d0, d1] = R.doors, dz = (y: number) => hw(y) - 0.06 - tw;
    if (sp.rear === 'barn' || sp.rear === 'roller') {
      onEnd(false, [[dz(d0), d0], [dz(d1), d1], [-dz(d1), d1], [-dz(d0), d0]], true, 1);
      if (sp.rear === 'barn') onEnd(false, [[0, d0], [0, d1]], false, 1);
      else for (let y = d0 + 0.25; y < d1 - 0.05; y += 0.25) onEnd(false, [[dz(y) - 0.02, y], [-dz(y) + 0.02, y]], false, 2);
    } else if (sp.rear === 'tailgate') {
      const g0 = b.face.belt + 0.06, g1 = Math.min(sp.H - 0.08, b.face.glassTop);
      if (b.face.rearKind === 'greenhouse') onEnd(false, [[hw(g0) - 0.16, g0], [hw(g1) - 0.18, g1], [-(hw(g1) - 0.18), g1], [-(hw(g0) - 0.16), g0]], true, 1);
      onEnd(false, [[dz(d0), d0], [dz(d1), d1], [-dz(d1), d1], [-dz(d0), d0]], true, 2);
    } else {
      onEnd(false, [[dz(d0), d0], [dz(d1), d1], [-dz(d1), d1], [-dz(d0), d0]], true, 1);
    }
    onEnd(false, [[-hw(x.rearBumperTop) + 0.02, x.rearBumperTop], [hw(x.rearBumperTop) - 0.02, x.rearBumperTop]], false, 1);
    onEnd(false, [[-0.26, R.plate - 0.055], [0.26, R.plate - 0.055], [0.26, R.plate + 0.055], [-0.26, R.plate + 0.055]], true, 2);
  }
  lines3.set(sp, out);
  return out;
}

/* ---------- the camera of each frame ---------- */

export interface FrameCam {
  eye: V3; fwd: V3; right: V3; up: V3;
  /** Shift that centres the framed part in the box (a slight turn of the phone). */
  du: number; dv: number;
  /** About how far the driver stands from the nearest part of the van, in metres. */
  dist: number;
}
/** Where on the box a point is: u across, v down, and its depth. */
export function project(c: FrameCam, p: V3): [number, number, number] {
  const d = sub(p, c.eye), z = dot(d, c.fwd);
  return [0.5 + (FX * dot(d, c.right)) / z + c.du, 0.5 - (FY * dot(d, c.up)) / z + c.dv, z];
}
/** The ray from the camera through a point of the box. */
export function ray(c: FrameCam, u: number, v: number): V3 {
  const X = (u - c.du - 0.5) / FX, Y = (0.5 - (v - c.dv)) / FY;
  return norm(add(c.fwd, add(mul(c.right, X), mul(c.up, Y))));
}

/** The parts of the van a frame must show (what the outline is fitted to). */
function framed(sp: Spec, f: Pick<Frame, 'kind' | 'side' | 'seg' | 'corner'>): V3[] {
  const S = solid(sp), pts = sp.b.pts, L = sp.L, hw = S.hw;
  const out: V3[] = [];
  const at = (x: number, y: number, s: number): V3 => [x, y, s * hw(y)];
  const topAt = (x: number) => { let t = 0; for (let y = S.H; y > 0; y -= 0.02) if (inside(S, [x, y, 0], 0)) { t = y; break; } return t; };
  const strip = (x0: number, x1: number, s: number) => {
    pts.filter((p) => p[0] >= x0 && p[0] <= x1).forEach((p) => out.push(at(p[0], p[1], s)));
    for (const xx of [x0, x1]) { out.push(at(xx, 0.02, s), at(xx, topAt(xx), s)); }
  };
  const end = (front: boolean) => {
    for (let y = 0.05; y < S.H; y += 0.05) for (const s of [1, -1]) out.push([front ? S.front(y) : S.rear(y), y, s * hw(y)]);
    const m = sp.b.x?.mirror;
    if (front && m) for (const s of [1, -1]) out.push([m.x0, m.y1, s * (hw(m.y0) + m.out)]);
    for (const s of [1, -1]) out.push([front ? 0.4 : L - 0.4, 0, s * sp.W / 2]);
  };
  if (f.kind === 'front' || f.kind === 'rear') end(f.kind === 'front');
  else if (f.kind === 'side') {
    const s = f.side === 'left' ? 1 : -1, a = f.seg![1] * L, b = f.seg![2] * L;
    strip(a, b, s);
  } else {
    const front = f.corner === 'fl' || f.corner === 'fr', s = f.corner === 'fl' || f.corner === 'rl' ? 1 : -1;
    for (let y = 0.05; y < S.H; y += 0.05) out.push([front ? S.front(y) : S.rear(y), y, s * hw(y)], [front ? S.front(y) : S.rear(y), y, -s * hw(y) * 0.6]);
    strip(front ? 0 : L - 2.4, front ? 2.4 : L, s);
  }
  return out;
}
/** The direction the camera looks from (outward from the van) for a frame. */
function viewDir(f: Pick<Frame, 'kind' | 'side' | 'corner'>): V3 {
  if (f.kind === 'front') return [-1, 0, 0];
  if (f.kind === 'rear') return [1, 0, 0];
  if (f.kind === 'side') return [0, 0, f.side === 'left' ? 1 : -1];
  const c = f.corner;
  return norm([c === 'fl' || c === 'fr' ? -1 : 1, 0, c === 'fl' || c === 'rl' ? 1 : -1]);
}
function camAt(target: V3, dir: V3, d: number): FrameCam {
  const eye: V3 = [target[0] + dir[0] * d, EYE_Y, target[2] + dir[2] * d];
  const fwd = norm(sub(target, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  return { eye, fwd, right, up, du: 0, dv: 0, dist: d };
}
const cams = new WeakMap<Spec, Map<string, FrameCam>>();
/** The camera that sees the frame's part of the van filling FILL of the box, centred. */
export function frameCam(sp: Spec, f: Pick<Frame, 'kind' | 'side' | 'seg' | 'corner'>): FrameCam {
  const key = `${f.kind}:${f.side}:${f.seg?.[1]}:${f.seg?.[2]}:${f.corner}`;
  let m = cams.get(sp);
  if (!m) { m = new Map(); cams.set(sp, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const P = framed(sp, f), dir = viewDir(f);
  const target = mul(P.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / P.length);
  const box = (c: FrameCam) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of P) { const [u, v] = project(c, p); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    return { u0, u1, v0, v1, size: Math.max(u1 - u0, v1 - v0) };
  };
  // The nearest point must stay well in front of the camera; then the distance at which the part fills FILL.
  const near = Math.max(...P.map((p) => dot(sub(p, target), dir)));
  let lo = near + 0.6, hi = 30;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (box(camAt(target, dir, mid)).size > FILL) lo = mid; else hi = mid; }
  const c = camAt(target, dir, hi), bb = box(c);
  c.du = 0.5 - (bb.u0 + bb.u1) / 2;
  c.dv = 0.5 - (bb.v0 + bb.v1) / 2;
  // How far from the van, measured on the ground to the nearest framed point.
  c.dist = Math.min(...P.map((p) => Math.hypot(p[0] - c.eye[0], p[2] - c.eye[2])));
  m.set(key, c);
  return c;
}

/* ---------- drawing ---------- */

type Run = { d: string; w: 0 | 1 | 2; dash?: boolean };
const runsCache = new WeakMap<FrameCam, Run[]>();
/** Visible runs of each line, projected into the 300 x 400 box (worked out once per frame: the camera screen redraws often). */
function visibleRuns(sp: Spec, c: FrameCam): Run[] {
  const hit = runsCache.get(c);
  if (hit) return hit;
  const runs = findRuns(sp, c);
  runsCache.set(c, runs);
  return runs;
}
function findRuns(sp: Spec, c: FrameCam): Run[] {
  const S = solid(sp), out: Run[] = [];
  const seen = (p: V3) => {
    // Something of the body between the camera and the point hides it.
    const d = sub(p, c.eye), len = Math.hypot(d[0], d[1], d[2]), k = Math.max(4, Math.ceil(len / 0.06));
    for (let j = 1; j < k; j++) {
      const t = j / k;
      if ((1 - t) * len < 0.035) break;
      if (inside(S, add(c.eye, mul(d, t)))) return false;
    }
    return true;
  };
  for (const l of lineModel(sp)) {
    const mid = l.pts[Math.floor(l.pts.length / 2)];
    if (!l.ns.some((nn) => dot(nn, norm(sub(c.eye, mid))) > 0.03)) continue;
    let run: string[] = [];
    const flush = () => { if (run.length > 1) out.push({ d: 'M' + run.join(' L'), w: l.w, dash: l.dash }); run = []; };
    for (const p of l.pts) {
      const [u, v, z] = project(c, p);
      if (z < 0.2 || !seen(p)) { flush(); continue; }
      run.push(`${r1(u * 300)} ${r1(v * 400)}`);
    }
    flush();
  }
  return out;
}
/** The ground under the framed side or end, as a dashed guide. */
function groundLine(sp: Spec, f: Frame, c: FrameCam): string {
  const segs: V3[][] = [];
  const W2 = sp.W / 2;
  if (f.kind === 'side') { const s = f.side === 'left' ? 1 : -1; segs.push([[-4, 0, s * W2], [sp.L + 4, 0, s * W2]]); }
  else if (f.kind === 'front' || f.kind === 'rear') { const x = f.kind === 'front' ? 0.05 : sp.L - 0.05; segs.push([[x, 0, -4], [x, 0, 4]]); }
  else {
    const front = f.corner === 'fl' || f.corner === 'fr', s = f.corner === 'fl' || f.corner === 'rl' ? 1 : -1, x = front ? 0.05 : sp.L - 0.05;
    segs.push([[x, 0, s * W2], [x, 0, -s * 4]], [[x, 0, s * W2], [front ? sp.L : 0, 0, s * W2]]);
  }
  let d = '';
  for (const sg of segs) {
    let run: string[] = [];
    for (const p of dense(sg, false, 0.1)) {
      const [u, v, z] = project(c, p);
      if (z < 0.3) { if (run.length > 1) d += 'M' + run.join(' L'); run = []; continue; }
      run.push(`${r1(u * 300)} ${r1(v * 400)}`);
    }
    if (run.length > 1) d += 'M' + run.join(' L');
  }
  return d;
}

export interface OPaint { line: string; halo: string | null; body: number; detail: number; faint: number; faintOpacity: number; ground: string }
export const OVERLAY_PAINT: OPaint = { line: '#E2FF1C', halo: '#000000', body: 2.6, detail: 1.7, faint: 1.2, faintOpacity: 0.7, ground: '#FFFFFF' };
export const THUMB_PAINT: OPaint = { line: '#E2FF1C', halo: null, body: 1.5, detail: 1, faint: 0.8, faintOpacity: 0.6, ground: '#FFFFFF' };

/** The outline as SVG paths for a box `pxW` pixels wide (300 x 400 units). */
export function outlinePaths(sp: Spec, f: Frame, pxW: number, p: OPaint): string {
  const c = frameCam(sp, f), u = 300 / pxW, runs = visibleRuns(sp, c);
  const width = (w: 0 | 1 | 2) => (w === 0 ? p.body : w === 1 ? p.detail : p.faint);
  const pass = (color: string, extra: number, opacityScale: number) => runs.map((r) =>
    `<path d="${r.d}" fill="none" stroke="${color}" stroke-width="${r3((width(r.w) + extra) * u)}" stroke-linejoin="round" stroke-linecap="round"`
    + (r.w === 2 ? ` stroke-opacity="${r3(p.faintOpacity * opacityScale)}"` : opacityScale !== 1 ? ` stroke-opacity="${opacityScale}"` : '')
    + (r.dash ? ` stroke-dasharray="${r3(5 * u)} ${r3(4 * u)}"` : '') + '/>').join('');
  const g = groundLine(sp, f, c);
  return (g ? `<path d="${g}" fill="none" stroke="${p.ground}" stroke-opacity="0.5" stroke-width="${r3(1.4 * u)}" stroke-dasharray="${r3(6 * u)} ${r3(6 * u)}"/>` : '')
    + (p.halo ? pass(p.halo, 3, 0.45) : '') + pass(p.line, 0, 1);
}
