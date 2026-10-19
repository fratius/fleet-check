/**
 * A low-poly 3D model of a vehicle, built from the same body spec as the frame outlines, and the maths to place
 * a damage on it.
 *
 * World coordinates are metres: x along the length (0 = front bumper, L = rear), y up from the ground, z across
 * (+ = the vehicle's left side, the driver's side in Europe). The model is drawn as SVG (see van3d.tsx), so it
 * runs the same in Expo Go and on the web.
 */
import { CA, CK, OVERLAY_FILL, buildFrames, fitBox, frameBox, type Frame, type Spec } from './frames';

export type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ---------- body shape ---------- */

/** Half the body width at height y: full below the belt line, narrowing towards the roof. */
export function halfWidth(sp: Spec, y: number) {
  const f = sp.b.face, hw = sp.W / 2;
  if (y <= f.belt) return hw;
  const t = clamp((y - f.belt) / Math.max(0.1, sp.H - f.belt), 0, 1);
  return hw * (1 - (1 - f.top) * t);
}
type P2 = [number, number];
/** Where a horizontal line at height y crosses the side profile: [front-most x, rear-most x]. */
function spanAt(pts: P2[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  return lo <= hi ? [lo, hi] : null;
}
/** The top of the side profile at x. */
function topAt(pts: P2[], x: number) {
  let top = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    top = Math.max(top, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return top || pts.reduce((m, p) => Math.max(m, p[1]), 0);
}
const profile = (sp: Spec): P2[] => sp.b.pts.map(([x, y]) => [x, y]);

/* ---------- placing a damage ---------- */

/** A point on the body and the outward direction there. `approx`: placed from the panel name, not the photo. */
export interface Pos { p: V3; n: V3; approx: boolean }

/** A point on the left or right side at (x, y). */
function onSide(sp: Spec, pts: P2[], x: number, y: number, left: boolean): Pos {
  const xx = clamp(x, 0.05, sp.L - 0.05);
  const yy = clamp(y, sp.b.sill * 0.6, topAt(pts, xx) - 0.04);
  return { p: [xx, yy, (left ? 1 : -1) * halfWidth(sp, yy)], n: [0, 0, left ? 1 : -1], approx: false };
}
/** A point on the front or rear end at height y and z across. */
function onEnd(sp: Spec, pts: P2[], front: boolean, y: number, z: number): Pos {
  const top = Math.max(...pts.map((p) => p[1]));
  const yy = clamp(y, sp.b.sill * 0.6, top - 0.04);
  const span = spanAt(pts, yy) || [0, sp.L];
  const hw = halfWidth(sp, yy) - 0.03;
  return { p: [front ? span[0] : span[1], yy, clamp(z, -hw, hw)], n: [front ? -1 : 1, 0, 0], approx: false };
}

/**
 * Where on the vehicle a point of a walk-around photo is. The driver lines the vehicle up with the frame's
 * outline, which fills the camera view the same way as the overlay (frameBox fitted at OVERLAY_FILL), so the
 * photo position maps back to the drawing and from there to the body. (u, v) is 0..1 across and down the photo.
 */
export function locateInFrame(sp: Spec, f: Frame, u: number, v: number): Pos {
  const pts = profile(sp);
  const vb = fitBox(frameBox(sp, f), 3 / 4, OVERLAY_FILL);
  let X = vb[0] + u * vb[2];
  const Y = vb[1] + v * vb[3];
  if (f.kind === 'side') {
    const left = f.side === 'left';
    return onSide(sp, pts, left ? X / 100 : sp.L - X / 100, -Y / 100, left);
  }
  if (f.kind === 'front') return onEnd(sp, pts, true, -Y / 100, X / 100); // image right = the vehicle's left
  if (f.kind === 'rear') return onEnd(sp, pts, false, -Y / 100, -X / 100); // image right = the vehicle's right
  // Corner: the end face on one side of the corner edge, the first metres of the flank on the other.
  const c = f.corner!, front = c === 'fl' || c === 'fr', left = c === 'fl' || c === 'rl';
  if (c === 'fr' || c === 'rl') X = -X;
  const Wh = sp.W * 50;
  if (X >= 0) {
    const xs = X / CA, y = Y + CK * CA * xs;
    return onSide(sp, pts, front ? xs / 100 : sp.L - xs / 100, -y / 100, left);
  }
  const xf = (X + CA * Wh) / CA, y = Y - CK * CA * xf + CK * CA * Wh;
  // xf runs across the end face; +Wh is the edge next to the flank shown.
  return onEnd(sp, pts, front, -y / 100, (left ? 1 : -1) * (xf / 100));
}

/** Rough placement from the panel name, for damage a manager added without a photo position. */
export function locateByPanel(sp: Spec, panel: string): Pos {
  const t = ` ${panel.toLowerCase()} `;
  const pts = profile(sp), b = sp.b, f = b.face;
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const side = has(' left') ? 1 : has(' right') ? -1 : 0;
  const frontWord = has('front', 'bonnet', 'hood', 'windscreen', 'windshield', 'grille', 'headlight', 'head light');
  const rearWord = has('rear', 'back', 'tailgate', 'shutter', 'roller', 'barn', 'tail light', 'taillight', 'boot');
  const low = has('bumper', 'sill', 'step', 'wheel', 'tyre', 'tire', 'arch', 'skirt', 'lower');
  const y = has('roof') ? sp.H : low ? b.sill + 0.18 : has('mirror') ? f.belt + 0.18 : has('window', 'glass', 'windscreen', 'windshield') ? (f.belt + f.glassTop) / 2
    : has('upper', 'top') ? sp.H - 0.25 : (b.sill + f.belt) / 2 + 0.1;
  if (has('roof')) {
    const x = sp.L * (frontWord ? 0.25 : rearWord ? 0.85 : 0.55);
    return { p: [x, topAt(pts, x), side * sp.W * 0.25], n: [0, 1, 0], approx: true };
  }
  if (has('bonnet', 'hood')) {
    const x = Math.max(0.15, b.hood * 0.5), yy = topAt(pts, x);
    return { p: [x, yy, side * sp.W * 0.25], n: norm([-0.35, 1, 0]), approx: true };
  }
  // An end face: bumper ends, rear doors, windscreen, grille, lights, or anything front/rear without a side.
  const endFace = has('windscreen', 'windshield', 'grille', 'headlight', 'tailgate', 'shutter', 'roller', 'rear door', 'back door', 'barn', 'number plate')
    || (has('bumper') && (frontWord || rearWord)) || ((frontWord || rearWord) && !side);
  if (endFace && (frontWord || rearWord)) {
    const corner = has('corner', 'edge');
    const z = side * (corner ? sp.W / 2 - 0.15 : sp.W * 0.25);
    return { ...onEnd(sp, pts, frontWord && !rearWord, y, z), approx: true };
  }
  // A side.
  const wheels = b.wheels;
  const x = has('mirror') ? Math.max(0.3, (b.glass[0]?.[0] ?? 1) - 0.1)
    : has('front wheel', 'front tyre', 'front tire', 'front arch') ? wheels[0]
      : has('rear wheel', 'rear tyre', 'rear tire', 'rear arch') ? wheels[wheels.length - 1]
        : has('sliding door') && b.slide ? b.slide.x + b.slide.w / 2
          : has('wing', 'cab door', 'front door', 'driver door', 'a-pillar') ? Math.min(sp.L * 0.25, (b.doors[0]?.[0] ?? 1) - 0.05)
            : has('rear quarter', 'rear corner', 'quarter') ? sp.L - 0.45
              : frontWord ? sp.L * 0.15 : rearWord ? sp.L * 0.85 : sp.L * 0.55;
  const pos = onSide(sp, pts, x, y, side >= 0);
  if (has('mirror')) pos.p[2] += (side >= 0 ? 1 : -1) * 0.12;
  return { ...pos, approx: true };
}

/** The frame a walk-around photo was taken for: by its label, or by number when the frame set matches. */
export function frameOfPhoto(sp: Spec, photo: { n: number; label: string } | undefined, framesInWalk: number): Frame | null {
  if (!photo) return null;
  const frames = buildFrames(sp);
  return frames.find((f) => f.label === photo.label) || (framesInWalk === frames.length ? frames[photo.n - 1] || null : null);
}

/* ---------- the model ---------- */

export type FaceKind = 'body' | 'glass' | 'wheel' | 'light' | 'dark';
export interface Line3 { pts: V3[]; closed?: boolean; dashed?: boolean; faint?: boolean }
export interface Face3 { key: string; pts: V3[]; n: V3; kind: FaceKind; details: (Line3 | Face3)[] }

/** Points around a circle in a plane parallel to the side (z fixed). */
const ring = (cx: number, cy: number, z: number, r: number, k = 18): V3[] =>
  Array.from({ length: k }, (_, i) => [cx + r * Math.cos((i / k) * Math.PI * 2), cy + r * Math.sin((i / k) * Math.PI * 2), z] as V3);

/** Builds the faces of the model: two side panels, a strip for each edge of the profile, glass, wheels, lights. */
export function vanMesh(sp: Spec): Face3[] {
  const b = sp.b, f = b.face, pts = profile(sp), n = pts.length;
  const hw = (y: number) => halfWidth(sp, y);
  // Outward normal of each profile edge, from the polygon's winding (works for the notched box and pickup shapes).
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % n]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0);
  const sign = area > 0 ? 1 : -1;
  const faces: Face3[] = [];
  const sideDetails = (left: boolean): (Line3 | Face3)[] => {
    const z = (y: number, out = 0.004) => (left ? 1 : -1) * (hw(y) + out);
    const d: (Line3 | Face3)[] = [];
    d.push({ key: `glass-${left}`, kind: 'glass', n: [0, 0, left ? 1 : -1], details: [], pts: b.glass.map(([x, y]) => [x, y, z(y)] as V3) });
    b.doors.forEach(([x, y]) => d.push({ pts: [[x, b.sill + 0.04, z(b.sill)], [x, y, z(y)]] }));
    if (b.slide && sp.slide[left ? 'left' : 'right'] !== 'no' && (sp.body === 'compact' || sp.body === 'mid' || sp.body === 'large')) {
      const s = b.slide, y0 = b.sill + 0.06;
      d.push({ closed: true, dashed: sp.slide[left ? 'left' : 'right'] === 'unknown',
        pts: [[s.x, y0, z(y0)], [s.x + s.w, y0, z(y0)], [s.x + s.w, s.top, z(s.top)], [s.x, s.top, z(s.top)]] });
    }
    b.wheels.forEach((x, i) => {
      const zz = (left ? 1 : -1) * (sp.W / 2 + 0.02);
      d.push({ key: `wheel-${left}-${i}`, kind: 'wheel', n: [0, 0, left ? 1 : -1], pts: ring(x, b.r, zz, b.r), details: [{ pts: ring(x, b.r, zz, b.r * 0.45, 12), closed: true, faint: true }] });
    });
    return d;
  };
  for (const left of [true, false]) {
    const z = (y: number) => (left ? 1 : -1) * hw(y);
    faces.push({ key: left ? 'left' : 'right', kind: 'body', n: [0, 0, left ? 1 : -1], pts: pts.map(([x, y]) => [x, y, z(y)] as V3), details: sideDetails(left) });
  }
  // The windscreen: the front edge that covers most of the band between the belt line and the top of the glass.
  const overlap = (i: number, a: number, c: number) => {
    const p = pts[i], q = pts[(i + 1) % n];
    return Math.max(0, Math.min(c, Math.max(p[1], q[1])) - Math.max(a, Math.min(p[1], q[1])));
  };
  const pick = (front: boolean) => {
    let best = -1, bestV = 0.15;
    for (let i = 0; i < n; i++) {
      const mx = (pts[i][0] + pts[(i + 1) % n][0]) / 2;
      if (front ? mx > sp.L * 0.4 : mx < sp.L * 0.6) continue;
      const v = overlap(i, f.belt, f.glassTop);
      if (v > bestV) { bestV = v; best = i; }
    }
    return best;
  };
  const screen = pick(true), rearGlass = f.rearKind === 'greenhouse' ? pick(false) : -1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const e: P2 = [q[0] - p[0], q[1] - p[1]];
    const nn = norm([sign * e[1], -sign * e[0], 0]);
    const quad: V3[] = [[p[0], p[1], hw(p[1])], [q[0], q[1], hw(q[1])], [q[0], q[1], -hw(q[1])], [p[0], p[1], -hw(p[1])]];
    const details: (Line3 | Face3)[] = [];
    if (i === screen || i === rearGlass) {
      const at = (t: number, s: number): V3 => { const y = p[1] + e[1] * t; const lift = mul(nn, 0.004); return add([p[0] + e[0] * t, y, s * (hw(y) - 0.1)], lift); };
      details.push({ key: `glass-${i}`, kind: 'glass', n: nn, details: [], pts: [at(0.08, 1), at(0.92, 1), at(0.92, -1), at(0.08, -1)] });
    }
    faces.push({ key: `edge-${i}`, kind: nn[1] < -0.7 ? 'dark' : 'body', n: nn, pts: quad, details });
  }
  // Lights, bumper line and rear doors, drawn on the end strips they sit on.
  const endAt = (front: boolean, y: number) => {
    let idx = -1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) continue;
      const x = p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      const span = spanAt(pts, y);
      if (span && Math.abs(x - (front ? span[0] : span[1])) < 1e-6) idx = i;
    }
    return idx;
  };
  const attach = (front: boolean, y: number, item: Line3 | Face3) => {
    const i = endAt(front, y);
    const face = faces.find((x) => x.key === `edge-${i}`);
    if (face) face.details.push(item);
  };
  const endPoint = (front: boolean, y: number, z: number): V3 => {
    const span = spanAt(pts, y) || [0, sp.L];
    return [front ? span[0] - 0.006 : span[1] + 0.006, y, z];
  };
  const lightY = f.belt - 0.2, lw = Math.min(0.32, sp.W * 0.17);
  for (const s of [1, -1]) {
    const z0 = s * (hw(lightY) - 0.06), z1 = s * (hw(lightY) - 0.06 - lw);
    attach(true, lightY, { key: `hl${s}`, kind: 'light', n: [-1, 0, 0], details: [],
      pts: [endPoint(true, lightY - 0.07, z0), endPoint(true, lightY - 0.07, z1), endPoint(true, lightY + 0.07, z1), endPoint(true, lightY + 0.07, z0)] });
    const ty = f.rearKind === 'greenhouse' ? f.belt - 0.18 : b.sill + 0.55;
    const tz0 = s * (hw(ty) - 0.04), tz1 = s * (hw(ty) - 0.04 - 0.12);
    attach(false, ty, { key: `tl${s}`, kind: 'light', n: [1, 0, 0], details: [],
      pts: [endPoint(false, ty - 0.14, tz0), endPoint(false, ty - 0.14, tz1), endPoint(false, ty + 0.14, tz1), endPoint(false, ty + 0.14, tz0)] });
  }
  const bumperY = b.sill + 0.24;
  for (const front of [true, false]) {
    attach(front, bumperY, { pts: [endPoint(front, bumperY, hw(bumperY) - 0.02), endPoint(front, bumperY, -hw(bumperY) + 0.02)], faint: true });
  }
  if (sp.rear === 'barn') {
    const y0 = b.sill + 0.3, y1 = Math.min(sp.H - 0.12, f.rearKind === 'greenhouse' ? f.belt : sp.H - 0.12), ym = (y0 + y1) / 2;
    attach(false, ym, { pts: [endPoint(false, y0, 0), endPoint(false, Math.min(y1, ym + 0.6), 0)] });
  } else if (sp.rear === 'roller') {
    for (let y = b.sill + 0.5; y < sp.H - 0.2; y += 0.3) attach(false, y, { pts: [endPoint(false, y, hw(y) - 0.1), endPoint(false, y, -hw(y) + 0.1)], faint: true });
  }
  return faces;
}

