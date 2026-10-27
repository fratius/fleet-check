import { getFirestore } from 'firebase-admin/firestore';

import { approvedDamage, keepForCheck } from './media';

/**
 * Tours from dashboard photos, and the damage log for the driver numbers. Plain functions, used by the callable
 * functions (index.ts) and the demo company (demo.ts).
 */

const db = () => getFirestore();

export type Fuel = 'diesel' | 'electric' | 'petrol' | 'hybrid' | 'cng' | null;
export interface TourEnd { readingId: string; at: number; km: number; fuelPct: number | null; batteryPct: number | null; by?: string; byName?: string }
export interface Refuel { litres: number | null; kwh: number | null; unknown: boolean }
export interface TourDoc {
  driverId: string; driverName: string; vehicleId: string; vehicleName: string; plate: string; stationId: string | null;
  model: string | null; cls: string | null; fuel: Fuel; assignmentId: string | null;
  start: TourEnd; end: TourEnd | null; endedHow: 'photo' | 'next' | 'none' | null; refuel: Refuel | null;
  km: number | null; hours: number | null; used: number | null; unit: 'l' | 'kwh' | null; per100: number | null;
  warnings: string[]; startAt: number; createdAt: number;
}
export interface VanFacts { fuel?: Fuel; tankL?: number | null; batteryKwh?: number | null }

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Plausible consumption per 100 km for a delivery van; anything outside is a misread gauge, not a result. */
const SANE = { l: [3, 40], kwh: [8, 80] } as const;

/**
 * The numbers of a finished tour: kilometres, hours, and the fuel or energy used when it can be worked out. That
 * needs the end photo (not an estimate from the next start), both gauge readings, the tank or battery size and the
 * driver's answer about refuelling. Short tours (under 20 km) get no consumption: the gauge can't show that little.
 */
export function tourNumbers(start: TourEnd, end: TourEnd, how: 'photo' | 'next', refuel: Refuel | null, van: VanFacts) {
  const km = Math.max(0, end.km - start.km);
  const hours = r1(Math.max(0, end.at - start.at) / 3_600_000);
  let used: number | null = null, unit: 'l' | 'kwh' | null = null;
  const known = how === 'photo' && !!refuel && !refuel.unknown;
  if ((van.fuel === 'diesel' || van.fuel === 'petrol') && van.tankL) {
    unit = 'l';
    if (known && start.fuelPct != null && end.fuelPct != null) used = ((start.fuelPct - end.fuelPct) / 100) * van.tankL + (refuel!.litres || 0);
  } else if (van.fuel === 'electric' && van.batteryKwh) {
    unit = 'kwh';
    if (known && start.batteryPct != null && end.batteryPct != null) used = ((start.batteryPct - end.batteryPct) / 100) * van.batteryKwh + (refuel!.kwh || 0);
  }
  let per100: number | null = null;
  if (used != null && unit && used > 0 && km >= 20) {
    const p = (used / km) * 100;
    if (p >= SANE[unit][0] && p <= SANE[unit][1]) per100 = r1(p);
  }
  if (used != null && (used <= 0 || per100 == null)) used = null;
  return { km, hours, used: used == null ? null : r1(used), unit, per100 };
}

/** A tour older than this when its driver takes the next photo was never ended: that photo ends it and starts a new one. */
export const STALE_TOUR_MS = 16 * 3_600_000;

export interface OpenTour { id: string; driverId: string; driverName: string; vehicleId: string; startAt: number }
export interface Plan {
  /** start: a new tour for the person; end: ends the open tour on this van; end-start: both; none: only a reading. */
  will: 'start' | 'end' | 'end-start' | 'none';
  /** Tours on this van that this photo ends, and how. */
  ends: { tour: OpenTour; how: 'photo' | 'next' }[];
  /** The person whose new tour this starts. */
  startFor: { id: string; name: string } | null;
  /** The driver whose tour this ends (for the screen). */
  tourDriver: string | null;
}

/**
 * What a confirmed dashboard photo does. The person who has the van (or whose tour on it is still open) starts or
 * ends their own tour; a tour of theirs that is more than 16 hours old is ended by it and a new one started. A tour
 * someone else left open on this van ends with this photo (an estimate: they didn't take the end photo). Owners and
 * the station's fleet managers who don't drive it only end a tour left open, or record the odometer.
 */
