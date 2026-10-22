import type { RearKind, Tri } from './frames';

export type Tier = 'quick' | 'default' | 'complex';
export const TIERS: [Tier, string][] = [['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Best']];
export const TIER_NAME: Record<Tier, string> = { quick: 'Fast', default: 'Balanced', complex: 'Best' };
/** Same table as functions/src/models.ts. Prices are list prices per million tokens, input and output. */
/** `note` mentions speed and price (the app creator sees it); `plain` is what everyone else sees. */
export const TIER_MODEL: Record<Tier, { id: string; name: string; inPerM: number; outPerM: number; note: string; plain: string }> = {
  quick: { id: 'claude-haiku-5-5', name: 'Haiku 5.5', inPerM: 0.1, outPerM: 0.5, note: 'Cheapest and fastest.', plain: 'Quick answers; can miss small damage.' },
  default: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', inPerM: 2, outPerM: 10, note: 'The default. Mid price.', plain: 'The default, recommended for most fleets.' },
  complex: { id: 'claude-opus-5-5', name: 'Opus 5.5', inPerM: 4, outPerM: 20, note: 'The largest model. Slowest and most expensive.', plain: 'The most thorough look at every photo.' },
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
  /** Who drives it now (set by the server, mirrors the open assignment). */
  assignedTo?: { assignmentId: string; driverId: string; driverName: string; since: number } | null;
  /** Retired vans stay with their history; they are never deleted. */
  retired?: boolean;
  // The van's own facts, which everyone at its station sees (owners and its managers fill them in).
  vin?: string | null;
  /** First registration, "YYYY-MM-DD". */
  firstReg?: string | null;
  modelYear?: number | null;
  color?: string | null;
  fuel?: 'diesel' | 'electric' | 'petrol' | 'hybrid' | 'cng' | null;
  batteryKwh?: number | null;
  rangeKm?: number | null;
  powerKw?: number | null;
  gearbox?: 'manual' | 'automatic' | null;
  /** In Amazon livery. */
  branded?: boolean | null;
  keys?: number | null;
  heightM?: number | null;
  lengthM?: number | null;
  grossKg?: number | null;
  payloadKg?: number | null;
  cargoM3?: number | null;
  tyreSize?: string | null;
  // What the driver needs after a breakdown or an accident.
  breakdownPhone?: string | null;
  insurer?: string | null;
  policyNo?: string | null;
  claimsPhone?: string | null;
  retiredAt?: number | null;
  retiredBy?: string | null;
  createdAt: number;
  createdBy: string | null;
}

/**
 * The business side of a van (orgs/{org}/vehicleDetails/{vehicleId}): contract, costs, insurance, deadlines,
 * odometer and notes. Only owners and the van's station managers read and change it. Dates are "YYYY-MM-DD".
 */
export interface VehicleDetails {
  id: string;
  /** The van's station (kept in step by the server when the van moves), so managers can read their station's. */
  stationId: string | null;
  createdAt: number;
  updatedAt?: number;
  updatedByName?: string | null;
  ownership?: 'owned' | 'leased' | 'rented' | 'financed' | 'other' | null;
  provider?: string | null;
  contractNo?: string | null;
  start?: string | null;
  end?: string | null;
  /** Euros a month, without VAT. */
  monthly?: number | null;
  kmPerYear?: number | null;
  kmAtStart?: number | null;
  /** Euros per kilometre over the allowance. */
  excessPerKm?: number | null;
  included?: string[] | null;
  purchasePrice?: number | null;
  contact?: string | null;
  returnNotes?: string | null;
  coverage?: 'liability' | 'partial' | 'full' | null;
  deductible?: number | null;
  /** Euros a year. */
  premium?: number | null;
  insuranceRenewal?: string | null;
  odometerKm?: number | null;
  odometerAt?: string | null;
  due?: { hu?: string | null; uvv?: string | null; service?: string | null; serviceKm?: number | null; tyres?: string | null; tax?: string | null } | null;
  fuelCard?: string | null;
  notes?: string | null;
}

/**
 * One person driving one van from `start` to `end` (null while it lasts). Written only by the server and never
 * edited or deleted: together they are the permanent history of every van and every driver.
 */
export type EndReason = 'reassigned' | 'ended' | 'dropped off' | 'taken over' | 'switched van' | 'driver removed' | 'driver moved' | 'role changed' | 'van retired' | 'van moved';
/** Why an assignment ended, for the history lists. */
export const END_REASON: Record<EndReason, string> = {
  reassigned: 'given to someone else', ended: 'made free', 'dropped off': 'dropped off', 'taken over': 'taken over',
  'switched van': 'swapped for another van', 'driver removed': 'removed from the company', 'driver moved': 'moved to another station',
  'role changed': 'role changed', 'van retired': 'van retired', 'van moved': 'van moved to another station',
};

