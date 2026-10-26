import type { DocumentReference, Transaction, WriteBatch } from 'firebase-admin/firestore';

/**
 * What a van's dashboard showed last, and the kilometres of each driver who had it.
 *
 * - On the van (vehicles/{id}.dash), for everyone at its station: km, fuel or battery, range and warning lights from
 *   its latest dashboard photo, at the start or end of a tour or at a refuel, wash or parts purchase. Written only
 *   by the server.
 * - On each assignment (kmStart, kmEnd, mirrored on the van's assignedTo while it lasts): the km when the driver got
 *   the van and the latest km while they had it. The start is the van's last reading if it's from the 24 hours
 *   before the handover, else the first reading while they had it (never km someone else drove before). Both come
 *   only from dashboard photos, so a driver without any photo has no km, and the end is their last photo, not the
 *   moment they gave the van back.
 */

export type DashFrom = 'tour' | 'fuel' | 'wash' | 'parts';
export interface VanDash {
  km: number;
  fuelPct: number | null;
  batteryPct: number | null;
  rangeKm: number | null;
  warnings: string[];
  at: number;
  by: string;
  byName: string;
  /** Where the photo was taken: a tour's start or end, or a refuel (the fuel level is then an estimate after filling up), a wash, parts. */
  from: DashFrom;
}
export interface KmSpan { kmStart: number | null; kmEnd: number | null }
type VanNow = { dash?: VanDash | null; assignedTo?: ({ assignmentId: string } & Partial<KmSpan>) | null };

/** A reading this long before a handover still counts as the km the driver got the van with. */
export const HANDOVER_MS = 24 * 3600_000;

/** The km a driver starts with when they get the van now: the van's last reading if it's recent enough. */
export function startKm(dash: VanDash | null | undefined, at: number): number | null {
  return dash && dash.at <= at && at - dash.at <= HANDOVER_MS ? dash.km : null;
}

/** The driver's km after one more reading. */
export function nextKm(cur: Partial<KmSpan>, km: number): KmSpan {
  return { kmStart: cur.kmStart ?? km, kmEnd: Math.max(cur.kmEnd ?? km, km) };
}

/** The fuel level just after a refuel: the gauge before, plus what went in (needs the tank size). */
export function afterRefuel(fuelPct: number | null, litres: number | null, tankL: number | null): number | null {
  if (fuelPct == null || !litres || !tankL) return null;
  return Math.min(100, Math.round(fuelPct + (litres / tankL) * 100));
}

/**
 * In a transaction, after its reads (the van was read in it): the van's latest dashboard, and the km of whoever has
 * it. A photo older than the one on the van changes nothing.
 */
export function noteDash(tx: Transaction, vref: DocumentReference, van: VanNow, d: VanDash) {
  if (van.dash && van.dash.at > d.at) return;
  const patch: Record<string, unknown> = { dash: d };
  const a = van.assignedTo;
  if (a?.assignmentId) {
    const k = nextKm(a, d.km);
    patch['assignedTo.kmStart'] = k.kmStart;
    patch['assignedTo.kmEnd'] = k.kmEnd;
    tx.update(vref.parent.parent!.collection('assignments').doc(a.assignmentId), { ...k });
  }
  tx.update(vref, patch);
}

/** One dashboard reading of a van, for working out the past. */
export interface Point { at: number; dash: VanDash }

/** An assignment's km from the van's readings (sorted by time): the same rule as while it happens. */
export function kmOf(points: Point[], start: number, end: number | null): KmSpan {
  let before: Point | null = null;
  const inside: Point[] = [];
  for (const p of points) {
    if (p.at < start) before = p;
    else if (end == null || p.at <= end) inside.push(p);
  }
  let k: KmSpan = { kmStart: startKm(before?.dash, start), kmEnd: null };
  for (const p of inside) k = nextKm(k, p.dash.km);
  return k;
}

