/**
 * Vehicle body classes, walk-around frame sets and the outline drawings
 * shown on thumbnails, the live camera overlay and the fleet list.
 * Drawings are SVG strings (1 m = 100 units, y up is negative) rendered with
 * react-native-svg's SvgXml. Stroke widths are given in screen pixels and
 * converted to drawing units, so lines look the same at any size.
 */

export type BodyKind = 'car' | 'suv' | 'pickup' | 'compact' | 'mid' | 'large' | 'step' | 'box';
export type RearKind = 'barn' | 'tailgate' | 'roller' | 'open_bed';
export type Tri = 'yes' | 'no' | 'unknown';

export interface VehicleClass {
  id: string;
  name: string;
  lower: string;
  body: BodyKind;
  L: number;
  W: number;
  H: number;
  rear: RearKind;
  eg: string;
  desc: string;
}

export interface VehicleAttrs {
  roof: 'high' | 'low' | 'unknown';
  slideL: Tri;
  slideR: Tri;
  rear: RearKind | 'unknown';
}

export const CLASSES: VehicleClass[] = [
  { id: 'car', name: 'Car', lower: 'car', body: 'car', L: 4.4, W: 1.8, H: 1.46, rear: 'tailgate',
    eg: 'Golf, Octavia, Corsa, Model 3', desc: 'passenger car: hatchback, saloon or estate (Golf, Octavia, Corsa, Model 3)' },
  { id: 'suv', name: 'SUV or crossover', lower: 'SUV or crossover', body: 'suv', L: 4.6, W: 1.86, H: 1.66, rear: 'tailgate',
    eg: 'Tiguan, Qashqai, RAV4, Kodiaq', desc: 'SUV or crossover (Tiguan, Qashqai, RAV4, Kodiaq)' },
  { id: 'pickup', name: 'Pickup', lower: 'pickup', body: 'pickup', L: 5.3, W: 1.9, H: 1.82, rear: 'open_bed',
    eg: 'Hilux, Ranger, Amarok, Navara', desc: 'pickup truck with an open load bed (Hilux, Ranger, Amarok, Navara)' },
  { id: 'compact_van', name: 'Compact van', lower: 'compact van', body: 'compact', L: 4.5, W: 1.85, H: 1.85, rear: 'barn',
    eg: 'Caddy, Berlingo, Kangoo, Transit Connect', desc: 'small panel van on a car platform, up to about 4.8 m long (Caddy, Berlingo, Kangoo, Transit Connect, Partner)' },
  { id: 'midsize_van', name: 'Mid-size van', lower: 'mid-size van', body: 'mid', L: 5.1, W: 1.95, H: 1.98, rear: 'barn',
    eg: 'Vito, Transit Custom, Transporter, Trafic', desc: 'medium panel van about 4.9 to 5.4 m long with a roof under about 2.1 m (Vito, Transit Custom, Transporter, Trafic, Vivaro, Expert)' },
  { id: 'large_van', name: 'Large van', lower: 'large van', body: 'large', L: 5.95, W: 2.02, H: 2.6, rear: 'barn',
    eg: 'Sprinter, Crafter, Transit, Ducato, Master, Daily', desc: 'large panel van in short or standard length, about 5.3 to 6.4 m (Sprinter L1/L2, eSprinter, Crafter, Transit L2/L3, Ducato, Master, Daily, Movano)' },
  { id: 'large_van_long', name: 'Large van, extra long', lower: 'extra-long large van', body: 'large', L: 7.0, W: 2.02, H: 2.7, rear: 'barn',
    eg: 'Sprinter L3, Transit L4, Ducato XLWB, Master L4', desc: 'large panel van in its longest version, about 6.9 m or more, with a long cargo side between the sliding door and the rear wheel (Sprinter L3, Transit L4, Ducato XLWB, Master L4)' },
  { id: 'step_van', name: 'Walk-in delivery van', lower: 'walk-in delivery van', body: 'step', L: 6.6, W: 2.2, H: 2.9, rear: 'roller',
    eg: 'Rivian EDV, Ford step van, Morgan Olson', desc: 'walk-in delivery van with an upright front and a tall boxy body (Rivian EDV, Ford step van, Morgan Olson)' },
  { id: 'box_truck', name: 'Box van or Luton', lower: 'box van or Luton', body: 'box', L: 6.9, W: 2.2, H: 3.2, rear: 'roller',
    eg: 'Transit or Sprinter chassis with a box body', desc: 'van or light-truck chassis with a separate box body behind the cab, including Luton (Transit or Sprinter box van)' },
];
export const CLS: Record<string, VehicleClass> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

export const SLIDE_BODIES: Partial<Record<BodyKind, true>> = { compact: true, mid: true, large: true };
export const REAR_LABEL: Record<RearKind, string> = {
  barn: 'Rear doors', tailgate: 'Tailgate and rear bumper', roller: 'Rear shutter and bumper', open_bed: 'Tailgate and load bed',
};
export const REAR_PILL: Record<RearKind, string> = {
  barn: 'Twin rear doors', tailgate: 'Tailgate', roller: 'Roller shutter', open_bed: 'Open load bed',
};

