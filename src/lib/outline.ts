/**
 * The walk-around outlines in perspective (Spec.ver 2 and 3): the van seen through a phone camera standing where
 * the driver stands for each frame.
 *
 * What is drawn (since ver 3, after the first photos from a real yard): one line round the van as the camera sees
 * it (its silhouette, wheels included), and only the landmarks a driver lines up by: the windows, the lights and
 * the wheels. No door seams, bumpers, plates, trims or ground lines: they never matched a real van closely enough
 * and hid the van behind lines. The body has rounded corners seen from above (a real van is no box), which is
 * what makes the corner views match.
 *
 * World coordinates are metres: x along the length (0 = front bumper), y up, z across (+ = the van's left side).
 * The picture is the portrait 3:4 camera box: u across (0..1), v down (0..1).
 *
 * The shapes and cameras of each earlier version stay as they were (2: sharp corners; 3: every frame upright):
 * photos taken with them are placed on the van by them.
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

/** Phone main camera (about 26 mm equivalent, 4:3): field of view along its short and its long side. */
const SHORT = 0.5 / Math.tan(((53.1 * Math.PI) / 180) / 2), LONG = 0.5 / Math.tan(((67.3 * Math.PI) / 180) / 2);
/** Where the phone is held. */
const EYE_Y = 1.45;
/** Share of the camera box the framed part of the van fills. */
export const FILL = 0.82;

/* ---------- the body as a solid ---------- */

interface Solid {
  H: number; rows: number[][]; step: number;
  /** Half the width at height y; with x, also narrowed by the rounded corners near the front and rear. */
  hw: (y: number, x?: number) => number;
  front: (y: number) => number; rear: (y: number) => number;
  /** Corner radius seen from above, front and rear (0 for ver 2), and where the body starts and ends. */
  rf: number; rr: number; x0: number; x1: number;
}
/** How round the corners are seen from above, per body: front, rear (metres). */
const ROUND: Record<string, [number, number]> = {
  car: [0.45, 0.3], suv: [0.42, 0.25], pickup: [0.36, 0.1], compact: [0.34, 0.14], mid: [0.4, 0.16], large: [0.42, 0.12], step: [0.15, 0.06], box: [0.3, 0.04],
};
const solids = new WeakMap<Spec, Solid>();
/** The van's body: the side profile pushed across its width (narrower above the windows, rounded at the corners). */
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
  const W2 = sp.W / 2, x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  const [rf, rr] = sp.ver >= 3 ? ROUND[sp.body] || [0.3, 0.1] : [0, 0];
  const row = (y: number) => rows[clamp(Math.floor(y / step), 0, rows.length - 1)];
  const base = (y: number) => (y <= f.belt ? W2 : W2 * (1 - (1 - f.top) * clamp((y - f.belt) / Math.max(0.1, sp.H - f.belt), 0, 1)));
  // How much a quarter circle of radius R takes off the width, t metres into the corner.
  const cut = (R: number, t: number) => (t <= 0 || R <= 0 ? 0 : R - Math.sqrt(Math.max(0, R * R - Math.min(t, R) ** 2)));
  const hw = (y: number, x?: number) => {
    const w = base(y);
    if (x == null || (!rf && !rr)) return w;
    return Math.max(w * 0.4, w - cut(rf, rf - (x - x0)) - cut(rr, rr - (x1 - x)));
  };
  const front = (y: number) => row(y)[0] ?? 0, rear = (y: number) => { const r = row(y); return r[r.length - 1] ?? sp.L; };
  s = { H, rows, step, hw, front, rear, rf, rr, x0, x1 };
  solids.set(sp, s);
  return s;
}
/** Inside the body, a little in from its surface (so lines on the surface don't hide themselves). */
export function inside(s: Solid, p: V3, e = 0.012): boolean {
  const [x, y, z] = p;
  if (y <= e || y >= s.H - e) return false;
  if (Math.abs(z) >= s.hw(y, x) - e) return false;
  const xs = s.rows[Math.floor(y / s.step)];
  if (!xs) return false;
  for (let i = 0; i + 1 < xs.length; i += 2) if (x > xs[i] + e && x < xs[i + 1] - e) return true;
  return false;
}
/** Where the front or rear surface is at height y, z across (it curves back round the corners). */
function endX(S: Solid, front: boolean, y: number, z: number): number {
  const R = front ? S.rf : S.rr, a = Math.abs(z) - (S.hw(y) - R);
  const d = R <= 0 || a <= 0 ? 0 : R - Math.sqrt(Math.max(0, R * R - Math.min(a, R) ** 2));
  return front ? Math.max(S.front(y), S.x0 + d) : Math.min(S.rear(y), S.x1 - d);
}