export function planReading(me: { id: string; name: string }, staffHere: boolean, hasVan: boolean, open: OpenTour[], now: number): Plan | null {
  const mine = open.find((t) => t.driverId === me.id) || null;
  const others = open.filter((t) => t.driverId !== me.id);
  if (mine) {
    const stale = hasVan && now - mine.startAt > STALE_TOUR_MS;
    return {
      will: stale ? 'end-start' : 'end',
      ends: [{ tour: mine, how: stale ? 'next' : 'photo' }, ...others.map((tour) => ({ tour, how: 'next' as const }))],
      startFor: stale ? me : null, tourDriver: stale ? null : me.name,
    };
  }
  if (hasVan) {
    return { will: others.length ? 'end-start' : 'start', ends: others.map((tour) => ({ tour, how: 'next' as const })), startFor: me, tourDriver: others[0]?.driverName || null };
  }
  if (staffHere) {
    return others.length
      ? { will: 'end', ends: others.map((tour) => ({ tour, how: 'photo' as const })), startFor: null, tourDriver: others[0].driverName }
      : { will: 'none', ends: [], startFor: null, tourDriver: null };
  }
  return null;
}

/** A van's make and model, for comparing drivers on the same kind of van. */
export const modelOf = (v: { make?: string | null; model?: string | null }) => [v.make, v.model].filter(Boolean).join(' ') || null;

/* ---------- Damage log ---------- */

interface CheckDoc {
  vehicleId: string; vehicleName: string; stationId?: string | null; walkId?: string; createdAt: number; status?: string;
  spots?: unknown[]; review?: { decisions?: Record<string, { damage?: boolean; known?: string | null }>; manual?: { known?: string | null }[]; at?: number | null } | null;
}
/** New damages of a reviewed check: approved and not already on the van (same as newDamage in the app). */
export function newDamageCount(k: CheckDoc): number {
  if (k.status !== 'reviewed' || !k.review) return 0;
  const d = k.review.decisions || {};
  const spots = (k.spots || []).length;
  let n = 0;
  for (let i = 0; i < spots; i++) if (d[String(i)]?.damage && !d[String(i)]?.known) n++;
  for (const m of k.review.manual || []) if (!m.known) n++;
  return n;
}

/**
 * Writes the damage log of one check: how many new damages it found, and the drivers who had the van between the
 * van's walk-around before and the one it was found in (the same rule as the van's damage record in the app). That
 * is who had the van, not proof of who caused it. A check that isn't reviewed has no log.
 */
export async function damageLogFor(orgId: string, checkId: string): Promise<boolean> {
  const org = db().doc(`orgs/${orgId}`);
  const snap = await org.collection('checks').doc(checkId).get();
  const k = snap.data() as CheckDoc | undefined;
  const lref = org.collection('damageLog').doc(checkId);
  if (!k || k.status !== 'reviewed') {
    await lref.delete().catch(() => {});
    if (k) await keepForCheck(orgId, checkId, k.createdAt, false, []);
    return false;
  }
  const walk = k.walkId ? (await org.collection('walkarounds').doc(k.walkId).get()).data() as { createdAt?: number } | undefined : undefined;
  const foundAt = walk?.createdAt ?? k.createdAt;
  const before = await org.collection('walkarounds').where('vehicleId', '==', k.vehicleId).where('createdAt', '<', foundAt - 1000)
    .orderBy('createdAt', 'desc').limit(5).get();
  const prevDoc = before.docs.find((d) => ((d.data() as { photos?: { path?: string; uri?: string }[] }).photos || []).some((p) => p.path || p.uri));
  const prev = prevDoc?.data() as { createdAt: number } | undefined;
  const from = prev?.createdAt ?? null;
  const drivers: { id: string; name: string }[] = [];
  if (from != null) {
    const hist = await org.collection('assignments').where('vehicleId', '==', k.vehicleId).where('start', '<', foundAt).orderBy('start', 'desc').limit(100).get();
    hist.docs.map((d) => d.data() as { driverId: string; driverName: string; start: number; end: number | null })
      .filter((a) => (a.end ?? Infinity) > from).sort((a, b) => a.start - b.start)
      .forEach((a) => { if (!drivers.some((x) => x.id === a.driverId)) drivers.push({ id: a.driverId, name: a.driverName }); });
  }
  await lref.set({
    checkId, vehicleId: k.vehicleId, vehicleName: k.vehicleName, stationId: k.stationId || null, foundAt, from, n: newDamageCount(k),
    drivers, driverIds: drivers.map((x) => x.id), reviewAt: k.review?.at ?? null, createdAt: foundAt,
  });
  // Approved damage keeps its photos 90 days: the check's close-ups, the walk-around it was found in and the one
  // before it (media.ts).
  await keepForCheck(orgId, checkId, k.createdAt, approvedDamage(k), [k.walkId, prevDoc?.id]);
  return true;
}