export const defaultAttrs = (): VehicleAttrs => ({ roof: 'unknown', slideL: 'unknown', slideR: 'unknown', rear: 'unknown' });

type Pt = [number, number];
interface Face { belt: number; glassTop: number; top: number; rearKind: 'greenhouse' | 'pickup' | 'box' | 'luton'; mirrors: boolean; cabH?: number; cabW?: number; box?: [number, number]; }
interface Body {
  sill: number; hood: number; r: number; wheels: number[];
  slide: { x: number; w: number; top: number } | null;
  pts: Pt[]; glass: Pt[]; doors: Pt[]; face: Face;
}

const BODY: Record<BodyKind, (L: number, H: number) => Body> = {
  car: (L, H) => ({ sill: 0.3, hood: 1.2, r: 0.32, wheels: [0.85, 3.55], slide: null,
    pts: [[0.02, 0.3], [0, 0.5], [0.12, 0.7], [1.2, 0.84], [1.9, 1.42], [3.25, H], [4.15, 1.0], [4.4, 0.9], [4.4, 0.45], [4.36, 0.3]],
    glass: [[1.98, 1.0], [2.06, 1.34], [3.2, 1.36], [3.82, 1.0]],
    doors: [[1.32, 1.0], [2.42, 1.36], [3.38, 1.0]],
    face: { belt: 0.86, glassTop: 1.36, top: 0.7, rearKind: 'greenhouse', mirrors: true } }),
  suv: (L, H) => ({ sill: 0.33, hood: 1.1, r: 0.36, wheels: [0.95, 3.7], slide: null,
    pts: [[0.02, 0.33], [0, 0.55], [0.1, 0.85], [1.1, 0.98], [1.8, 1.62], [3.95, H], [4.5, 1.25], [4.6, 1.05], [4.6, 0.5], [4.55, 0.33]],
    glass: [[1.86, 1.1], [1.96, 1.54], [3.88, 1.56], [4.32, 1.12]],
    doors: [[1.38, 1.1], [2.55, 1.56], [3.55, 1.1]],
    face: { belt: 1.0, glassTop: 1.55, top: 0.78, rearKind: 'greenhouse', mirrors: true } }),
  pickup: (L, H) => ({ sill: 0.38, hood: 1.25, r: 0.38, wheels: [0.95, 4.2], slide: null,
    pts: [[0.02, 0.38], [0, 0.6], [0.1, 0.98], [1.25, 1.1], [1.9, 1.78], [3.1, H], [3.2, 1.72], [3.2, 1.18], [5.3, 1.18], [5.3, 0.55], [5.25, 0.38]],
    glass: [[1.96, 1.2], [2.06, 1.68], [3.04, 1.7], [3.1, 1.2]],
    doors: [[1.45, 1.2], [2.4, 1.7]],
    face: { belt: 1.1, glassTop: 1.72, top: 0.8, rearKind: 'pickup', mirrors: true } }),
  compact: (L, H) => ({ sill: 0.3, hood: 0.8, r: 0.32, wheels: [0.8, 3.55], slide: { x: 2.36, w: 0.95, top: 1.6 },
    pts: [[0.02, 0.3], [0, 0.5], [0.1, 0.82], [0.8, 0.98], [1.45, 1.68], [1.75, H], [4.4, H], [4.5, H - 0.12], [4.5, 0.45], [4.46, 0.3]],
    glass: [[1.55, 1.05], [1.62, 1.6], [2.2, 1.66], [2.25, 1.05]],
    doors: [[1.12, 1.05], [2.3, 1.66]],
    face: { belt: 1.0, glassTop: 1.62, top: 0.9, rearKind: 'box', mirrors: true } }),
  mid: (L, H) => ({ sill: 0.33, hood: 0.62, r: 0.33, wheels: [0.85, 4.05], slide: { x: 2.16, w: 1.05, top: Math.min(1.78, H - 0.18) },
    pts: [[0.02, 0.33], [0, 0.52], [0.08, 0.86], [0.62, 1.02], [1.3, 1.82], [H > 2.1 ? 1.75 : 1.6, H], [L - 0.1, H], [L, H - 0.12], [L, 0.5], [L - 0.04, 0.33]],
    glass: [[1.38, 1.1], [1.45, 1.72], [2.0, 1.8], [2.05, 1.1]],
    doors: [[0.98, 1.1], [2.1, 1.8]],
    face: { belt: 1.02, glassTop: 1.78, top: 0.9, rearKind: 'box', mirrors: true } }),
  large: (L, H) => ({ sill: 0.36, hood: 0.72, r: 0.36, wheels: [0.92, L > 6.5 ? 5.15 : 4.6], slide: { x: 2.38, w: 1.3, top: Math.min(2.05, H - 0.2) },
    pts: [[0.02, 0.36], [0, 0.55], [0.08, 0.98], [0.72, 1.18], [1.45, 2.05], [1.9, H], [L - 0.06, H], [L, H - 0.12], [L, 0.55], [L - 0.04, 0.36]],
    glass: [[1.5, 1.28], [1.56, 1.95], [2.12, 2.0], [2.18, 1.28]],
    doors: [[1.06, 1.28], [2.3, 2.02]],
    face: { belt: 1.2, glassTop: 2.0, top: 0.93, rearKind: 'box', mirrors: true } }),
  step: (L, H) => ({ sill: 0.38, hood: 0.42, r: 0.4, wheels: [1.0, 5.1], slide: null,
    pts: [[0.02, 0.38], [0, 0.6], [0.05, 1.05], [0.3, 1.25], [0.42, 2.7], [0.6, H], [L - 0.05, H], [L, H - 0.1], [L, 0.5], [L - 0.04, 0.38]],
    glass: [[0.52, 1.42], [0.57, 2.6], [1.35, 2.64], [1.4, 1.42]],
    doors: [[1.5, 2.64]],
    face: { belt: 1.25, glassTop: 2.65, top: 0.95, rearKind: 'box', mirrors: true } }),
  box: (L, H) => ({ sill: 0.38, hood: 0.72, r: 0.38, wheels: [0.9, 4.9], slide: null,
    pts: [[0.02, 0.38], [0, 0.55], [0.08, 0.98], [0.72, 1.18], [1.25, 1.95], [1.25, 2.45], [1.5, H], [L, H], [L, 0.75], [2.05, 0.75], [2.05, 0.38]],
    glass: [[1.3, 1.25], [1.33, 1.9], [1.85, 1.95], [1.88, 1.25]],
    doors: [[1.0, 1.25], [1.95, 1.95]],
    face: { belt: 1.2, glassTop: 1.95, top: 0.9, cabH: 2.4, cabW: 2.0, box: [2.45, H], rearKind: 'luton', mirrors: true } }),
};