/* ---------- the landmarks: windows, lights, wheels ---------- */

/** One landmark line. `see`: from where it shows (a side's lines from that side, the front's from ahead of the van). */
interface Ln { pts: V3[]; see: 'left' | 'right' | 'front' | 'rear' }

/** Splits a polyline so no piece is longer than `d` (perspective bends what is straight in the drawing's plane). */
function dense<T extends number[]>(pts: T[], closed: boolean, d = 0.05): T[] {
  const src = closed ? [...pts, pts[0]] : pts, out: T[] = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i], k = Math.max(1, Math.ceil(Math.hypot(...b.map((v, j) => v - a[j])) / d));
    for (let j = 1; j <= k; j++) out.push(a.map((v, q) => v + ((b[q] - v) * j) / k) as T);
  }
  return out;
}
const lines3 = new WeakMap<Spec, Ln[]>();
function landmarks(sp: Spec): Ln[] {
  const cached = lines3.get(sp);
  if (cached) return cached;
  const b = sp.b, x = b.x, S = solid(sp), out: Ln[] = [];
  const onSide = (s: number, p: P2[]) =>
    out.push({ pts: dense(p, true).map(([px, py]) => [px, py, s * (S.hw(py, px) + 0.006)] as V3), see: s > 0 ? 'left' : 'right' });
  // Points are (z across, y up) on the front or rear surface.
  const onEnd = (front: boolean, p: P2[]) =>
    out.push({ pts: dense(p, true, 0.03).map(([pz, py]) => [endX(S, front, py, pz) + (front ? -0.006 : 0.006), py, pz] as V3), see: front ? 'front' : 'rear' });
  const flip = (p: P2[]): P2[] => p.map(([z, y]) => [-z, y]);
  for (const s of [1, -1]) {
    onSide(s, b.glass);
    if (x?.lampSide && !S.rf) onSide(s, x.lampSide);
    b.wheels.forEach((wx) => out.push({
      pts: Array.from({ length: 33 }, (_, i) => [wx + b.r * Math.cos((i / 32) * Math.PI * 2), b.r + b.r * Math.sin((i / 32) * Math.PI * 2), s * (sp.W / 2 - 0.03)] as V3),
      see: s > 0 ? 'left' : 'right',
    }));
  }
  if (x) {
    const F = x.front, hw = S.hw;
    onEnd(true, F.lamp); onEnd(true, flip(F.lamp));
    const ya = F.screen[0] + 0.05, yb = F.screen[1] - 0.05;
    onEnd(true, [[hw(ya) - 0.1, ya], [hw(yb) - 0.14, yb], [-(hw(yb) - 0.14), yb], [-(hw(ya) - 0.1), ya]]);
    const [t0, t1, tw] = x.rear.tail;
    for (const s of [1, -1]) onEnd(false, [[s * (hw(t0) - 0.03), t0], [s * (hw(t0) - 0.03 - tw), t0], [s * (hw(t1) - 0.03 - tw), t1], [s * (hw(t1) - 0.03), t1]]);
    if (b.face.rearKind === 'greenhouse') {
      const g0 = b.face.belt + 0.06, g1 = Math.min(sp.H - 0.08, b.face.glassTop);
      onEnd(false, [[hw(g0) - 0.16, g0], [hw(g1) - 0.18, g1], [-(hw(g1) - 0.18), g1], [-(hw(g0) - 0.16), g0]]);
    }
  }
  lines3.set(sp, out);
  return out;
}

/* ---------- the camera of each frame ---------- */

