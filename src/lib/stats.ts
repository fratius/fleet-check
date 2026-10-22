/**
 * The numbers behind the Data tab: per driver, per van and per tour, for one period. Plain functions over the
 * records the tab loads (tours, van history, damage log, incidents, driver records).
 *
 * Honest limits, also said on the screen:
 * - Fuel used per tour comes from two gauge photos; a needle shows about a sixteenth of a tank, so one tour is a
 *   rough figure. Averages over many tours are what count. Electric vans show the battery in whole percent.
 * - Comparing drivers only makes sense on the same kind of van, so a driver is compared with the other drivers of
 *   the same model, weighted by their kilometres, and only after enough tours.
 * - Damage is counted for the drivers who had the van between the walk-around before and the one it was found in.
 *   That is who had the van, not proof of who caused it.
 */
import { CHECK_MONTHS, addMonths, deadlines, hasLeft, lastCheck, daysTo, type Deadline, type DueState } from './fleet';
import type { Assignment, DamageLog, DriverRecord, Incident, Member, Station, Tour, Vehicle, VehicleCosts, VehicleDetails, Video, Walkaround } from './types';
import { roleOf } from './types';
import { needsPickup, noDropoff } from './videos';

/** A tour older than this when its driver takes the next photo was never ended (the server does the same). */
export const STALE_TOUR = 16 * 3_600_000;
export const isOpen = (t: Tour) => t.open ?? (t.end == null && t.endedHow == null);
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const groupOf = (t: Pick<Tour, 'model' | 'cls' | 'unit'>) => `${t.model || t.cls || '?'}|${t.unit}`;

export interface Inputs {
  from: number;
  to: number;
  tours: Tour[];
  assignments: Assignment[];
  logs: DamageLog[];
  incidents: Incident[];
  records: DriverRecord[];
  members: Member[] | null;
  vehicles: Vehicle[];
  details: VehicleDetails[];
  costs: VehicleCosts[];
  videos: Video[];
  walks: Walkaround[];
  stations: Station[];
  months?: number;
}

/** What falls in the period: tours started in it, van history overlapping it, damage found and incidents in it. */
export function inPeriod(x: Inputs) {
  const inside = (t: number) => t >= x.from && t <= x.to;
  const fromDay = new Date(x.from).toISOString().slice(0, 10), toDay = new Date(x.to).toISOString().slice(0, 10);
  return {
    tours: x.tours.filter((t) => inside(t.startAt)).sort((a, b) => b.startAt - a.startAt),
    assignments: x.assignments.filter((a) => a.start <= x.to && (a.end ?? Date.now()) >= x.from),
    logs: x.logs.filter((l) => inside(l.foundAt)),
    incidents: x.incidents.filter((i) => i.day >= fromDay && i.day <= toDay),
  };
}

interface Use { used: number; km: number; n: number }
const add = (m: Map<string, Use>, k: string, used: number, km: number) => {
  const u = m.get(k) || { used: 0, km: 0, n: 0 };
  u.used += used; u.km += km; u.n += 1; m.set(k, u);
};
/** Fuel or energy per 100 km over many tours: everything used over every kilometre (not an average of averages). */
const rate = (u: Use | undefined) => (u && u.km > 0 ? (u.used / u.km) * 100 : null);

/**
 * How a driver's (or a van's) consumption compares with the rest on the same model: +0.12 is 12% more than the
 * others used over the same kilometres. Null without at least 4 comparable tours, or when nobody else drove that model.
 */
function compare(tours: Tour[], who: (t: Tour) => string) {
  const usable = tours.filter((t) => t.per100 != null && t.used != null && t.km);
  const byGroup = new Map<string, Map<string, Use>>();
  for (const t of usable) {
    const g = groupOf(t);
    if (!byGroup.has(g)) byGroup.set(g, new Map());
    add(byGroup.get(g)!, who(t), t.used!, t.km!);
  }
  const out = new Map<string, { vs: number | null; n: number }>();
  const ids = new Set(usable.map(who));
  for (const id of ids) {
    let used = 0, expected = 0, n = 0;
    for (const m of byGroup.values()) {
      const mine = m.get(id);
      if (!mine) continue;
      let ou = 0, ok = 0;
      for (const [k, u] of m) if (k !== id) { ou += u.used; ok += u.km; }
      if (ok < 200) continue;
      used += mine.used; expected += mine.km * (ou / ok); n += mine.n;
    }
    out.set(id, { vs: n >= 4 && expected > 0 ? used / expected - 1 : null, n });
  }
  return out;
}