export interface Spec {
  id: string; name: string; body: BodyKind; L: number; W: number; H: number; rear: RearKind;
  slide: { left: Tri; right: Tri }; b: Body;
}

export function makeSpec(cls: string, attrs?: Partial<VehicleAttrs> | null): Spec {
  const c = CLS[cls] || CLS.large_van;
  const a = { ...defaultAttrs(), ...(attrs || {}) };
  let H = c.H;
  if (c.body === 'large' && a.roof === 'low') H = 2.35;
  if (c.body === 'mid' && a.roof === 'high') H = 2.3;
  const rear = a.rear !== 'unknown' && REAR_LABEL[a.rear as RearKind] ? (a.rear as RearKind) : c.rear;
  return { id: c.id, name: c.name, body: c.body, L: c.L, W: c.W, H, rear,
    slide: { left: a.slideL || 'unknown', right: a.slideR || 'unknown' }, b: BODY[c.body](c.L, H) };
}

/* ---------- frames ---------- */
export type FrameKind = 'front' | 'rear' | 'side' | 'corner';
export interface Frame {
  n: number; kind: FrameKind; label: string; hint: string;
  side?: 'left' | 'right'; seg?: [string, number, number]; corner?: 'fl' | 'fr' | 'rl' | 'rr';
  orient: 'portrait' | 'landscape'; dist: number;
}

