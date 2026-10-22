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
  /** Fuel tank in litres (diesel and petrol): turns the fuel gauge into litres for the consumption. */
  tankL?: number | null;
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
 * The business side of a van (orgs/{org}/vehicleDetails/{vehicleId}): contract, insurance, deadlines, odometer and
 * notes. Only owners and the van's station managers read and change it. What it costs is in VehicleCosts (owners
 * only). Dates are "YYYY-MM-DD".
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
  kmPerYear?: number | null;
  kmAtStart?: number | null;
  included?: string[] | null;
  contact?: string | null;
  returnNotes?: string | null;
  coverage?: 'liability' | 'partial' | 'full' | null;
  insuranceRenewal?: string | null;
  odometerKm?: number | null;
  odometerAt?: string | null;
  due?: { hu?: string | null; uvv?: string | null; service?: string | null; serviceKm?: number | null; tyres?: string | null; tax?: string | null } | null;
  fuelCard?: string | null;
  notes?: string | null;
}

/** What a van costs (orgs/{org}/vehicleCosts/{vehicleId}): only owners read and change it. Euros, without VAT. */
export interface VehicleCosts {
  id: string;
  createdAt: number;
  updatedAt?: number;
  updatedByName?: string | null;
  /** A month (lease, rent or financing). */
  monthly?: number | null;
  purchasePrice?: number | null;
  /** Each kilometre over the mileage allowance. */
  excessPerKm?: number | null;
  /** Insurance premium a year. */
  premium?: number | null;
  /** Insurance deductible per claim. */
  deductible?: number | null;
}
export const COST_KEYS = ['monthly', 'purchasePrice', 'excessPerKm', 'premium', 'deductible'] as const;

/**
 * A driver's record (orgs/{org}/driverRecords/{uid}): what an owner needs to know about the people who drive the
 * vans. Owners and the driver's station managers keep it; the driver reads their own. Dates are "YYYY-MM-DD".
 * Deliberately not here: licence numbers or copies, date of birth, home address, health data (FLEET_DATA.md).
 */
export interface LicenceCheck { day: string; at: number; by: string; byName: string; ok: boolean; note: string }
export type Employment = 'full' | 'part' | 'mini' | 'student' | 'other';
export interface DriverRecord {
  id: string;
  /** The driver's station, so its managers can read it (the server moves it with the driver). */
  stationId: string | null;
  createdAt: number;
  updatedAt?: number;
  updatedByName?: string | null;
  licenceClasses?: string[] | null;
  /** The date on the licence card (or the class that runs out first). */
  licenceValid?: string | null;
  employedFrom?: string | null;
  employedTo?: string | null;
  employment?: Employment | null;
  /** First briefing on the vans (how to drive and load them, what to do after an accident). */
  vanBriefing?: string | null;
  /** The last yearly safety briefing. */
  safetyBriefing?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  notes?: string | null;
  /** Licence checks: who saw the licence when and whether it was fine. Added only by the server, never changed. */
  checks?: LicenceCheck[];
}

/** Something that happened with a driver: an accident, a traffic fine, a customer complaint. Kept, not deleted. */
export type IncidentKind = 'accident' | 'fine' | 'complaint' | 'other';
export interface Incident {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  vehicleName: string | null;
  stationId: string;
  day: string;
  time: string | null;
  kind: IncidentKind;
  /** Fines: what for. */
  fineType?: 'speeding' | 'parking' | 'red light' | 'phone' | 'other' | null;
  /** Accidents: was the driver at fault? */
  atFault?: 'yes' | 'no' | 'unclear' | null;
  note: string;
  by: string;
  byName: string;
  createdAt: number;
  updatedAt?: number;
  updatedByName?: string | null;
}

/** What the dashboard photo says (read by the AI, then confirmed or corrected by the person who took it). */
export interface DashValues { odometerKm: number | null; fuelPct: number | null; batteryPct: number | null; rangeKm: number | null; warnings: string[] }
/** One dashboard photo, confirmed (orgs/{org}/readings/{id}). Written only by the server; kept for good. */
export interface Reading extends DashValues {
  id: string;
  vehicleId: string;
  vehicleName: string;
  stationId: string | null;
  by: string;
  byName: string;
  /** The driver whose tour it starts or ends (null: a reading outside any tour). */
  driverId: string | null;
  at: number;
  createdAt: number;
  path: string;
  /** What the AI read, and which values the person changed. */
  ai: DashValues & { confidence: number | null };
  corrected: string[];
  tourId: string | null;
  role: 'start' | 'end' | 'none';
}
/** One end of a tour: the dashboard at that moment. */
export interface TourEnd { readingId: string; at: number; km: number; fuelPct: number | null; batteryPct: number | null; by?: string; byName?: string }
/**
 * A tour (orgs/{org}/tours/{id}): one driver, one van, from a dashboard photo at the start to one at the end.
 * Written only by the server, which works out the kilometres and, when it can, the fuel or energy used.
 * endedHow: photo (the end photo), next (no end photo: the van's next start photo ends it, an estimate), none
 * (no end photo and no next photo on that van: the driver started a tour elsewhere).
 */
export interface Tour {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleName: string;
  plate: string;
  stationId: string | null;
  /** Make and model (or the body class), to compare drivers on the same kind of van. */
  model: string | null;
  cls?: string | null;
  fuel: Vehicle['fuel'] | null;
  assignmentId: string | null;
  start: TourEnd;
  end: TourEnd | null;
  endedHow: 'photo' | 'next' | 'none' | null;
  /** Fuel or charge added during the tour, as the driver said at the end. */
  refuel: { litres: number | null; kwh: number | null; unknown: boolean } | null;
  km: number | null;
  hours: number | null;
  /** Litres (diesel, petrol) or kWh (electric) used, when it could be worked out. */
  used: number | null;
  unit: 'l' | 'kwh' | null;
  per100: number | null;
  warnings: string[];
  startAt: number;
  createdAt: number;
  /** Still going (no end yet). */
  open?: boolean;
}

/**
 * New damage found by a reviewed check, and who had the van while it could have happened
 * (orgs/{org}/damageLog/{checkId}). Written by the server from the review, for the driver numbers.
 */
export interface DamageLog {
  id: string;
  checkId: string;
  vehicleId: string;
  vehicleName: string;
  stationId: string | null;
  foundAt: number;
  /** The van's walk-around before (null: no earlier photos, so nobody can be named). */
  from: number | null;
  /** New damages (approved, not already on the van). */
  n: number;
  drivers: { id: string; name: string }[];
  driverIds: string[];
  reviewAt: number | null;
  createdAt: number;
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
  /** Drivers take a photo of the dashboard at the start and end of each tour (the owner turns it on). */
  dashScans?: boolean;
  dashScansBy?: string;
  dashScansAt?: number;
  /** How often drivers' licences are checked, in months (default 6). */
  licenceCheckMonths?: number;
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
