import type { RearKind, Tri } from './frames';

export type Tier = 'quick' | 'default' | 'complex';
export const TIERS: [Tier, string][] = [['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Best']];
export const TIER_NAME: Record<Tier, string> = { quick: 'Fast', default: 'Balanced', complex: 'Best' };
/** Same table as functions/src/models.ts. Prices are list prices per million tokens, input and output. */
export const TIER_MODEL: Record<Tier, { id: string; name: string; inPerM: number; outPerM: number; note: string }> = {
  quick: { id: 'claude-haiku-5-5', name: 'Haiku 5.5', inPerM: 0.1, outPerM: 0.5, note: 'Cheapest and fastest.' },
  default: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', inPerM: 2, outPerM: 10, note: 'The default. Mid price.' },
  complex: { id: 'claude-opus-5-5', name: 'Opus 5.5', inPerM: 4, outPerM: 20, note: 'The largest model. Slowest and most expensive.' },
};
/** Rough cost of one photo: the server sizes it to the 4,784-token image limit, plus about 150 output tokens. */
export const perPhotoCost = (t: Tier) => (4784 * TIER_MODEL[t].inPerM + 150 * TIER_MODEL[t].outPerM) / 1e6;

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  cls: string;
  roof: 'high' | 'low' | 'unknown';
  slideL: Tri;
  slideR: Tri;
  rear: RearKind | 'unknown';
  make: string | null;
  model: string | null;
  scanId: string | null;
  createdAt: number;
  createdBy: string | null;
}

/** A photo either still on this phone (uri) or uploaded (path in storage). */
export interface Photo {
  n: number;
  label: string;
  uri?: string;
  path?: string;
  w: number;
  h: number;
  takenAt: number;
}

export interface Walkaround {
  id: string;
  vehicleId: string;
  vehicleName: string;
  cls: string;
  source: 'camera' | 'library';
  createdAt: number;
  createdBy: string | null;
  totalMs: number | null;
  frames: number;
  taken: number;
  skipped: number;
  retakes: number;
  photos: Photo[];
}

export interface Usage {
  ms: number;
  calls: number;
  images: number;
  inTok: number;
  outTok: number;
  cost: number;
}

export type VerdictKind = 'damage' | 'dirt' | 'reflection' | 'no_damage' | 'unclear' | 'skipped';
export interface Verdict {
  verdict: VerdictKind;
  type: string | null;
  sizeCm: number | null;
  severity: 'cosmetic' | 'repair' | null;
  confidence: number | null;
  reason: string;
  ms: number | null;
  closeupBox: [number, number, number, number] | null;
}

export interface Spot {
  photo: number;
  photoLabel: string;
  box: [number, number, number, number];
  panel: string;
  type: string;
  sizeCm: number | null;
  conf: number;
  mightBe: 'dirt' | 'reflection' | null;
  closeup: string;
  refPath: string | null;
  closeups: string[];
  verdict: Verdict | null;
  feedback: 'right' | 'wrong' | null;
  /** The first close-up with the damage boxed, when the AI found damage. */
  markPath?: string | null;
}

export interface Check {
  id: string;
  vehicleId: string;
  vehicleName: string;
  cls: string;
  walkId: string;
  createdAt: number;
  createdBy: string | null;
  tier: Tier;
  model: string;
  photos: number;
  pass1: Usage | null;
  pass2: Usage | null;
  spots: Spot[];
  notVisible: string[];
  missedNote: string;
}

export interface Scan {
  id: string;
  createdAt: number;
  createdBy: string | null;
  tier: Tier;
  model: string;
  ms: number;
  photos: number;
  inTok: number;
  outTok: number;
  cost: number;
  predicted: string | null;
  confidence: number | null;
  vMake: string | null;
  vModel: string | null;
  roof: Vehicle['roof'];
  slideL: Tri;
  slideR: Tri;
  rear: Vehicle['rear'];
  verdict: 'correct' | 'wrong' | null;
  actual: string | null;
}

export interface IdentifyResult {
  scan: Scan;
  reason: string | null;
  issues: string[];
  alternatives: { cls: string; confidence: number | null }[];
}

export interface Org {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
}

export interface Member {
  uid: string;
  role: 'admin' | 'driver';
  email: string;
  name: string;
}