function segDefs(sp: Spec): [string, number, number][] {
  switch (sp.body) {
    case 'car': case 'suv': return [['Front door and wing', 0, 0.56], ['Rear door and quarter', 0.44, 1]];
    case 'pickup': return [['Cab doors and wing', 0, 0.6], ['Load bed side', 0.54, 1]];
    case 'compact': return [['Cab door and wing', 0, 0.5], ['@ and rear quarter', 0.42, 1]];
    case 'mid': return [['Cab door and wing', 0, 0.4], ['@', 0.32, 0.72], ['Rear quarter', 0.64, 1]];
    case 'large': return sp.L < 6.5
      ? [['Cab door and wing', 0, 0.36], ['@', 0.3, 0.66], ['Rear quarter', 0.6, 1]]
      : [['Cab door and wing', 0, 0.3], ['@', 0.25, 0.55], ['Cargo side, rear half', 0.5, 0.76], ['Rear quarter', 0.71, 1]];
    case 'step': return [['Cab door and front corner', 0, 0.34], ['Cargo side, front half', 0.28, 0.66], ['Cargo side, rear half', 0.6, 1]];
    default: return [['Cab door and wing', 0, 0.32], ['Box side, front half', 0.27, 0.66], ['Box side, rear half', 0.6, 1]];
  }
}
function segText(raw: string, sp: Spec, side: 'left' | 'right') {
  const st = sp.slide[side];
  const s = raw.replace('@', st === 'yes' ? 'sliding door' : st === 'no' ? 'cargo side panel' : 'sliding door or side panel');
  return s.charAt(0).toLowerCase() + s.slice(1);
}
const HFOV = (67 * Math.PI) / 180, VFOV = (53 * Math.PI) / 180;
const CA = 0.6, CK = 0.16, CL = 2.4;
/** The scanner is portrait-only, so every frame is framed upright. */
function measure(sp: Spec, f: Omit<Frame, 'orient' | 'dist' | 'hint'>) {
  let w: number, h: number;
  if (f.kind === 'front') { w = sp.W + 0.4; h = sp.H; }
  else if (f.kind === 'rear') { w = sp.W; h = sp.H; }
  else if (f.kind === 'side') { w = (f.seg![2] - f.seg![1]) * sp.L; h = sp.H; }
  else { w = CA * sp.W + CA * CL; h = sp.H * 1.1; }
  const orient: Frame['orient'] = 'portrait';
  const hf = VFOV, vf = HFOV;
  const d = Math.max((w * 1.15) / 2 / Math.tan(hf / 2), (h * 1.15) / 2 / Math.tan(vf / 2));
  return { orient, dist: Math.max(1, Math.round(d * 2) / 2) };
}
function hintFor(sp: Spec, f: Omit<Frame, 'hint' | 'orient' | 'dist'>): string {
  const tall = sp.H > 2.2;
  if (f.kind === 'front') return 'Whole front in frame: bumper, grille, lights and windscreen' + (tall ? ', up to the roof edge.' : '.');
  if (f.kind === 'rear') return ({ barn: 'Both doors, bumper and lights in frame', tailgate: 'Tailgate, rear window, bumper and lights in frame',
    roller: 'Shutter, bumper and lights in frame', open_bed: 'Tailgate, bumper and lights in frame' })[sp.rear] + (tall ? ', up to the roof edge.' : '.');
  if (f.kind === 'corner') return 'Stand at an angle to the corner. Bumper corner in the middle, wheel arch in view.';
  const from = f.seg![1] * sp.L, to = f.seg![2] * sp.L;
  const wheel = sp.b.wheels.some((x) => x >= from && x <= to);
  return 'Sill to roof edge in frame. ' + (wheel ? 'Keep the whole wheel arch in view.' : 'Overlap the next frame a little.');
}
export function buildFrames(sp: Spec): Frame[] {
  const out: Frame[] = [];
  const segs = segDefs(sp);
  const push = (o: Omit<Frame, 'n' | 'hint' | 'orient' | 'dist'>) => {
    const base = { n: out.length + 1, ...o };
    out.push({ ...base, hint: hintFor(sp, base), ...measure(sp, base) });
  };
  push({ kind: 'front', label: 'Front' });
  push({ kind: 'corner', corner: 'fl', label: 'Front left corner' });
  segs.forEach((s) => push({ kind: 'side', side: 'left', seg: s, label: 'Left ' + segText(s[0], sp, 'left') }));
  push({ kind: 'corner', corner: 'rl', label: 'Rear left corner' });
  push({ kind: 'rear', label: REAR_LABEL[sp.rear] });
  push({ kind: 'corner', corner: 'rr', label: 'Rear right corner' });
  segs.slice().reverse().forEach((s) => push({ kind: 'side', side: 'right', seg: s, label: 'Right ' + segText(s[0], sp, 'right') }));
  push({ kind: 'corner', corner: 'fr', label: 'Front right corner' });
  return out;
}

/* ---------- drawing ---------- */
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const P = (x: number, y: number) => r1(x * 100) + ' ' + r1(-y * 100);
const poly = (pts: Pt[]) => 'M' + pts.map((p) => P(p[0], p[1])).join(' L') + ' Z';

/** Paint for one drawing context. Widths are screen pixels. */
export interface Paint { line: string; fill: string; wheelFill: string; hub: string; stub: string; body: number; detail: number; detailOpacity: number; }
export const PAINT = {
  thumb: { line: '#E2FF1C', fill: 'rgba(226,255,28,0.09)', wheelFill: '#16181C', hub: '#E2FF1C', stub: '#E2FF1C', body: 1.6, detail: 1, detailOpacity: 0.7 } as Paint,
  overlay: { line: '#E2FF1C', fill: 'none', wheelFill: 'none', hub: '#E2FF1C', stub: '#E2FF1C', body: 2.5, detail: 1.5, detailOpacity: 0.85 } as Paint,
  halo: { line: '#000000', fill: 'none', wheelFill: 'none', hub: '#000000', stub: '#000000', body: 5.5, detail: 4, detailOpacity: 0.4 } as Paint,
  silhouette: { line: '#000000', fill: '#E2FF1C', wheelFill: '#000000', hub: '#E2FF1C', stub: '#000000', body: 1.4, detail: 0.9, detailOpacity: 0.55 } as Paint,
};