export interface FrameCam {
  eye: V3; fwd: V3; right: V3; up: V3;
  /** The phone is held sideways for this frame (a 4:3 picture), and the lens scale across and up for that. */
  land: boolean; fx: number; fy: number;
  /** Shift that centres the framed part in the box (a slight turn of the phone). */
  du: number; dv: number;
  /** About how far the driver stands from the nearest part of the van, in metres. */
  dist: number;
}
/** Where on the box a point is: u across, v down, and its depth. */
export function project(c: FrameCam, p: V3): [number, number, number] {
  const d = sub(p, c.eye), z = dot(d, c.fwd);
  return [0.5 + (c.fx * dot(d, c.right)) / z + c.du, 0.5 - (c.fy * dot(d, c.up)) / z + c.dv, z];
}
/** The ray from the camera through a point of the box. */
export function ray(c: FrameCam, u: number, v: number): V3 {
  const X = (u - c.du - 0.5) / c.fx, Y = (0.5 - (v - c.dv)) / c.fy;
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
    const side = sp.ver >= 3 ? 2.8 : 2.4;
    strip(front ? 0 : L - side, front ? side : L, s);
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
/**
 * Frames taken with the phone held sideways (since ver 4): the corners, and any other part of the van that is
 * wider than it is tall (a car's side or front). Tall parts (a van's front, rear and side sections) stay upright:
 * sideways they would fill less of the picture.
 */
export function frameLand(sp: Spec, f: Pick<Frame, 'kind' | 'seg'>): boolean {
  if (sp.ver < 4) return false;
  if (f.kind === 'corner') return true;
  const H = solid(sp).H;
  return f.kind === 'side' ? (f.seg![2] - f.seg![1]) * sp.L > H * 1.1 : sp.W > H * 1.1;
}
function camAt(target: V3, dir: V3, d: number, land: boolean): FrameCam {
  const eye: V3 = [target[0] + dir[0] * d, EYE_Y, target[2] + dir[2] * d];
  const fwd = norm(sub(target, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  return { eye, fwd, right, up, land, fx: land ? LONG : SHORT, fy: land ? SHORT : LONG, du: 0, dv: 0, dist: d };
}
const cams = new WeakMap<Spec, Map<string, FrameCam>>();
/** The camera that sees the frame's part of the van filling FILL of the box, centred. */
export function frameCam(sp: Spec, f: Pick<Frame, 'kind' | 'side' | 'seg' | 'corner'>): FrameCam {
  const key = `${f.kind}:${f.side}:${f.seg?.[1]}:${f.seg?.[2]}:${f.corner}`;
  let m = cams.get(sp);
  if (!m) { m = new Map(); cams.set(sp, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const P = framed(sp, f), dir = viewDir(f), land = frameLand(sp, f);
  const target = mul(P.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / P.length);
  const box = (c: FrameCam) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of P) { const [u, v] = project(c, p); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    return { u0, u1, v0, v1, size: Math.max(u1 - u0, v1 - v0) };
  };
  // The nearest point must stay well in front of the camera; then the distance at which the part fills FILL.
  const near = Math.max(...P.map((p) => dot(sub(p, target), dir)));
  let lo = near + 0.6, hi = 30;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (box(camAt(target, dir, mid, land)).size > FILL) lo = mid; else hi = mid; }
  const c = camAt(target, dir, hi, land), bb = box(c);
  c.du = 0.5 - (bb.u0 + bb.u1) / 2;
  c.dv = 0.5 - (bb.v0 + bb.v1) / 2;
  // How far from the van, measured on the ground to the nearest framed point.
  c.dist = Math.min(...P.map((p) => Math.hypot(p[0] - c.eye[0], p[2] - c.eye[2])));
  m.set(key, c);
  return c;
}

/* ---------- drawing ---------- */

type Run = { d: string; w: 0 | 1 };
const runsCache = new WeakMap<FrameCam, Run[]>();
/** The picture's size in drawing units: 300 x 400 upright, 400 x 300 with the phone held sideways. */
const units = (c: FrameCam): [number, number] => (c.land ? [400, 300] : [300, 400]);
/** The outline of a frame in its picture (worked out once per frame: the camera screen redraws often). */
function runsOf(sp: Spec, c: FrameCam): Run[] {
  const hit = runsCache.get(c);
  if (hit) return hit;
  const runs = [...silhouette(sp, c).map((d) => ({ d, w: 0 as const })), ...landmarkRuns(sp, c)];
  runsCache.set(c, runs);
  return runs;
}

/** The picture is worked out on a grid a little larger than the box, so a van that runs past an edge closes outside it. */
const GRID = 162, MARGIN = 0.1;
/**
 * The line round the van as the camera sees it: the body's surface and the wheels are dotted onto a grid, and the
 * edge of what they cover is traced and smoothed.
 */
function silhouette(sp: Spec, c: FrameCam): string[] {
  const [UW, UH] = units(c), GW = (GRID * UW) / 300, GH = (GRID * UH) / 300;
  const S = solid(sp), b = sp.b, mask = new Uint8Array(GW * GH);
  const [ex, ey, ez] = c.eye, [fx, fy, fz] = c.fwd, [rx, ry, rz] = c.right, [ux, uy, uz] = c.up;
  const ku = GW / (1 + 2 * MARGIN), kv = GH / (1 + 2 * MARGIN);
  const put = (x: number, y: number, z: number) => {
    const dx = x - ex, dy = y - ey, dz = z - ez, depth = dx * fx + dy * fy + dz * fz;
    if (depth < 0.3) return;
    const i = Math.floor((0.5 + (c.fx * (dx * rx + dy * ry + dz * rz)) / depth + c.du + MARGIN) * ku);
    const j = Math.floor((0.5 - (c.fy * (dx * ux + dy * uy + dz * uz)) / depth + c.dv + MARGIN) * kv);
    if (i < 1 || j < 1 || i > GW - 2 || j > GH - 2) return;
    const o = j * GW + i;
    mask[o - GW - 1] = mask[o - GW] = mask[o - GW + 1] = mask[o - 1] = mask[o] = mask[o + 1] = mask[o + GW - 1] = mask[o + GW] = mask[o + GW + 1] = 1;
  };
  const D = 0.03;
  // The two sides.
  for (let y = D / 2; y < S.H; y += D) {
    const xs = S.rows[Math.floor(y / S.step)] || [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const n = Math.max(1, Math.ceil((xs[k + 1] - xs[k]) / D));
      for (let q = 0; q <= n; q++) { const x = xs[k] + ((xs[k + 1] - xs[k]) * q) / n, w = S.hw(y, x); put(x, y, w); put(x, y, -w); }
    }
  }
  // The rounded corners, along their curve.
  for (const [R, xe, dir] of [[S.rf, S.x0, 1], [S.rr, S.x1, -1]] as const) {
    if (R <= 0) continue;
    const n = Math.ceil((R * Math.PI) / 2 / D);
    for (let y = D / 2; y < S.H; y += D) {
      const xs = S.rows[Math.floor(y / S.step)] || [];
      if (!xs.length) continue;
      const w = S.hw(y);
      for (let q = 0; q <= n; q++) {
        const phi = ((q / n) * Math.PI) / 2, x = xe + dir * R * (1 - Math.cos(phi)), z = w - R + R * Math.sin(phi);
        if (x < xs[0] || x > xs[xs.length - 1]) continue;
        put(x, y, z); put(x, y, -z);
      }
    }
  }
  // Front, bonnet, windscreen, roof and rear, across the width (the underside never shows).
  const prof = dense(b.pts as P2[], true, D);
  const area = b.pts.reduce((a, p, i) => { const q = b.pts[(i + 1) % b.pts.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
  for (let i = 0; i + 1 < prof.length; i++) {
    const [x, y] = prof[i], ny = -(area > 0 ? 1 : -1) * (prof[i + 1][0] - x);
    if (ny < -1e-6 && y < S.H * 0.5) continue;
    const w = S.hw(y, x), n = Math.max(1, Math.ceil((2 * w) / D));
    for (let q = 0; q <= n; q++) put(x, y, -w + (2 * w * q) / n);
  }
  // Wheels: the tread across its width and the outer face.
  const steps = Math.ceil((2 * Math.PI * b.r) / D);
  for (const wx of b.wheels) for (const s of [1, -1]) for (let k = 0; k < steps; k++) {
    const co = Math.cos((k / steps) * Math.PI * 2), si = Math.sin((k / steps) * Math.PI * 2);
    for (let t = 0; t <= 6; t++) put(wx + b.r * co, b.r + b.r * si, s * (sp.W / 2 - 0.03 - t * 0.035));
    for (let q = 1; q < 5; q++) put(wx + b.r * co * (q / 5), b.r + b.r * si * (q / 5), s * (sp.W / 2 - 0.03));
  }
  // The edge of what is covered: steps between a covered and an empty cell, joined into loops (covered on the right hand).
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : mask[j * GW + i]);
  const next = new Map<number, number[]>(), V = GW + 1;
  const edge = (a: number, bb: number) => { const l = next.get(a); if (l) l.push(bb); else next.set(a, [bb]); };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (!mask[j * GW + i]) continue;
    if (!at(i, j - 1)) edge(j * V + i, j * V + i + 1);
    if (!at(i + 1, j)) edge(j * V + i + 1, (j + 1) * V + i + 1);
    if (!at(i, j + 1)) edge((j + 1) * V + i + 1, (j + 1) * V + i);
    if (!at(i - 1, j)) edge((j + 1) * V + i, j * V + i);
  }
  const out: string[] = [];
  for (const start of [...next.keys()]) {
    let loop: P2[] = [], v = start;
    for (let guard = 0; guard < 4 * GW * GH; guard++) {
      const l = next.get(v);
      if (!l || !l.length) break;
      loop.push([v % V, Math.floor(v / V)]);
      v = l.pop()!;
      if (v === start) break;
    }
    if (loop.length < 12) continue;
    const a2 = loop.reduce((a, p, i) => { const q = loop[(i + 1) % loop.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
    // Outer edges only (they run clockwise on the screen), and nothing smaller than a wheel.
    if (a2 < 2 * 60) continue;
    loop = smooth(simplify(loop, 1.1));
    out.push('M' + loop.map(([i, j]) => `${r1((i / ku - MARGIN) * UW)} ${r1((j / kv - MARGIN) * UH)}`).join(' L') + ' Z');
  }
  return out;
}
/** Drops the points of a closed line that lie within `eps` of the line through their neighbours (Douglas-Peucker). */
function simplify(loop: P2[], eps: number): P2[] {
  // Cut the loop at its two points furthest apart on x, simplify both halves.
  let lo = 0, hi = 0;
  loop.forEach((p, i) => { if (p[0] < loop[lo][0]) lo = i; if (p[0] > loop[hi][0]) hi = i; });
  const part = (a: number, b: number) => { const o: P2[] = []; for (let i = a; ; i = (i + 1) % loop.length) { o.push(loop[i]); if (i === b) break; } return o; };
  const dp = (p: P2[]): P2[] => {
    if (p.length < 3) return p;
    const [ax, ay] = p[0], [bx, by] = p[p.length - 1], len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0, k = 0;
    for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((p[i][0] - ax) * (by - ay) - (p[i][1] - ay) * (bx - ax)) / len; if (d > worst) { worst = d; k = i; } }
    return worst <= eps ? [p[0], p[p.length - 1]] : [...dp(p.slice(0, k + 1)).slice(0, -1), ...dp(p.slice(k))];
  };
  return [...dp(part(lo, hi)).slice(0, -1), ...dp(part(hi, lo)).slice(0, -1)];
}
/** Rounds the corners of a closed line (corner cutting, twice). */
function smooth(loop: P2[]): P2[] {
  for (let pass = 0; pass < 2; pass++) {
    const o: P2[] = [];
    loop.forEach((p, i) => { const q = loop[(i + 1) % loop.length]; o.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]); });
    loop = o;
  }
  return loop;
}

/** The landmarks the camera sees: windows, lights and wheels not hidden behind the body. */
function landmarkRuns(sp: Spec, c: FrameCam): Run[] {
  const S = solid(sp), out: Run[] = [], [UW, UH] = units(c);
  const seen = (p: V3) => {
    const d = sub(p, c.eye), len = Math.hypot(d[0], d[1], d[2]), k = Math.max(4, Math.ceil(len / 0.06));
    for (let j = 1; j < k; j++) {
      const t = j / k;
      if ((1 - t) * len < 0.035) break;
      if (inside(S, add(c.eye, mul(d, t)))) return false;
    }
    return true;
  };
  for (const l of landmarks(sp)) {
    const from = l.see === 'left' ? c.eye[2] > 0.5 : l.see === 'right' ? c.eye[2] < -0.5 : l.see === 'front' ? c.eye[0] < -0.3 : c.eye[0] > sp.L + 0.3;
    if (!from) continue;
    let run: string[] = [];
    const flush = () => { if (run.length > 1) out.push({ d: 'M' + run.join(' L'), w: 1 }); run = []; };
    for (const p of l.pts) {
      const [u, v, z] = project(c, p);
      if (z < 0.2 || !seen(p)) { flush(); continue; }
      run.push(`${r1(u * UW)} ${r1(v * UH)}`);
    }
    flush();
  }
  return out;
}

export interface OPaint { line: string; halo: string | null; body: number; detail: number; detailOpacity: number }
export const OVERLAY_PAINT: OPaint = { line: '#E2FF1C', halo: '#000000', body: 3, detail: 1.6, detailOpacity: 0.85 };
export const THUMB_PAINT: OPaint = { line: '#E2FF1C', halo: null, body: 1.6, detail: 0.9, detailOpacity: 0.7 };

/**
 * The outline as SVG paths in the frame's own picture (300 x 400 units, or 400 x 300 for a frame taken sideways),
 * with line widths for `upx` units per screen pixel.
 */
export function outlinePaths(sp: Spec, f: Frame, upx: number, p: OPaint): string {
  const u = upx, runs = runsOf(sp, frameCam(sp, f));
  const pass = (color: string, extra: number, fade: number) => runs.map((r) =>
    `<path d="${r.d}" fill="none" stroke="${color}" stroke-width="${r3(((r.w ? p.detail : p.body) + extra) * u)}" stroke-linejoin="round" stroke-linecap="round"`
    + ` stroke-opacity="${r3((r.w ? p.detailOpacity : 1) * fade)}"/>`).join('');
  return (p.halo ? pass(p.halo, 2.5, 0.45) : '') + pass(p.line, 0, 1);
}