type Doc = Record<string, unknown>;
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The dashboard readings of a company's vans, from tour photos and finished refuels, washes and parts. */
export function pointsFrom(readings: Doc[], purchases: Doc[]): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  const add = (vehicleId: unknown, p: Point) => {
    if (typeof vehicleId !== 'string') return;
    const xs = out.get(vehicleId) || [];
    xs.push(p);
    out.set(vehicleId, xs);
  };
  for (const r of readings) {
    const km = num(r.odometerKm), at = num(r.at);
    if (km == null || at == null) continue;
    add(r.vehicleId, { at, dash: {
      km, fuelPct: num(r.fuelPct), batteryPct: num(r.batteryPct), rangeKm: num(r.rangeKm), warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
      at, by: String(r.by || ''), byName: String(r.byName || ''), from: 'tour',
    } });
  }
  for (const p of purchases) {
    const dash = (p.dash || {}) as { at?: number; ai?: { warnings?: string[]; batteryPct?: number | null; rangeKm?: number | null } | null };
    const km = num(p.odometerKm), at = num(dash.at) ?? num(p.createdAt);
    if (p.status !== 'done' || km == null || at == null) continue;
    const kind = (['fuel', 'wash', 'parts'].includes(String(p.kind)) ? p.kind : 'wash') as DashFrom;
    add(p.vehicleId, { at, dash: {
      km, fuelPct: kind === 'fuel' ? afterRefuel(num(p.fuelPct), num(p.litres), num(p.tankL)) : num(p.fuelPct),
      batteryPct: num(dash.ai?.batteryPct), rangeKm: kind === 'fuel' ? null : num(dash.ai?.rangeKm), warnings: dash.ai?.warnings || [],
      at, by: String(p.by || ''), byName: String(p.byName || ''), from: kind,
    } });
  }
  for (const xs of out.values()) xs.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * Fills in, for a company's existing data, each van's latest dashboard and each assignment's km (the Deploy workflow
 * runs it once per company; the demo company runs it once it's made). Returns how many vans and assignments changed.
 */
export async function fillVanDash(org: DocumentReference, batch: () => WriteBatch): Promise<{ vans: number; assignments: number }> {
  const [vans, readings, purchases, assignments] = await Promise.all([
    org.collection('vehicles').get(), org.collection('readings').get(), org.collection('purchases').where('status', '==', 'done').get(), org.collection('assignments').get(),
  ]);
  const points = pointsFrom(readings.docs.map((d) => d.data()), purchases.docs.map((d) => d.data()));
  let w = batch(), n = 0, vanN = 0, aN = 0;
  const put = async (ref: DocumentReference, patch: Doc) => {
    w.update(ref, patch);
    if (++n >= 400) { await w.commit(); w = batch(); n = 0; }
  };
  const spans = new Map<string, KmSpan>();
  for (const d of assignments.docs) {
    const a = d.data() as { vehicleId?: string; start?: number; end?: number | null; kmStart?: number | null; kmEnd?: number | null };
    const k = kmOf(points.get(String(a.vehicleId)) || [], Number(a.start) || 0, a.end ?? null);
    spans.set(d.id, k);
    if (a.kmStart !== k.kmStart || a.kmEnd !== k.kmEnd) { await put(d.ref, { ...k }); aN++; }
  }
  for (const d of vans.docs) {
    const v = d.data() as { dash?: VanDash | null; assignedTo?: { assignmentId?: string; kmStart?: number | null; kmEnd?: number | null } | null };
    const ps = points.get(d.id) || [];
    const last = ps[ps.length - 1]?.dash || null;
    const patch: Doc = {};
    if (last && (!v.dash || v.dash.at < last.at)) patch.dash = last;
    const k = v.assignedTo?.assignmentId ? spans.get(v.assignedTo.assignmentId) : undefined;
    if (k && (v.assignedTo!.kmStart !== k.kmStart || v.assignedTo!.kmEnd !== k.kmEnd)) { patch['assignedTo.kmStart'] = k.kmStart; patch['assignedTo.kmEnd'] = k.kmEnd; }
    if (Object.keys(patch).length) { await put(d.ref, patch); vanN++; }
  }
  if (n) await w.commit();
  return { vans: vanN, assignments: aN };
}