/** Builds attribute strings for a paint at a given units-per-pixel scale. */
function styler(p: Paint, u: number) {
  const sw = (px: number) => r3(px * u);
  return {
    body: `fill="${p.fill}" stroke="${p.line}" stroke-width="${sw(p.body)}" stroke-linejoin="round"`,
    detail: (extra = '') => `fill="none" stroke="${p.line}" stroke-width="${sw(p.detail)}" stroke-opacity="${p.detailOpacity}" ${extra}`,
    thin: `fill="none" stroke="${p.line}" stroke-width="${sw(p.detail)}" stroke-opacity="${p.detailOpacity * 0.6}"`,
    maybe: `stroke-dasharray="${sw(3)} ${sw(3)}"`,
    wheel: `fill="${p.wheelFill}" stroke="${p.line}" stroke-width="${sw(p.body)}"`,
    hub: `fill="none" stroke="${p.hub}" stroke-width="${sw(p.detail)}" stroke-opacity="${Math.min(1, p.detailOpacity + 0.2)}"`,
    stub: `fill="${p.stub}" fill-opacity="0.55"`,
  };
}
type St = ReturnType<typeof styler>;

function profileInner(sp: Spec, side: 'left' | 'right', st: St): string {
  const b = sp.b;
  let s = `<path ${st.body} d="${poly(b.pts)}"/>`;
  s += `<path ${st.detail()} d="${poly(b.glass)}"/>`;
  b.doors.forEach(([x, y]) => { s += `<path ${st.detail()} d="M${P(x, b.sill + 0.04)} L${P(x, y)}"/>`; });
  if (b.slide && SLIDE_BODIES[sp.body]) {
    const state = sp.slide[side], z = b.slide;
    if (state !== 'no') {
      s += `<rect ${st.detail(state === 'unknown' ? st.maybe : '')} x="${r1(z.x * 100)}" y="${r1(-z.top * 100)}" width="${r1(z.w * 100)}" height="${r1((z.top - b.sill - 0.06) * 100)}" rx="4"/>`;
    }
  }
  b.wheels.forEach((x) => {
    s += `<circle ${st.wheel} cx="${r1(x * 100)}" cy="${r1(-b.r * 100)}" r="${r1(b.r * 100)}"/>`;
    s += `<circle ${st.hub} cx="${r1(x * 100)}" cy="${r1(-b.r * 100)}" r="${r1(b.r * 45)}"/>`;
  });
  return s;
}
function sideView(sp: Spec, side: 'left' | 'right', st: St) {
  return side === 'left' ? profileInner(sp, 'left', st)
    : `<g transform="matrix(-1,0,0,1,${r1(sp.L * 100)},0)">${profileInner(sp, 'right', st)}</g>`;
}
function faceInner(sp: Spec, which: 'front' | 'rear', st: St): string {
  const b = sp.b, f = b.face, W = sp.W, H = sp.H, sill = b.sill, s: string[] = [];
  const R = (x: number, y: number, w: number, h: number, cls: string, rx?: number) =>
    `<rect ${cls} x="${r1(x * 100)}" y="${r1(-(y + h) * 100)}" width="${r1(w * 100)}" height="${r1(h * 100)}"${rx ? ` rx="${rx}"` : ''}/>`;
  const Ln = (x1: number, y1: number, x2: number, y2: number, cls: string) => `<path ${cls} d="M${P(x1, y1)} L${P(x2, y2)}"/>`;
  const outline = (w: number, y0: number, belt: number, top: number, ratio: number) => {
    const hw = w / 2, bw = (w * 0.985) / 2, tw = (w * ratio) / 2, c = 0.07;
    return `M${P(-hw, y0)} L${P(-hw, belt)} L${P(-bw, belt)} L${P(-tw, top - c)} Q${P(-tw, top)} ${P(-tw + c, top)} L${P(tw - c, top)} Q${P(tw, top)} ${P(tw, top - c)} L${P(bw, belt)} L${P(hw, belt)} L${P(hw, y0)} Z`;
  };
  const half = (y: number, w: number, belt: number, top: number, ratio: number) => y <= belt ? w / 2
    : (w * 0.985) / 2 + ((w * ratio) / 2 - (w * 0.985) / 2) * Math.min(1, (y - belt) / (top - belt));
  const stubs = (w: number) => { const x = w / 2 - 0.34; return R(-x - 0.12, 0, 0.24, sill, st.stub, 3) + R(x - 0.12, 0, 0.24, sill, st.stub, 3); };
  const det = st.detail();

  if (which === 'front') {
    const cw = f.cabW || W, ch = f.cabH || H;
    s.push(stubs(cw));
    s.push(`<path ${st.body} d="${outline(cw, sill, f.belt, ch, f.top)}"/>`);
    if (f.box) s.push(R(-W / 2, f.box[0], W, f.box[1] - f.box[0], st.body, 4));
    const y0 = f.belt + 0.06, y1 = f.glassTop;
    const h0 = half(y0, cw, f.belt, ch, f.top) - 0.1, h1 = half(y1, cw, f.belt, ch, f.top) - 0.12;
    s.push(`<path ${det} d="M${P(-h0, y0)} L${P(-h1, y1)} L${P(h1, y1)} L${P(h0, y0)} Z"/>`);
    s.push(R(-cw / 2 + 0.03, sill, cw - 0.06, 0.24, det, 4));
    const gTop = f.belt - 0.08, gBot = Math.max(sill + 0.3, f.belt - 0.42);
    s.push(R(-cw * 0.21, gBot, cw * 0.42, gTop - gBot, det, 4));
    const lw = cw * 0.18, lb = f.belt - 0.28;
    s.push(R(-cw / 2 + 0.06, lb, lw, 0.18, det, 4), R(cw / 2 - 0.06 - lw, lb, lw, 0.18, det, 4));
    if (f.mirrors) { const my = f.belt + 0.12; s.push(R(-cw / 2 - 0.2, my, 0.16, 0.3, det, 4), R(cw / 2 + 0.04, my, 0.16, 0.3, det, 4)); }
    return s.join('');
  }

  const rk = f.rearKind;
  let area: [number, number, number, number];
  let bw = W;
  s.push(stubs(W));
  if (rk === 'greenhouse') {
    s.push(`<path ${st.body} d="${outline(W, sill, f.belt, H, f.top)}"/>`);
    const y0 = f.belt + 0.06, y1 = H - 0.1;
    const h0 = half(y0, W, f.belt, H, f.top) - 0.14, h1 = half(y1, W, f.belt, H, f.top) - 0.14;
    s.push(`<path ${det} d="M${P(-h0, y0)} L${P(-h1, y1)} L${P(h1, y1)} L${P(h0, y0)} Z"/>`);
    s.push(R(-W / 2 + 0.05, f.belt - 0.26, 0.32, 0.16, det, 3), R(W / 2 - 0.37, f.belt - 0.26, 0.32, 0.16, det, 3));
    area = [-W / 2 + 0.1, sill + 0.26, W / 2 - 0.1, f.belt - 0.02];
  } else if (rk === 'pickup') {
    const cw = W * 0.86;
    s.push(`<path ${st.body} d="${outline(cw, 1.1, 1.2, H, 0.82)}"/>`);
    s.push(R(-cw * 0.32, 1.3, cw * 0.64, H - 1.42, det, 6));
    s.push(R(-W / 2, sill, W, 1.18 - sill, st.body, 4));
    area = [-W / 2 + 0.08, sill + 0.26, W / 2 - 0.08, 1.1];
  } else if (rk === 'luton') {
    bw = (f.cabW || W) * 0.9;
    s.push(R(-bw / 2, sill, bw, 0.77 - sill, st.body, 3));
    s.push(R(-W / 2, 0.75, W, H - 0.75, st.body, 4));
    area = [-W / 2 + 0.08, 0.82, W / 2 - 0.08, H - 0.08];
  } else {
    s.push(`<path ${st.body} d="${outline(W, sill, H - 0.3, H, 0.95)}"/>`);
    area = [-W / 2 + 0.07, sill + 0.26, W / 2 - 0.07, H - 0.1];
  }
  s.push(R(-bw / 2 + 0.03, sill, bw - 0.06, 0.24, det, 4));
  const [ax0, ay0, ax1, ay1] = area, aw = ax1 - ax0, ah = ay1 - ay0;
  if (sp.rear === 'barn') {
    s.push(R(ax0, ay0, aw, ah, det, 4), Ln(0, ay0, 0, ay1, det));
  } else if (sp.rear === 'roller') {
    s.push(R(ax0, ay0, aw, ah, det, 4));
    for (let y = ay0 + 0.2; y < ay1 - 0.05; y += 0.22) s.push(Ln(ax0 + 0.04, y, ax1 - 0.04, y, st.thin));
  } else if (sp.rear === 'tailgate') {
    if (rk === 'box' || rk === 'luton') { s.push(R(ax0, ay0, aw, ah, det, 4), R(ax0 + 0.15, ay0 + ah * 0.55, aw - 0.3, ah * 0.38, det, 4)); }
    s.push(R(-0.26, ay0 + 0.06, 0.52, 0.12, det, 2));
  } else {
    s.push(R(ax0, ay0, aw, ah, det, 4), R(-0.1, ay1 - 0.16, 0.2, 0.06, det, 2));
  }
  return s.join('');
}
let clipSeq = 0;
/** A 3/4 corner view: the end face on one side of the corner edge, the first 2.4 m of the flank on the other. */
function cornerParts(sp: Spec, corner: 'fl' | 'fr' | 'rl' | 'rr', st: St) {
  const front = corner === 'fl' || corner === 'fr';
  const mirror = corner === 'fr' || corner === 'rl';
  const detailSide: 'left' | 'right' = corner === 'fl' || corner === 'rl' ? 'left' : 'right';
  const Wh = sp.W * 50, id = 'cc' + ++clipSeq;
  const face = `<g transform="matrix(${CA},${r3(CK * CA)},0,1,${r1(-CA * Wh)},${r1(-CK * CA * Wh)})">${faceInner(sp, front ? 'front' : 'rear', st)}</g>`;
  const prof = front ? profileInner(sp, detailSide, st)
    : `<g transform="matrix(-1,0,0,1,${r1(sp.L * 100)},0)">${profileInner(sp, detailSide, st)}</g>`;
  const side = `<g transform="matrix(${CA},${r3(-CK * CA)},0,1,0,0)"><defs><clipPath id="${id}"><rect x="0" y="${r1(-sp.H * 100 - 40)}" width="${CL * 100}" height="${r1(sp.H * 100 + 60)}"/></clipPath></defs><g clip-path="url(#${id})">${prof}</g></g>`;
  const x0 = -2 * CA * Wh - 14, x1 = CA * CL * 100;
  const y0 = -(sp.H * 100 + CK * Math.max(2 * CA * Wh, CA * CL * 100)), y1 = 0;
  return mirror
    ? { inner: `<g transform="scale(-1,1)">${side}${face}</g>`, bbox: [-x1, y0, -x0, y1] as const }
    : { inner: side + face, bbox: [x0, y0, x1, y1] as const };
}
function frameGeom(sp: Spec, f: Frame, st: St): { inner: string; bbox: readonly [number, number, number, number] } {
  if (f.kind === 'side') {
    const L = sp.L * 100, a = f.seg![1] * L, b = f.seg![2] * L;
    return { inner: sideView(sp, f.side!, st), bbox: f.side === 'left' ? [a, -sp.H * 100, b, 0] : [L - b, -sp.H * 100, L - a, 0] };
  }
  if (f.kind === 'front' || f.kind === 'rear') {
    const hw = (sp.W / 2 + (f.kind === 'front' ? 0.22 : 0.04)) * 100;
    return { inner: faceInner(sp, f.kind, st), bbox: [-hw, -sp.H * 100, hw, 0] };
  }
  return cornerParts(sp, f.corner!, st);
}
/** A viewBox of the given aspect (width / height) with the box centred and filling `fill` of it. */
function fitBox(bb: readonly number[], aspect: number, fill: number): [number, number, number, number] {
  const w = bb[2] - bb[0], h = bb[3] - bb[1];
  const vbW = Math.max(w / fill, (h / fill) * aspect), vbH = vbW / aspect;
  return [(bb[0] + bb[2]) / 2 - vbW / 2, (bb[1] + bb[3]) / 2 - vbH / 2, vbW, vbH];
}
/** Units-per-pixel for a drawing whose bbox fills `fill` of a viewBox drawn `px` wide. */
function unitsFor(bb: readonly number[], aspect: number, fill: number, px: number) {
  const vb = fitBox(bb, aspect, fill);
  return { vb, u: vb[2] / px };
}

