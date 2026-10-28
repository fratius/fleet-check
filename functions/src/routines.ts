import type { DocumentReference } from 'firebase-admin/firestore';

import { N_ } from './i18n';

/**
 * Checks for drivers (orgs/{org}/routines): what an owner or fleet manager asks drivers to check on their van, how
 * often, on which vans. Like the oil level once a week, or the cargo area every time a driver gets the van.
 *
 * - A check is due on a van only while someone has the van; that person does it. Once a day / every n days / once
 *   a week count calendar days in German time (the companies are in Germany); "every time" counts from when the
 *   driver got the van.
 * - The server keeps on each van what's due now (`todo`) and when each check was last done (`routines`), so the app
 *   only reads the van. It works it out again when a check is done or changed, when the van changes hands, and every
 *   half hour (a new day).
 * - Reminders, between 06:00 and 20:00 German time: the driver 1 hour after a check fell due, the station's fleet
 *   managers 3 hours after, once each per check, van and day (or handover). A problem found goes to them at once.
 */

export type How = 'every' | 'daily' | 'days' | 'weekly';
export const HOWS: How[] = ['every', 'daily', 'days', 'weekly'];
/** The suggestions in the app (src/components/routines.tsx): kept as the English text, shown in each person's language. */
export const SUGGESTIONS = [
  N_('Oil level'), N_('Coolant level'), N_('Washer fluid'), N_('Tyres'), N_('Lights'), N_('Plugged in to charge'),
  N_('Cargo area clean and empty'), N_('First aid kit and warning triangle'),
];
export interface Routine {
  id: string;
  /** One of the suggestions (the English text, so each person sees it in their language), or null: `name` as typed. */
  key: string | null;
  name: string;
  how: How;
  /** For "every few days": 2 to 6. */
  days: number | null;
  /** All the station's vans, its electric vans, or these vans. */
  vans: 'all' | 'electric' | string[];
  /** One station, or null: every station (owners only). */
  stationId: string | null;
  /** A photo is needed as proof. */
  photo: boolean;
  createdAt?: number;
}
export interface Last { at: number; by: string; byName: string; ok: boolean; note: string | null }
export interface Todo { id: string; key: string | null; name: string; photo: boolean; since: number; period: string }
export interface VanForRoutines {
  stationId?: string | null; fuel?: string | null; retired?: boolean;
  assignedTo?: { assignmentId: string; driverId: string; driverName: string; since: number } | null;
  routines?: Record<string, Last> | null;
  todo?: Todo[] | null;
}

export const TZ = 'Europe/Berlin';
const DAY = 86_400_000;
export const DRIVER_AFTER = 3600_000;
export const STAFF_AFTER = 3 * 3600_000;
export const QUIET = { from: 6, to: 20 };

/** "YYYY-MM-DD" in German time. */
export function dayOf(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}
/** The hour (0 to 23) in German time. */
export function hourOf(t: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(t));
}
/** How far German time is ahead of UTC at this moment. */
function offset(t: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(t);
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}
/** Midnight in German time of the day `t` falls on. */
export function dayStart(t: number): number {
  const [y, m, d] = dayOf(t).split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return utc - offset(utc);
}
/** Midnight n days later (summer time safe). */
export function addDays(start: number, n: number): number {
  return dayStart(start + n * DAY + 12 * 3600_000);
}
/** That hour of the day `t` falls on, in German time. */
export const hourAt = (t: number, h: number) => dayStart(t) + h * 3600_000 - (offset(dayStart(t) + h * 3600_000) - offset(dayStart(t)));

const every = (r: Routine) => (r.how === 'daily' ? 1 : r.how === 'weekly' ? 7 : r.how === 'days' ? Math.min(6, Math.max(2, r.days || 2)) : 0);

/** Does this check apply to this van? */
export function applies(r: Routine, vanId: string, van: VanForRoutines): boolean {
  if (van.retired) return false;
  if (r.stationId && r.stationId !== van.stationId) return false;
  if (r.vans === 'all') return true;
  if (r.vans === 'electric') return van.fuel === 'electric';
  return Array.isArray(r.vans) && r.vans.includes(vanId);
}

/** Is the check due on the van now, since when, and for which period (a day, or the handover)? */
export function dueNow(r: Routine, van: VanForRoutines, last: number | null, now: number): Todo | null {
  const a = van.assignedTo;
  if (!a) return null;
  const base = { id: r.id, key: r.key, name: r.name, photo: r.photo };
  // Not due from before the check existed (a driver who has had the van for a week does a new check from today).
  const got = Math.max(a.since, r.createdAt || 0);
  if (r.how === 'every') {
    if (last != null && last >= a.since) return null;
    return { ...base, since: got, period: `a:${a.assignmentId}` };
  }
  const n = every(r);
  const today = dayStart(now);
  // Done today, or within the last n days (counted in whole days).
  if (last != null && last >= addDays(today, -(n - 1))) return null;
  const from = last == null ? today : addDays(dayStart(last), n);
  return { ...base, since: Math.max(from, got), period: `d:${dayOf(now)}` };
}

/** What's due on a van now. */
export function vanTodo(rules: Routine[], vanId: string, van: VanForRoutines, now: number): Todo[] {
  const out: Todo[] = [];
  for (const r of rules) {
    if (!applies(r, vanId, van)) continue;
    const t = dueNow(r, van, van.routines?.[r.id]?.at ?? null, now);
    if (t) out.push(t);
  }
  return out.sort((a, b) => a.since - b.since || a.name.localeCompare(b.name));
}

/** Who to remind about a check that's due: the driver after an hour, the managers after three, in the daytime. */
export function nagsDue(t: Todo, now: number): { driver: boolean; staff: boolean } {
  const h = hourOf(now);
  if (h < QUIET.from || h >= QUIET.to) return { driver: false, staff: false };
  const from = Math.max(t.since, hourAt(now, QUIET.from));
  return { driver: now - from >= DRIVER_AFTER, staff: now - from >= STAFF_AFTER };
}

/** Reads the company's checks. */
export async function loadRoutines(org: DocumentReference): Promise<Routine[]> {
  return (await org.collection('routines').get()).docs.map((d) => ({ ...(d.data() as Omit<Routine, 'id'>), id: d.id }));
}

/** Works out again what's due on these vans (all of them without ids) and saves it where it changed. */
export async function refreshTodo(org: DocumentReference, vehicleIds: string[] | null, now = Date.now()) {
  const rules = await loadRoutines(org);
  const vans = vehicleIds
    ? (await Promise.all(Array.from(new Set(vehicleIds)).map((id) => org.collection('vehicles').doc(id).get()))).filter((d) => d.exists)
    : (await org.collection('vehicles').get()).docs;
  const out: { id: string; name: string; plate: string; stationId: string | null; van: VanForRoutines; todo: Todo[] }[] = [];
  let w = org.firestore.batch(), n = 0;
  for (const d of vans) {
    const van = d.data() as VanForRoutines & { name?: string; plate?: string };
    const todo = vanTodo(rules, d.id, van, now);
    if (JSON.stringify(todo) !== JSON.stringify(van.todo || [])) {
      w.update(d.ref, { todo });
      if (++n >= 400) { await w.commit(); w = org.firestore.batch(); n = 0; }
    }
    out.push({ id: d.id, name: String(van.name || ''), plate: String(van.plate || ''), stationId: van.stationId || null, van, todo });
  }
  if (n) await w.commit();
  return out;
}
