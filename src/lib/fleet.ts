import type { DriverRecord, Employment, Member, Vehicle, VehicleDetails } from './types';

/**
 * The fleet records of a van: what its fields mean, its deadlines and its mileage against the contract.
 * Dates are kept as "YYYY-MM-DD" (a calendar day, no time zone).
 */

/** Reads 31.03.2027, 31/03/2027, 2027-03-31, 03/2027 or 3.2027 (a month means its last day). Null if unreadable. */
export function parseDay(t: string): string | null {
  const s = t.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; } else if ((r = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/))) {
    d = +r[1]; m = +r[2]; y = +r[3] < 100 ? 2000 + +r[3] : +r[3];
  } else if ((r = s.match(/^(\d{1,2})[./](\d{2,4})$/))) {
    m = +r[1]; y = +r[2] < 100 ? 2000 + +r[2] : +r[2]; d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** "31 Mar 2027" (or "Mar 2027" for a month). */
export function fmtDay(day: string | null | undefined, month = false): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, month ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Whole days from today to that day (negative when it's past). */
export function daysTo(day: string, now = Date.now()): number {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(now);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400_000);
}
export const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

export const FUEL: Record<string, string> = { diesel: 'Diesel', electric: 'Electric', petrol: 'Petrol', hybrid: 'Hybrid', cng: 'Gas (CNG)' };
export const GEARBOX: Record<string, string> = { manual: 'Manual', automatic: 'Automatic' };
export const OWNERSHIP: Record<string, string> = { owned: 'Owned', leased: 'Leased', rented: 'Rented', financed: 'Financed', other: 'Other' };
export const COVERAGE: Record<string, string> = { liability: 'Liability only', partial: 'Partial cover', full: 'Full cover' };
export const INCLUDED: Record<string, string> = { maintenance: 'Maintenance', tyres: 'Tyres', insurance: 'Insurance', breakdown: 'Breakdown cover', replacement: 'Replacement van' };

export type DueState = 'overdue' | 'soon' | 'ok';
export interface Deadline { key: string; label: string; day: string | null; days: number | null; state: DueState; note: string }
/** Days ahead that count as "soon". */
export const SOON_DAYS = 30;

/** Everything that falls due for a van, soonest first: inspections, service, tax, insurance and the contract end. */
export function deadlines(v: Vehicle, d: VehicleDetails | null | undefined, now = Date.now()): Deadline[] {
  if (!d) return [];
  const out: Deadline[] = [];
  const add = (key: string, label: string, day: string | null | undefined, soon = SOON_DAYS) => {
    if (!day) return;
    const days = daysTo(day, now);
    out.push({ key, label, day, days, state: days < 0 ? 'overdue' : days <= soon ? 'soon' : 'ok', note: when(days) });
  };
  const due = d.due || {};
  add('hu', 'Main inspection (HU)', due.hu);
  add('uvv', 'Safety check (UVV)', due.uvv);
  add('service', 'Service', due.service);
  add('tyres', 'Tyre change', due.tyres, 21);
  add('tax', 'Vehicle tax', due.tax);
  add('insurance', 'Insurance renewal', d.insuranceRenewal, 45);
  if (d.ownership && d.ownership !== 'owned') add('contract', `${d.ownership === 'rented' ? 'Rental' : d.ownership === 'financed' ? 'Financing' : 'Lease'} ends`, d.end, 90);
  // Service by distance: due when the odometer gets there.
  if (due.serviceKm && d.odometerKm != null) {
    const left = due.serviceKm - d.odometerKm;
    out.push({ key: 'serviceKm', label: 'Service (distance)', day: null, days: null, state: left <= 0 ? 'overdue' : left <= 2000 ? 'soon' : 'ok',
      note: left <= 0 ? `${km(-left)} over` : `in ${km(left)}` });
  }
  const rank = { overdue: 0, soon: 1, ok: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.days ?? 99999) - (b.days ?? 99999));
}
function when(days: number) {
  if (days === 0) return 'today';
  if (days < 0) return days === -1 ? '1 day overdue' : `${-days} days overdue`;
  if (days === 1) return 'tomorrow';
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30.4)} months`;
}
/** Deadlines of the vans someone runs that are overdue or due soon, for the Review tab and its badge. */
export function fleetDue(vans: Vehicle[], details: VehicleDetails[], now = Date.now()) {
  const by = new Map(details.map((d) => [d.id, d]));
  const out: { v: Vehicle; x: Deadline }[] = [];
  for (const v of vans) {
    if (v.retired) continue;
    for (const x of deadlines(v, by.get(v.id), now)) if (x.state !== 'ok') out.push({ v, x });
  }
  return out.sort((a, b) => (a.x.state === b.x.state ? (a.x.days ?? 0) - (b.x.days ?? 0) : a.x.state === 'overdue' ? -1 : 1));
}
/** What counts on the Review badge: overdue, or due within a week. */
export const pressing = (x: Deadline) => x.state === 'overdue' || (x.days != null && x.days <= 7);

export const km = (n: number) => `${Math.round(n).toLocaleString()} km`;
export const eur = (n: number | null | undefined, digits = 0) => (n == null ? '' : `€${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);