/** Thumbnail with a dark viewfinder background, corner brackets and ground line. */
export function frameThumbSVG(sp: Spec, f: Frame, px = 128): string {
  const aspect = 3 / 4;
  const probe = frameGeom(sp, f, styler(PAINT.thumb, 1));
  const { vb, u } = unitsFor(probe.bbox, aspect, 0.86, px * aspect);
  const g = frameGeom(sp, f, styler(PAINT.thumb, u));
  const [vx, vy, vbW, vbH] = vb;
  const m = Math.min(vbW, vbH), i = m * 0.06, l = m * 0.14;
  const x0 = r1(vx + i), y0 = r1(vy + i), x1 = r1(vx + vbW - i), y1 = r1(vy + vbH - i), ll = r1(l);
  const br = `M${x0} ${r1(y0 + ll)} V${y0} H${r1(x0 + ll)} M${r1(x1 - ll)} ${y0} H${x1} V${r1(y0 + ll)} M${x1} ${r1(y1 - ll)} V${y1} H${r1(x1 - ll)} M${r1(x0 + ll)} ${y1} H${x0} V${r1(y1 - ll)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(vx)} ${r1(vy)} ${r1(vbW)} ${r1(vbH)}">`
    + `<rect x="${r1(vx)}" y="${r1(vy)}" width="${r1(vbW)}" height="${r1(vbH)}" fill="#16181C"/>`
    + `<path d="M${r1(vx)} 0 H${r1(vx + vbW)}" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="${r3(u)}"/>`
    + g.inner + `<path d="${br}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="${r3(1.5 * u)}"/></svg>`;
}

