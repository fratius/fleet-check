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
  /** The station (operating area) the van belongs to. Missing on vans saved before stations existed. */
  stationId?: string;
  createdAt: number;
  createdBy: string | null;
}

/** An operating area of a company, such as an Amazon delivery station. */
export interface Station {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

/**
 * Who can do what:
 * - creator: the app creator (a sign-in claim, not a company role); sees and manages every company
 * - owner: owns the company; manages stations, managers, drivers and vans everywhere in it
 * - manager: the same for their own station(s); has the final word on damage
 * - driver: scans the vans of their station
 */
export type Role = 'owner' | 'manager' | 'driver';
export const ROLE_NAME: Record<Role | 'creator', string> = { creator: 'App creator', owner: 'Fleet owner', manager: 'Fleet manager', driver: 'Driver' };

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
  stationId?: string;
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

/** The manager's final word on one spot. */
export interface Decision {
  damage: boolean;
  note: string;
  by: string;
  byName: string;
  at: number;
}
/** Damage the AI didn't mark, added by the manager during review. */
export interface ManualDamage {
  panel: string;
  type: string;
  note: string;
  by: string;
  byName: string;
  at: number;
}
/**
 * checking: AI spots found, the driver is taking close-ups
 * submitted: the driver sent it to the manager
 * reviewed: a manager approved or rejected every spot
 */
export type CheckStatus = 'checking' | 'submitted' | 'reviewed';
export interface Review {
  decisions: Record<string, Decision>;
  manual: ManualDamage[];
  by: string | null;
  byName: string | null;
  at: number | null;
}

export interface Check {
  id: string;
  vehicleId: string;
  stationId?: string;
  status?: CheckStatus;
  createdByName?: string;
  submittedAt?: number | null;
  review?: Review | null;
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
  stationId?: string | null;
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
  createdBy: string;
  createdAt?: number;
  /** Set once the company has stations and every van, walk-around and check belongs to one. */
  stationsReady?: boolean;
  /** AI model for every check in the company, chosen by the owner. */
  aiTier?: Tier;
  /** A demo company full of made-up data. */
  demo?: boolean;
}

export interface Member {
  uid: string;
  /** 'admin' is the role name before stations existed; it means owner. */
  role: Role | 'admin';
  /** Stations a manager or driver works at. Owners see every station. */
  stationIds?: string[];
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** Amazon Transporter ID of a driver, if they gave it. */
  transporterId?: string;
  joinedAt?: number;
  /** A made-up person in a demo company. */
  demo?: boolean;
}

/** An invite link: one person can use it, within 24 hours, to join with this role at this station. */
export interface Invite {
  token: string;
  orgId: string;
  orgName: string;
  role: 'manager' | 'driver';
  stationId: string;
  stationName: string;
  createdBy: string;
  createdByName?: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedByName: string | null;
  usedAt: number | null;
}
export interface InvitePeek {
  status: 'ok' | 'used' | 'expired' | 'missing' | 'mine';
  orgName?: string;
  role?: 'manager' | 'driver';
  stationName?: string;
  invitedBy?: string;
  expiresAt?: number;
}
export interface JoinDetails { firstName: string; lastName: string; phone: string; transporterId: string }

/** Normalised role: 'admin' is an owner. */
export const roleOf = (m: Pick<Member, 'role'> | null | undefined): Role | null => (!m ? null : m.role === 'admin' ? 'owner' : m.role);

/** A spot counts as approved damage when the manager said so. Before review, the AI verdict is only a suggestion. */
export interface ApprovedDamage { panel: string; type: string; sizeCm: number | null; note: string; spot: number | null }
export function approvedDamage(k: Check): ApprovedDamage[] {
  const r = k.review;
  if (!r || k.status !== 'reviewed') return [];
  const out = k.spots.flatMap((p, i): ApprovedDamage[] => {
    const d = r.decisions?.[String(i)];
    return d?.damage ? [{ panel: p.panel, type: (p.verdict?.verdict === 'damage' && p.verdict.type) || p.type, sizeCm: p.verdict?.sizeCm ?? p.sizeCm, note: d.note, spot: i }] : [];
  });
  return out.concat((r.manual || []).map((m): ApprovedDamage => ({ panel: m.panel, type: m.type, sizeCm: null, note: m.note, spot: null })));
}

/** Was the AI right about a spot, judged by the manager's decision (or the older right/wrong buttons)? */
export function aiWasRight(k: Check, i: number): boolean | null {
  const p = k.spots[i];
  const d = k.review?.decisions?.[String(i)];
  if (d) {
    const v = p.verdict?.verdict;
    if (!v || v === 'unclear' || v === 'skipped') return null;
    return (v === 'damage') === d.damage;
  }
  return p.feedback ? p.feedback === 'right' : null;
}