/* ---------- camera ---------- */

export interface Cam { project(p: V3): [number, number, number]; eye: V3; facing(p: V3, n: V3): number }

/**
 * A perspective camera looking at the middle of the vehicle from `yaw` around it and `pitch` above it, sized so
 * the whole vehicle fits a w x h box at any angle.
 */
export function camera(sp: Spec, yaw: number, pitch: number, w: number, h: number): Cam {
  const center: V3 = [sp.L / 2, sp.H * 0.45, 0];
  const R = Math.max(sp.L, 3.5) * 2.8;
  const dir: V3 = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  const eye = add(center, mul(dir, R));
  const fwd = norm(sub(center, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  // Fit the widest the vehicle can look at this tilt, so its size doesn't change while it turns.
  const D = Math.hypot(sp.L, sp.W);
  const tall = sp.H * Math.cos(pitch) + D * Math.sin(pitch);
  const focal = Math.min((0.86 * w * R) / D, (0.78 * h * R) / tall);
  return {
    eye,
    project(p) {
      const d = sub(p, eye);
      const z = dot(d, fwd);
      return [w / 2 + (focal * dot(d, right)) / z, h * 0.52 - (focal * dot(d, up)) / z, z];
    },
    /** > 0 when the surface at p with normal n faces the camera. */
    facing(p, n) { return dot(n, norm(sub(eye, p))); },
  };
}

/** The yaw that looks straight at a surface with normal n (from the front-left when it faces up). */
export function yawFacing(n: V3) {
  if (Math.abs(n[0]) < 0.05 && Math.abs(n[2]) < 0.05) return (3 * Math.PI) / 4;
  return Math.atan2(n[2], n[0]);
}

export const VIEWS = {
  front: { yaw: Math.PI, pitch: 0.18, label: 'Front' },
  left: { yaw: Math.PI / 2, pitch: 0.18, label: 'Left' },
  rear: { yaw: 0, pitch: 0.18, label: 'Rear' },
  right: { yaw: -Math.PI / 2, pitch: 0.18, label: 'Right' },
  top: { yaw: (3 * Math.PI) / 4, pitch: 1.2, label: 'Top' },
} as const;
export const HOME_VIEW = { yaw: (3 * Math.PI) / 4, pitch: 0.36 };