export const OVERLAY_FILL = 0.82;
/** Live camera overlay: the outline drawn twice (dark halo, yellow line) for a preview `pxW` wide with the given aspect. */
export function overlaySVG(sp: Spec, f: Frame, aspect: number, pxW: number): string {
  const probe = frameGeom(sp, f, styler(PAINT.overlay, 1));
  const { vb, u } = unitsFor(probe.bbox, aspect, OVERLAY_FILL, pxW);
  const halo = frameGeom(sp, f, styler(PAINT.halo, u));
  const line = frameGeom(sp, f, styler(PAINT.overlay, u));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(r1).join(' ')}" preserveAspectRatio="none">`
    + `<path d="M${r1(vb[0])} 0 H${r1(vb[0] + vb[2])}" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="${r3(1.5 * u)}" stroke-dasharray="${r3(6 * u)} ${r3(6 * u)}"/>`
    + halo.inner + line.inner + `</svg>`;
}

/** Side profile at one fixed scale (fit = false) so a car looks smaller than a Sprinter. */
export function silhouetteSVG(sp: Spec, px: number, fit = false, ground = '#565C66'): string {
  const vb = fit ? [-20, -(sp.H * 100 + 16), sp.L * 100 + 40, sp.H * 100 + 26] : [-20, -335, 760, 355];
  const u = vb[2] / px;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(r1).join(' ')}"><path d="M${vb[0]} 0 H${r1(vb[0] + vb[2])}" stroke="${ground}" stroke-width="${r3(u)}"/>${profileInner(sp, 'left', styler(PAINT.silhouette, u))}</svg>`;
}

