/**
 * Body shapes per van model, for the walk-around outlines (lib/outline.ts) and the 3D damage map (lib/van3d.ts).
 *
 * A van's make and model (read from its photos when it was added) pick a family: Sprinter, Transit, Crafter,
 * Ducato and its twins, and so on. The family gives the real proportions (length, wheelbase, overhangs, roof
 * height, the shape of the nose and windscreen, where the doors, lights and grille are), so the outline on the
 * camera matches the van in front of the driver, not a generic box. Vans whose model isn't known, and cars,
 * pickups, walk-in and box vans, use their body class's shape with the same details added.
 *
 * Numbers are metres from published dimensions, rounded: x back from the front bumper, y up from the ground.
 * They only need to be close enough to line a photo up with; the driver fits the van to the outline.
 *
 * Model and family names are names (not translated).
 */
import type { BodyKind, VehicleClass } from './frames';

export type Pt = [number, number];

/** Headlight shapes, seen from the front. */
export type LampStyle = 'swept' | 'band' | 'high' | 'tall';

export interface Fam {
  id: string;
  name: string;
  body: BodyKind;
  /** Tested against "make model" in lower case without accents. */
  match: RegExp;
  W: number;
  /** Wheel radius, and the height of the bottom edge of the body sides. */
  r: number;
  sill: number;
  /** Length, front axle, rear axle: the usual version, and the long one (class "extra long"). */
  std: [number, number, number];
  long?: [number, number, number];
  /** Roof heights: standard and raised; which one when the photos didn't tell. */
  roofLow: number;
  roofHigh: number;
  roofDef: 'low' | 'high';
  /** Front contour from the bottom of the bumper up to the top of the windscreen. */
  nose: Pt[];
  /** Where a raised roof reaches its full height (it rises from the top of the windscreen). */
  roofAt: number;
  /** Bottom of the side windows, top of the side glass, the cab door's rear edge (B-pillar). */
  belt: number;
  glassTop: number;
  bPillar: number;
  bumperTop: number;
  rearBumperTop: number;
  lamp: { style: LampStyle; y0: number; y1: number; zIn: number };
  grille: { y0: number; y1: number; wTop: number; wBot: number };
  /** Tail lights: bottom, top, width. */
  tail: [number, number, number];
  /** Sliding door: front edge x and width. */
  slide: [number, number];
  /** Lower trim line along the side (cladding), or null. */
  trim: number | null;
  /** Roof width as a share of the body width (the sides lean in above the windows). */
  tumble: number;
}