export interface DriverRow {
  id: string;
  name: string;
  stationId: string | null;
  role: 'driver' | 'manager' | 'former';
  tours: number;
  days: number;
  km: number;
  kmPerTour: number | null;
  hoursPerTour: number | null;
  diesel: number | null;
  electric: number | null;
  /** Against the other drivers on the same model (fraction), and on how many tours. */
  vsModel: number | null;
  vsTours: number;
  vans: number;
  damage: number;
  /** Damage while nobody else had the van in that time. */
  damageSole: number;
  damagePer10k: number | null;
  /** Tours that ended without the end photo. */
  noEndPhoto: number;
  /** Handovers without their pick-up or drop-off video or photos. */
  missingProof: number;
  accidents: number;
  atFault: number;
  fines: number;
  complaints: number;
  licenceValid: string | null;
  nextCheck: string | null;
  checkState: DueState | null;
  left: boolean;
}

export function driverRows(x: Inputs): DriverRow[] {
  const p = inPeriod(x);
  const months = x.months || CHECK_MONTHS;
  const rows = new Map<string, DriverRow>();
  const blank = (id: string, name: string, stationId: string | null, role: DriverRow['role']): DriverRow => ({
    id, name, stationId, role, tours: 0, days: 0, km: 0, kmPerTour: null, hoursPerTour: null, diesel: null, electric: null, vsModel: null, vsTours: 0,
    vans: 0, damage: 0, damageSole: 0, damagePer10k: null, noEndPhoto: 0, missingProof: 0, accidents: 0, atFault: 0, fines: 0, complaints: 0,
    licenceValid: null, nextCheck: null, checkState: null, left: false,
  });
  for (const m of x.members || []) {
    const r = roleOf(m);
    if (r === 'driver' || r === 'manager') rows.set(m.uid, blank(m.uid, m.name, m.stationIds?.[0] || null, r));
  }
  const ensure = (id: string, name: string, stationId: string | null) => {
    if (!rows.has(id)) rows.set(id, blank(id, name, stationId, x.members ? 'former' : 'driver'));
    return rows.get(id)!;
  };
  const days = new Map<string, Set<string>>(), vans = new Map<string, Set<string>>(), hours = new Map<string, number>(), hourTours = new Map<string, number>();
  const fuel = new Map<string, Use>(), power = new Map<string, Use>();
  for (const t of p.tours) {
    const r = ensure(t.driverId, t.driverName, t.stationId);
    r.tours++;
    if (t.km) r.km += t.km;
    if (t.hours != null && t.endedHow === 'photo') { hours.set(t.driverId, (hours.get(t.driverId) || 0) + t.hours); hourTours.set(t.driverId, (hourTours.get(t.driverId) || 0) + 1); }
    if (!days.has(t.driverId)) days.set(t.driverId, new Set());
    days.get(t.driverId)!.add(dayKey(t.startAt));
    if (!vans.has(t.driverId)) vans.set(t.driverId, new Set());
    vans.get(t.driverId)!.add(t.vehicleId);
    if (t.endedHow === 'next' || t.endedHow === 'none') r.noEndPhoto++;
    if (t.per100 != null && t.used != null && t.km) add(t.unit === 'kwh' ? power : fuel, t.driverId, t.used, t.km);
  }
  // Without tours (dashboard photos off), the days and vans come from who had which van.
  for (const a of p.assignments) {
    const r = ensure(a.driverId, a.driverName, a.stationId);
    if (!vans.has(a.driverId)) vans.set(a.driverId, new Set());
    vans.get(a.driverId)!.add(a.vehicleId);
    if (!p.tours.some((t) => t.driverId === a.driverId)) {
      if (!days.has(a.driverId)) days.set(a.driverId, new Set());
      const s = Math.max(a.start, x.from), e = Math.min(a.end ?? Date.now(), x.to);
      for (let d = s; d <= e; d += 86_400_000) days.get(a.driverId)!.add(dayKey(d));
    }
    if (needsPickup(a, x.videos, x.walks) || noDropoff(a, x.videos, x.walks, x.stations)) r.missingProof++;
  }
  for (const l of p.logs) {
    if (!l.n) continue;
    for (const d of l.drivers) {
      const r = ensure(d.id, d.name, l.stationId);
      r.damage += l.n;
      if (l.drivers.length === 1) r.damageSole += l.n;
    }
  }
  for (const i of p.incidents) {
    const r = ensure(i.driverId, i.driverName, i.stationId);
    if (i.kind === 'accident') { r.accidents++; if (i.atFault === 'yes') r.atFault++; }
    else if (i.kind === 'fine') r.fines++;
    else if (i.kind === 'complaint') r.complaints++;
  }
  const vs = compare(p.tours, (t) => t.driverId);
  const recs = new Map(x.records.map((r) => [r.id, r]));
  for (const r of rows.values()) {
    r.days = days.get(r.id)?.size || 0;
    r.vans = vans.get(r.id)?.size || 0;
    r.kmPerTour = r.tours ? r.km / r.tours : null;
    r.hoursPerTour = hourTours.get(r.id) ? hours.get(r.id)! / hourTours.get(r.id)! : null;
    r.diesel = rate(fuel.get(r.id));
    r.electric = rate(power.get(r.id));
    const c = vs.get(r.id);
    r.vsModel = c?.vs ?? null; r.vsTours = c?.n || 0;
    r.damagePer10k = r.km >= 500 ? (r.damage / r.km) * 10_000 : null;
    const rec = recs.get(r.id);
    if (rec) {
      r.licenceValid = rec.licenceValid || null;
      r.left = hasLeft(rec);
      const last = lastCheck(rec);
      r.nextCheck = last ? addMonths(last.day, months) : null;
      r.checkState = r.left ? null : !last ? 'overdue' : daysTo(r.nextCheck!) < 0 ? 'overdue' : daysTo(r.nextCheck!) <= 14 ? 'soon' : 'ok';
    }
  }
  return [...rows.values()];
}