/** Top-down walk-around map: front on the left, the vehicle's left side at the bottom. */
export function mapSVG(sp: Spec, frames: Frame[], c: { ink: string; ink2: string; paper: string; page: string }): string {
  const L = sp.L * 100, Wh = sp.W * 50, m = 122, d = 88, pad = 58, rr = 44;
  const vb = [-m - pad, -Wh - m - pad, L + 2 * (m + pad), 2 * (Wh + m + pad)];
  const hood = sp.b.hood * 100;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(r1).join(' ')}">`;
  s += `<rect x="${-m}" y="${r1(-Wh - m)}" width="${r1(L + 2 * m)}" height="${r1(2 * (Wh + m))}" rx="${r1(m * 0.9)}" fill="none" stroke="${c.ink2}" stroke-width="3" stroke-dasharray="10 12"/>`;
  sp.b.wheels.forEach((x) => { const cx = x * 100; s += `<rect x="${r1(cx - 32)}" y="${r1(-Wh - 10)}" width="64" height="${r1(2 * Wh + 20)}" rx="8" fill="${c.ink}"/>`; });
  s += `<rect x="0" y="${r1(-Wh)}" width="${r1(L)}" height="${r1(2 * Wh)}" rx="24" fill="${c.paper}" stroke="${c.ink}" stroke-width="5"/>`;
  const gx = Math.max(hood, 30);
  s += `<path d="M${r1(gx)} ${r1(-Wh + 14)} L${r1(gx)} ${r1(Wh - 14)} M${r1(gx + 46)} ${r1(-Wh + 14)} L${r1(gx + 46)} ${r1(Wh - 14)}" fill="none" stroke="${c.ink}" stroke-width="3"/>`;
  s += `<rect x="${r1(gx + 20)}" y="${r1(-Wh - 26)}" width="22" height="18" rx="4" fill="${c.ink}"/><rect x="${r1(gx + 20)}" y="${r1(Wh + 8)}" width="22" height="18" rx="4" fill="${c.ink}"/>`;
  const ax = Math.min(L * 0.62, gx + 200), aw = Math.min(110, L * 0.18);
  s += `<path d="M${r1(ax)} 0 L${r1(ax + aw)} -30 L${r1(ax + aw)} 30 Z" fill="${c.ink}" fill-opacity="0.25"/>`;
  frames.forEach((f) => {
    let x = 0, y = 0, tx = 0, ty = 0;
    if (f.kind === 'front') { x = -m; y = 0; tx = 0; ty = 0; }
    else if (f.kind === 'rear') { x = L + m; y = 0; tx = L; ty = 0; }
    else if (f.kind === 'side') {
      const cx = ((f.seg![1] + f.seg![2]) / 2) * L;
      if (f.side === 'left') { x = cx; y = Wh + m; tx = cx; ty = Wh; } else { x = cx; y = -Wh - m; tx = cx; ty = -Wh; }
    } else {
      const atFront = f.corner === 'fl' || f.corner === 'fr', left = f.corner === 'fl' || f.corner === 'rl';
      x = atFront ? -d : L + d; y = left ? Wh + d : -Wh - d; tx = atFront ? 0 : L; ty = left ? Wh : -Wh;
    }
    const dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const a0 = rr + 4, a1 = Math.min(len - 10, rr + 30);
    s += `<path d="M${r1(x + ux * a0)} ${r1(y + uy * a0)} L${r1(x + ux * a1)} ${r1(y + uy * a1)}" stroke="${c.ink}" stroke-width="6" stroke-linecap="round"/>`
      + `<circle cx="${r1(x)}" cy="${r1(y)}" r="${rr}" fill="${c.ink}"/>`
      + `<text x="${r1(x)}" y="${r1(y + 16)}" text-anchor="middle" font-size="46" font-weight="700" fill="${c.paper}">${f.n}</text>`;
  });
  return s + '</svg>';
}

export function attrPills(sp: Spec, attrs: Partial<VehicleAttrs> | null, nFrames?: number): string[] {
  const p: string[] = [];
  if ((sp.body === 'large' || sp.body === 'mid') && attrs && attrs.roof && attrs.roof !== 'unknown') p.push(attrs.roof === 'high' ? 'Raised roof' : 'Standard roof');
  if (SLIDE_BODIES[sp.body]) {
    const t = (s: Tri) => (s === 'yes' ? 'sliding door' : s === 'no' ? 'no sliding door' : 'not seen');
    p.push('Left: ' + t(sp.slide.left), 'Right: ' + t(sp.slide.right));
  }
  p.push(REAR_PILL[sp.rear]);
  if (nFrames) p.push(`${nFrames} frames`);
  return p;
}