// Noses are written for a reference van and moved with the bumper height where needed.
export const FAMILIES: Fam[] = [
  { id: 'sprinter', name: 'Mercedes-Benz Sprinter', body: 'large', match: /\bsprinter\b|e-?sprinter/,
    W: 2.02, r: 0.355, sill: 0.42, std: [5.93, 0.99, 4.655], long: [6.97, 0.99, 5.315], roofLow: 2.36, roofHigh: 2.62, roofDef: 'high',
    nose: [[0.06, 0.34], [0, 0.42], [0, 0.58], [0.05, 0.64], [0.12, 0.86], [0.17, 1.02], [0.5, 1.16], [0.82, 1.27], [1.52, 2.0]],
    roofAt: 1.98, belt: 1.27, glassTop: 1.92, bPillar: 2.08, bumperTop: 0.64, rearBumperTop: 0.58,
    lamp: { style: 'swept', y0: 0.92, y1: 1.16, zIn: 0.5 }, grille: { y0: 0.66, y1: 1.0, wTop: 0.92, wBot: 1.0 },
    tail: [0.62, 1.25, 0.13], slide: [2.2, 1.3], trim: 0.6, tumble: 0.93 },
  { id: 'transit', name: 'Ford Transit', body: 'large', match: /\b(e-)?transit\b(?!\s*(custom|connect|courier))/,
    W: 2.05, r: 0.355, sill: 0.44, std: [5.98, 1.0, 4.75], long: [6.7, 1.0, 4.75], roofLow: 2.29, roofHigh: 2.55, roofDef: 'high',
    nose: [[0.06, 0.38], [0, 0.46], [0, 0.66], [0.06, 0.72], [0.12, 0.92], [0.18, 1.1], [0.55, 1.24], [0.95, 1.36], [1.62, 2.02]],
    roofAt: 1.95, belt: 1.32, glassTop: 1.95, bPillar: 2.05, bumperTop: 0.72, rearBumperTop: 0.6,
    lamp: { style: 'swept', y0: 0.93, y1: 1.22, zIn: 0.55 }, grille: { y0: 0.74, y1: 1.06, wTop: 1.0, wBot: 1.16 },
    tail: [0.64, 1.3, 0.14], slide: [2.15, 1.3], trim: 0.62, tumble: 0.93 },
  { id: 'crafter', name: 'Volkswagen Crafter / MAN TGE', body: 'large', match: /crafter|\btge\b/,
    W: 2.04, r: 0.355, sill: 0.42, std: [5.99, 0.98, 4.62], long: [6.84, 0.98, 4.62], roofLow: 2.36, roofHigh: 2.59, roofDef: 'high',
    nose: [[0.06, 0.37], [0, 0.45], [0, 0.62], [0.05, 0.68], [0.1, 0.9], [0.14, 1.06], [0.5, 1.19], [0.86, 1.3], [1.55, 2.04]],
    roofAt: 1.95, belt: 1.28, glassTop: 1.95, bPillar: 2.05, bumperTop: 0.68, rearBumperTop: 0.6,
    lamp: { style: 'band', y0: 0.94, y1: 1.12, zIn: 0.56 }, grille: { y0: 0.92, y1: 1.1, wTop: 1.12, wBot: 1.12 },
    tail: [0.6, 1.36, 0.13], slide: [2.12, 1.31], trim: 0.6, tumble: 0.93 },
  { id: 'ducato', name: 'Fiat Ducato / Peugeot Boxer / Citroën Jumper / Opel Movano', body: 'large',
    match: /ducato|\bboxer\b|\bjumper\b|proace max|movano/,
    W: 2.05, r: 0.37, sill: 0.42, std: [6.0, 0.95, 4.985], long: [6.36, 0.95, 4.985], roofLow: 2.25, roofHigh: 2.52, roofDef: 'high',
    nose: [[0.06, 0.33], [0, 0.42], [0, 0.78], [0.06, 0.84], [0.12, 1.02], [0.16, 1.18], [0.4, 1.28], [0.62, 1.36], [1.12, 2.05]],
    roofAt: 1.5, belt: 1.36, glassTop: 2.0, bPillar: 1.85, bumperTop: 0.84, rearBumperTop: 0.58,
    lamp: { style: 'high', y0: 1.0, y1: 1.2, zIn: 0.62 }, grille: { y0: 1.02, y1: 1.14, wTop: 1.1, wBot: 1.1 },
    tail: [0.56, 1.22, 0.13], slide: [1.95, 1.25], trim: null, tumble: 0.94 },
  { id: 'master', name: 'Renault Master / Nissan Interstar', body: 'large', match: /\bmaster\b|interstar|nv400/,
    W: 2.07, r: 0.35, sill: 0.43, std: [6.2, 0.84, 5.172], long: [6.85, 0.84, 5.172], roofLow: 2.29, roofHigh: 2.49, roofDef: 'high',
    nose: [[0.06, 0.38], [0, 0.46], [0, 0.66], [0.06, 0.72], [0.11, 0.94], [0.15, 1.12], [0.5, 1.25], [0.85, 1.36], [1.42, 2.02]],
    roofAt: 1.8, belt: 1.32, glassTop: 1.97, bPillar: 2.0, bumperTop: 0.72, rearBumperTop: 0.6,
    lamp: { style: 'tall', y0: 0.9, y1: 1.2, zIn: 0.6 }, grille: { y0: 0.74, y1: 1.02, wTop: 0.95, wBot: 1.0 },
    tail: [0.6, 1.3, 0.13], slide: [2.15, 1.27], trim: 0.62, tumble: 0.94 },
  { id: 'daily', name: 'Iveco Daily', body: 'large', match: /\be?daily\b/,
    W: 2.01, r: 0.345, sill: 0.5, std: [6.27, 0.88, 4.4], long: [7.17, 0.88, 4.98], roofLow: 2.3, roofHigh: 2.6, roofDef: 'high',
    nose: [[0.06, 0.45], [0, 0.52], [0, 0.76], [0.06, 0.82], [0.12, 1.02], [0.16, 1.2], [0.45, 1.32], [0.78, 1.42], [1.3, 2.18]],
    roofAt: 1.65, belt: 1.42, glassTop: 2.05, bPillar: 1.95, bumperTop: 0.82, rearBumperTop: 0.66,
    lamp: { style: 'tall', y0: 0.98, y1: 1.22, zIn: 0.6 }, grille: { y0: 0.84, y1: 1.12, wTop: 0.9, wBot: 0.95 },
    tail: [0.7, 1.35, 0.13], slide: [2.05, 1.2], trim: null, tumble: 0.94 },

  { id: 'vito', name: 'Mercedes-Benz Vito', body: 'mid', match: /\be?vito\b|v-?class/,
    W: 1.93, r: 0.33, sill: 0.36, std: [5.14, 0.92, 4.12], long: [5.37, 0.92, 4.35], roofLow: 1.91, roofHigh: 1.91, roofDef: 'low',
    nose: [[0.06, 0.32], [0, 0.4], [0, 0.6], [0.06, 0.66], [0.12, 0.84], [0.2, 0.95], [0.6, 1.06], [1.05, 1.15], [1.78, 1.82]],
    roofAt: 1.95, belt: 1.13, glassTop: 1.76, bPillar: 2.2, bumperTop: 0.66, rearBumperTop: 0.56,
    lamp: { style: 'swept', y0: 0.8, y1: 0.97, zIn: 0.5 }, grille: { y0: 0.66, y1: 0.94, wTop: 0.86, wBot: 0.9 },
    tail: [0.85, 1.32, 0.12], slide: [2.25, 0.95], trim: null, tumble: 0.9 },
  { id: 'transit_custom', name: 'Ford Transit Custom', body: 'mid', match: /transit custom|tourneo custom/,
    W: 2.0, r: 0.35, sill: 0.38, std: [5.05, 0.95, 4.05], long: [5.45, 0.95, 4.45], roofLow: 1.97, roofHigh: 2.42, roofDef: 'low',
    nose: [[0.06, 0.36], [0, 0.44], [0, 0.66], [0.06, 0.72], [0.1, 0.9], [0.15, 1.04], [0.6, 1.13], [1.02, 1.2], [1.78, 1.86]],
    roofAt: 2.1, belt: 1.2, glassTop: 1.8, bPillar: 2.1, bumperTop: 0.72, rearBumperTop: 0.58,
    lamp: { style: 'swept', y0: 0.86, y1: 1.03, zIn: 0.55 }, grille: { y0: 0.7, y1: 1.02, wTop: 0.96, wBot: 1.06 },
    tail: [0.82, 1.36, 0.12], slide: [2.2, 1.03], trim: null, tumble: 0.9 },
  { id: 'transporter', name: 'Volkswagen Transporter', body: 'mid', match: /transporter|\bt6(\.1)?\b|\bt5\b|id\.? ?buzz/,
    W: 1.9, r: 0.35, sill: 0.36, std: [4.9, 0.89, 3.89], long: [5.3, 0.89, 4.29], roofLow: 1.99, roofHigh: 2.18, roofDef: 'low',
    nose: [[0.06, 0.34], [0, 0.42], [0, 0.6], [0.05, 0.66], [0.1, 0.82], [0.14, 0.94], [0.5, 1.03], [0.9, 1.1], [1.65, 1.84]],
    roofAt: 2.0, belt: 1.13, glassTop: 1.78, bPillar: 1.95, bumperTop: 0.66, rearBumperTop: 0.56,
    lamp: { style: 'band', y0: 0.82, y1: 0.95, zIn: 0.48 }, grille: { y0: 0.82, y1: 0.95, wTop: 0.96, wBot: 0.96 },
    tail: [0.85, 1.3, 0.12], slide: [2.0, 1.02], trim: null, tumble: 0.9 },
  { id: 'trafic', name: 'Renault Trafic / Nissan Primastar', body: 'mid', match: /trafic|primastar|nv300|talento/,
    W: 1.96, r: 0.35, sill: 0.38, std: [5.0, 0.89, 3.99], long: [5.4, 0.89, 4.39], roofLow: 1.97, roofHigh: 2.5, roofDef: 'low',
    nose: [[0.06, 0.36], [0, 0.44], [0, 0.64], [0.06, 0.7], [0.1, 0.86], [0.15, 1.0], [0.55, 1.1], [0.92, 1.18], [1.7, 1.85]],
    roofAt: 2.0, belt: 1.18, glassTop: 1.8, bPillar: 2.0, bumperTop: 0.7, rearBumperTop: 0.58,
    lamp: { style: 'tall', y0: 0.84, y1: 1.02, zIn: 0.55 }, grille: { y0: 0.7, y1: 0.98, wTop: 0.8, wBot: 0.86 },
    tail: [0.85, 1.35, 0.12], slide: [2.05, 1.03], trim: null, tumble: 0.9 },
  { id: 'expert', name: 'Peugeot Expert / Citroën Jumpy / Opel Vivaro / Toyota Proace', body: 'mid',
    match: /\bexpert\b|jumpy|dispatch|vivaro|scudo|proace(?!\s*(max|city))/,
    W: 1.92, r: 0.34, sill: 0.36, std: [4.96, 0.89, 4.165], long: [5.31, 0.89, 4.165], roofLow: 1.94, roofHigh: 1.94, roofDef: 'low',
    nose: [[0.06, 0.36], [0, 0.44], [0, 0.62], [0.06, 0.68], [0.1, 0.86], [0.16, 0.98], [0.58, 1.08], [0.95, 1.15], [1.7, 1.82]],
    roofAt: 2.0, belt: 1.15, glassTop: 1.78, bPillar: 2.0, bumperTop: 0.68, rearBumperTop: 0.56,
    lamp: { style: 'swept', y0: 0.84, y1: 0.98, zIn: 0.5 }, grille: { y0: 0.7, y1: 0.96, wTop: 0.86, wBot: 0.96 },
    tail: [0.85, 1.3, 0.12], slide: [2.1, 0.93], trim: null, tumble: 0.9 },

  { id: 'caddy', name: 'Volkswagen Caddy', body: 'compact', match: /\bcaddy\b/,
    W: 1.86, r: 0.32, sill: 0.34, std: [4.5, 0.82, 3.575], long: [4.85, 0.82, 3.79], roofLow: 1.83, roofHigh: 1.83, roofDef: 'low',
    nose: [[0.05, 0.32], [0, 0.4], [0, 0.58], [0.06, 0.64], [0.14, 0.78], [0.24, 0.86], [0.6, 0.95], [0.98, 1.03], [1.6, 1.7]],
    roofAt: 2.0, belt: 1.03, glassTop: 1.6, bPillar: 1.95, bumperTop: 0.64, rearBumperTop: 0.55,
    lamp: { style: 'band', y0: 0.72, y1: 0.85, zIn: 0.45 }, grille: { y0: 0.72, y1: 0.84, wTop: 0.9, wBot: 0.9 },
    tail: [0.85, 1.25, 0.12], slide: [2.05, 0.7], trim: null, tumble: 0.88 },
  { id: 'berlingo', name: 'Citroën Berlingo / Peugeot Partner / Opel Combo', body: 'compact',
    match: /berlingo|\bpartner\b|\bcombo\b|proace city|rifter|doblo/,
    W: 1.85, r: 0.32, sill: 0.35, std: [4.4, 0.81, 3.595], long: [4.75, 0.81, 3.785], roofLow: 1.84, roofHigh: 1.84, roofDef: 'low',
    nose: [[0.05, 0.33], [0, 0.42], [0, 0.6], [0.06, 0.66], [0.13, 0.8], [0.22, 0.9], [0.6, 0.98], [0.95, 1.05], [1.55, 1.72]],
    roofAt: 2.0, belt: 1.05, glassTop: 1.62, bPillar: 1.92, bumperTop: 0.66, rearBumperTop: 0.55,
    lamp: { style: 'swept', y0: 0.76, y1: 0.9, zIn: 0.45 }, grille: { y0: 0.66, y1: 0.86, wTop: 0.8, wBot: 0.9 },
    tail: [0.85, 1.25, 0.12], slide: [2.0, 0.68], trim: null, tumble: 0.88 },
  { id: 'kangoo', name: 'Renault Kangoo / Mercedes-Benz Citan', body: 'compact', match: /kangoo|\bcitan\b|townstar/,
    W: 1.86, r: 0.32, sill: 0.36, std: [4.49, 0.85, 3.566], long: [4.91, 0.85, 3.95], roofLow: 1.86, roofHigh: 1.86, roofDef: 'low',
    nose: [[0.05, 0.34], [0, 0.42], [0, 0.6], [0.06, 0.66], [0.13, 0.8], [0.22, 0.9], [0.6, 0.98], [0.98, 1.06], [1.58, 1.74]],
    roofAt: 2.0, belt: 1.06, glassTop: 1.63, bPillar: 1.95, bumperTop: 0.66, rearBumperTop: 0.56,
    lamp: { style: 'swept', y0: 0.76, y1: 0.9, zIn: 0.45 }, grille: { y0: 0.66, y1: 0.86, wTop: 0.8, wBot: 0.9 },
    tail: [0.85, 1.25, 0.12], slide: [2.05, 0.7], trim: null, tumble: 0.88 },
  { id: 'connect', name: 'Ford Transit Connect', body: 'compact', match: /transit connect|tourneo connect/,
    W: 1.84, r: 0.32, sill: 0.35, std: [4.42, 0.85, 3.51], long: [4.83, 0.85, 3.91], roofLow: 1.83, roofHigh: 1.83, roofDef: 'low',
    nose: [[0.05, 0.33], [0, 0.42], [0, 0.6], [0.06, 0.66], [0.13, 0.8], [0.22, 0.9], [0.6, 0.98], [0.98, 1.05], [1.58, 1.7]],
    roofAt: 2.0, belt: 1.05, glassTop: 1.6, bPillar: 1.95, bumperTop: 0.66, rearBumperTop: 0.55,
    lamp: { style: 'swept', y0: 0.76, y1: 0.9, zIn: 0.45 }, grille: { y0: 0.66, y1: 0.88, wTop: 0.84, wBot: 0.92 },
    tail: [0.85, 1.25, 0.12], slide: [2.05, 0.68], trim: null, tumble: 0.88 },
];

/**
 * When the model isn't known: an average van of the class (the same numbers as the class drawings had, with the
 * nose and details of a typical van of that size).
 */
const GENERIC: Record<'compact' | 'mid' | 'large', Fam> = {
  large: { ...FAMILIES[0], id: 'large', name: '', match: /$^/ },
  mid: { ...FAMILIES[7], id: 'mid', name: '', match: /$^/ },
  compact: { ...FAMILIES[12], id: 'compact', name: '', match: /$^/ },
};

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The family for a make and model, if it has the class's body (the class wins when the two disagree). */
export function familyOf(make: string | null | undefined, model: string | null | undefined, body: BodyKind): Fam | null {
  const s = plain(`${make || ''} ${model || ''}`).trim();
  if (!s) return null;
  const f = FAMILIES.find((x) => x.match.test(s));
  return f && f.body === body ? f : null;
}

/** The family used for a van: its model's, else the class's average van (only vans have one). */
export function shapeFamily(c: VehicleClass, make?: string | null, model?: string | null): Fam | null {
  if (c.body !== 'compact' && c.body !== 'mid' && c.body !== 'large') return null;
  return familyOf(make, model, c.body) || GENERIC[c.body];
}