export interface Assignment {
  id: string;
  vehicleId: string;
  vehicleName: string;
  plate: string;
  driverId: string;
  driverName: string;
  stationId: string | null;
  start: number;
  end: number | null;
  startedBy: string;
  startedByName: string;
  endedBy: string | null;
  endedByName: string | null;
  endReason: EndReason | null;
  createdAt: number;
  /** Photos taken at pick-up and drop-off when drivers pick up vans themselves. */
  startWalkId?: string | null;
  endWalkId?: string | null;
  /** Or a video instead of the photos. Videos added later point to the assignment instead (Video.late). */
  startVideoId?: string | null;
  endVideoId?: string | null;
  /** Given by a manager or owner: the driver is asked for pick-up photos or a video (added afterwards, pointing here). */
  pickupRequested?: boolean;
}

/** A handover video: one walk around the van at pick-up or drop-off. Written by the server after checking it. */
export const VIDEO_TITLE: Record<Video['kind'], string> = { pickup: 'Pick-up video', dropoff: 'Drop-off video', walkaround: 'Walk-around video' };
export interface Video {
  id: string;
  vehicleId: string;
  vehicleName: string;
  stationId: string | null;
  /** At a pick-up, at a drop-off, or a walk-around filmed any time (not a handover). */
  kind: 'pickup' | 'dropoff' | 'walkaround';
  /** The handover it belongs to; for a walk-around, the driver who had the van then (or null). */
  assignmentId: string | null;
  /** Added after the handover (for example by the manager when the driver didn't record one). */
  late: boolean;
  by: string;
  byName: string;
  createdAt: number;
  /** When the phone recorded it, if it says. */
  recordedAt: number | null;
  durationMs: number;
  path: string;
  size: number;
  contentType: string;
  device: string | null;
  width: number;
  height: number;
  /** The playback copy (720p H.264) is made after upload. */
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  playPath: string | null;
  posterPath: string | null;
  playSize?: number;
  error?: string | null;
}

/** An operating area of a company, such as an Amazon delivery station. */
export interface Station {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  /** Drivers pick up and drop off vans themselves. Set on the server by owners or the station's managers. */
  selfAssign?: boolean;
  selfAssignBy?: string;
  selfAssignAt?: number;
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
  /** Set by the server when these photos were taken to pick up or drop off the van. */
  /** The photos of a pick-up or drop-off (set by the server); late: added after the handover, not by the driver at pick-up. */
  handover?: { kind: 'pickup' | 'dropoff'; assignmentId: string; late?: boolean };
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
  /** How long the AI took (app creator only: filled in from checkUsage). */
  ms?: number | null;
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
  /** The damage already on the van this is (its key, see damage.ts), when it isn't new. */
  known?: string | null;
}
/** Damage the AI didn't mark, added by the manager during review. */
export interface ManualDamage {
  panel: string;
  type: string;
  note: string;
  by: string;
  byName: string;
  at: number;
  known?: string | null;
}

/** A comment on a damage by an owner or fleet manager. Kept for good: no edits, no deletes. */
export interface DamageNote {
  id: string;
  vehicleId: string;
  stationId: string | null;
  damageKey: string;
  text: string;
  by: string;
  byName: string;
  createdAt: number;
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
  /** AI speed and cost: only for the app creator, filled in from checkUsage (see CheckUsage). */
  pass1?: Usage | null;
  pass2?: Usage | null;
  spots: Spot[];
  notVisible: string[];
  missedNote: string;
}

/** AI speed and cost of one damage check (orgs/{org}/checkUsage/{checkId}): only the app creator reads it. */
export interface CheckUsage {
  id: string;
  checkId: string;
  stationId: string | null;
  createdAt: number;
  pass1: Usage | null;
  pass2: Usage | null;
  serverMs: number | null;
  prepMs: number | null;
  /** AI time per spot, by spot number. */
  spotMs: Record<string, number | null>;
}

export interface Scan {
  id: string;
  stationId?: string | null;
  createdAt: number;
  createdBy: string | null;
  tier: Tier;
  model: string;
  /** AI speed and cost: null unless the app creator asked (type scans are only theirs to read). */
  ms: number | null;
  photos: number;
  inTok: number | null;
  outTok: number | null;
  cost: number | null;
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
  /** Sign-in accounts of the demo company (made up, for trying the roles). */
  demoLogins?: { role: 'driver' | 'manager'; name: string; email: string; password: string; uid: string }[];
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
/** `known`: the damage already on the van this one is (a repeat sighting), or null when it's new. */
export interface ApprovedDamage { panel: string; type: string; sizeCm: number | null; note: string; spot: number | null; known: string | null }
export function approvedDamage(k: Check): ApprovedDamage[] {
  const r = k.review;
  if (!r || k.status !== 'reviewed') return [];
  const out = k.spots.flatMap((p, i): ApprovedDamage[] => {
    const d = r.decisions?.[String(i)];
    return d?.damage ? [{ panel: p.panel, type: (p.verdict?.verdict === 'damage' && p.verdict.type) || p.type, sizeCm: p.verdict?.sizeCm ?? p.sizeCm, note: d.note, spot: i, known: d.known || null }] : [];
  });
  return out.concat((r.manual || []).map((m): ApprovedDamage => ({ panel: m.panel, type: m.type, sizeCm: null, note: m.note, spot: null, known: m.known || null })));
}
/** Damage a check added to the van's record (approved, and not a repeat of damage it already had). */
export function newDamage(k: Check): ApprovedDamage[] {
  return approvedDamage(k).filter((d) => !d.known);
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