export interface VanRow {
  id: string;
  name: string;
  plate: string;
  stationId: string | null;
  model: string;
  fuel: Vehicle['fuel'] | null;
  retired: boolean;
  odometer: number | null;
  km: number;
  tours: number;
  drivers: number;
  per100: number | null;
  unit: 'l' | 'kwh' | null;
  /** Against the other vans of the same model (fraction): a van that uses more may need a look in the workshop. */
  vsModel: number | null;
  damage: number;
  warnings: string[];
  noEndPhoto: number;
  nextDue: Deadline | null;
  /** Owners only: the monthly rate, and what it comes to per kilometre driven in the period. */
  monthly: number | null;
  costPerKm: number | null;
}

export function vanRows(x: Inputs, owner: boolean): VanRow[] {
  const p = inPeriod(x);
  const det = new Map(x.details.map((d) => [d.id, d]));
  const cost = new Map(x.costs.map((c) => [c.id, c]));
  const vs = compare(p.tours, (t) => t.vehicleId);
  const periodDays = Math.max(1, (x.to - x.from) / 86_400_000);
  return x.vehicles.map((v) => {
    const tours = p.tours.filter((t) => t.vehicleId === v.id);
    const use: Use = { used: 0, km: 0, n: 0 };
    let unit: 'l' | 'kwh' | null = null;
    for (const t of tours) if (t.per100 != null && t.used != null && t.km) { use.used += t.used; use.km += t.km; use.n++; unit = t.unit; }
    const km = tours.reduce((s, t) => s + (t.km || 0), 0);
    const drivers = new Set([...tours.map((t) => t.driverId), ...p.assignments.filter((a) => a.vehicleId === v.id).map((a) => a.driverId)]);
    const d = det.get(v.id);
    const due = v.retired ? [] : deadlines(v, d);
    const monthly = owner ? cost.get(v.id)?.monthly ?? null : null;
    return {
      id: v.id, name: v.name, plate: v.plate || '', stationId: v.stationId || null, model: [v.make, v.model].filter(Boolean).join(' '),
      fuel: v.fuel || null, retired: !!v.retired, odometer: d?.odometerKm ?? null, km, tours: tours.length, drivers: drivers.size,
      per100: rate(use), unit, vsModel: vs.get(v.id)?.vs ?? null,
      damage: p.logs.filter((l) => l.vehicleId === v.id).reduce((s, l) => s + l.n, 0),
      warnings: Array.from(new Set(tours.flatMap((t) => t.warnings || []))),
      noEndPhoto: tours.filter((t) => t.endedHow === 'next' || t.endedHow === 'none').length,
      nextDue: due[0] || null,
      monthly, costPerKm: monthly && km >= 200 ? (monthly * (periodDays / 30.44)) / km : null,
    };
  });
}