/**
 * How the van is driven against its mileage allowance: kilometres a year at the current pace (from the contract
 * start and the last odometer reading), and how far over or under the allowance that is. The extra cost needs the
 * price per kilometre, which only owners have (VehicleCosts).
 */
export function mileage(d: VehicleDetails | null | undefined, excessPerKm?: number | null, now = Date.now()) {
  if (!d || d.odometerKm == null || d.kmAtStart == null || !d.start) return null;
  const at = d.odometerAt ? Date.parse(d.odometerAt) : now;
  const days = (at - Date.parse(d.start)) / 86400_000;
  if (!(days >= 30)) return null;
  const perYear = ((d.odometerKm - d.kmAtStart) / days) * 365;
  const over = d.kmPerYear ? perYear - d.kmPerYear : null;
  return { perYear, over, cost: over != null && over > 0 && excessPerKm ? over * excessPerKm : null };
}

/* ---------- Drivers ---------- */

export const EMPLOYMENT: Record<Employment, string> = { full: 'Full-time', part: 'Part-time', mini: 'Mini-job', student: 'Student job', other: 'Other' };
/** Licence classes a delivery driver may hold (B is the usual van licence; C1 above 3.5 t). */
export const LICENCE_CLASSES = ['B', 'BE', 'C1', 'C1E', 'C', 'CE', 'AM', 'A1', 'A2', 'A'];
/** How often licences are checked when the owner hasn't set it (every 6 months is common practice). */
export const CHECK_MONTHS = 6;

/** The same day n months later (the last day of the month when it's shorter). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const lastCheck = (r: DriverRecord | null | undefined) =>
  (r?.checks || []).slice().sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at)[0] || null;
/** Has the driver left (their last working day is past)? */
export const hasLeft = (r: DriverRecord | null | undefined, now = Date.now()) => !!r?.employedTo && daysTo(r.employedTo, now) < 0;

/**
 * What falls due for a driver: the licence running out, the next licence check (every `months` months after the
 * last one; overdue when none was ever recorded) and the yearly safety briefing. Nothing once they've left.
 */
export function driverDeadlines(r: DriverRecord | null | undefined, months = CHECK_MONTHS, now = Date.now()): Deadline[] {
  if (!r || hasLeft(r, now)) return [];
  const out: Deadline[] = [];
  const add = (key: string, label: string, day: string | null | undefined, soon: number) => {
    if (!day) return;
    const days = daysTo(day, now);
    out.push({ key, label, day, days, state: days < 0 ? 'overdue' : days <= soon ? 'soon' : 'ok', note: when(days) });
  };
  add('licence', 'Driving licence runs out', r.licenceValid, 60);
  const last = lastCheck(r);
  if (last) add('licenceCheck', 'Licence check', addMonths(last.day, months), 14);
  else out.push({ key: 'licenceCheck', label: 'Licence check', day: null, days: null, state: 'overdue', note: 'never recorded' });
  if (last && !last.ok) out.push({ key: 'licenceProblem', label: 'Licence check found a problem', day: last.day, days: null, state: 'overdue', note: last.note || 'see the record' });
  if (r.safetyBriefing) add('briefing', 'Safety briefing (yearly)', addMonths(r.safetyBriefing, 12), 30);
  const rank = { overdue: 0, soon: 1, ok: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.days ?? -99999) - (b.days ?? -99999));
}

/** Drivers' deadlines that are overdue or due soon, for the Review tab and its badge. */
export function peopleDue(records: DriverRecord[], members: Pick<Member, 'uid' | 'name'>[] | null, months = CHECK_MONTHS, now = Date.now(), known?: Map<string, string>) {
  const names = new Map((members || []).map((m) => [m.uid, m.name]));
  const out: { uid: string; name: string; stationId: string | null; x: Deadline }[] = [];
  for (const r of records) {
    // Only people still in the company (their record stays when they leave, their deadlines don't).
    if (members && !names.has(r.id)) continue;
    for (const x of driverDeadlines(r, months, now)) if (x.state !== 'ok') out.push({ uid: r.id, name: names.get(r.id) || known?.get(r.id) || 'Driver', stationId: r.stationId, x });
  }
  return out.sort((a, b) => (a.x.state === b.x.state ? (a.x.days ?? -99999) - (b.x.days ?? -99999) : a.x.state === 'overdue' ? -1 : 1));
}

/** German inspection sticker colours, by year (a six-year cycle: 2023 pink, 2024 green, 2025 orange, ...). */
const HU_COLORS = ['#E58FB8', '#3E9B4F', '#F08A24', '#2F6FC6', '#F2D129', '#8A5A33'];
export const huColor = (year: number) => HU_COLORS[(((year - 2023) % 6) + 6) % 6];