/** Totals for the strip above the tables. */
export function totals(x: Inputs) {
  const p = inPeriod(x);
  const fuel: Use = { used: 0, km: 0, n: 0 }, power: Use = { used: 0, km: 0, n: 0 };
  for (const t of p.tours) if (t.per100 != null && t.used != null && t.km) { const u = t.unit === 'kwh' ? power : fuel; u.used += t.used; u.km += t.km; u.n++; }
  return {
    tours: p.tours.length,
    km: p.tours.reduce((s, t) => s + (t.km || 0), 0),
    diesel: rate(fuel), electric: rate(power),
    damage: p.logs.reduce((s, l) => s + l.n, 0),
    incidents: p.incidents.length,
  };
}

/** Who had a van at a moment (for a traffic fine, a complaint or a damage report), from the permanent history. */
export function whoHad(assignments: Assignment[], vehicleId: string, t: number) {
  const mine = assignments.filter((a) => a.vehicleId === vehicleId).sort((a, b) => a.start - b.start);
  const at = mine.find((a) => a.start <= t && (a.end ?? Infinity) >= t) || null;
  const before = [...mine].reverse().find((a) => (a.end ?? Infinity) < t) || null;
  const after = mine.find((a) => a.start > t) || null;
  return { at, before: at ? null : before, after: at ? null : after };
}

/** A tour that's missing a dashboard photo, for the Review tab. */
export interface TourGap { kind: 'no-end' | 'still-out' | 'no-start'; driverId: string; driverName: string; vehicleId: string; vehicleName: string; stationId: string | null; at: number }
/**
 * Where the dashboard photos are on: tours since `since` that ended without the end photo, tours still open after
 * 16 hours, and vans a driver got (at least 2 hours ago) without any start photo.
 */
export function tourGaps(tours: Tour[], assignments: Assignment[], since: number, onSince = 0, now = Date.now()): TourGap[] {
  const out: TourGap[] = [];
  const of = (t: Tour) => ({ driverId: t.driverId, driverName: t.driverName, vehicleId: t.vehicleId, vehicleName: t.vehicleName, stationId: t.stationId });
  for (const t of tours) {
    if (t.startAt < since) continue;
    if (t.endedHow === 'next' || t.endedHow === 'none') out.push({ kind: 'no-end', ...of(t), at: t.startAt });
    else if (isOpen(t) && now - t.startAt > STALE_TOUR) out.push({ kind: 'still-out', ...of(t), at: t.startAt });
  }
  for (const a of assignments) {
    if (a.start < Math.max(since, onSince) || now - a.start < 2 * 3_600_000) continue;
    const has = tours.some((t) => t.driverId === a.driverId && t.vehicleId === a.vehicleId && t.startAt >= a.start - 3 * 3_600_000 && t.startAt <= (a.end ?? now));
    if (!has) out.push({ kind: 'no-start', driverId: a.driverId, driverName: a.driverName, vehicleId: a.vehicleId, vehicleName: a.vehicleName, stationId: a.stationId, at: a.start });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** Vans whose latest dashboard photo (in the last 3 days) shows a warning light. */
export function vanWarnings(tours: Tour[], now = Date.now()) {
  const seen = new Set<string>();
  const out: Tour[] = [];
  for (const t of [...tours].sort((a, b) => (b.end?.at || b.startAt) - (a.end?.at || a.startAt))) {
    if (seen.has(t.vehicleId)) continue;
    seen.add(t.vehicleId);
    if (t.warnings?.length && now - (t.end?.at || t.startAt) < 3 * 86_400_000) out.push(t);
  }
  return out;
}
