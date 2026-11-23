/**
 * The service history of a van (orgs/{org}/services/{id}): every service, tyre change, brake job, repair and TÜV
 * (Hauptuntersuchung, HU) an owner or the station's fleet manager records, with the km, the cost and the garage.
 * Written only by the server (the `service` function in index.ts), never deleted; a correction keeps what it was
 * before and who changed it. Owners and the van's station managers read them; drivers don't (costs are in them).
 *
 * Recording one also keeps the van's record (vehicleDetails) up to date: the odometer (only ever up), the last
 * service, and the next due dates it brings (the new TÜV month, the next service, the next tyre change): the newest
 * entry decides, so typing in an old invoice never changes them (detailsPatch). They can still be changed by hand.
 *
 * The station's fleet managers (or the owners where a station has none) get a notification once per TÜV date, a
 * month before it runs out (serviceSweep, daily).
 */

import { N_ } from './i18n';

export type ServiceKind = 'service' | 'tyres' | 'brakes' | 'repair' | 'other' | 'hu';
/** The four in the app's "Add service" list, then Other; the TÜV is recorded from its own card. */
export const SERVICE_KINDS: ServiceKind[] = ['service', 'tyres', 'brakes', 'repair', 'other', 'hu'];
/** The English names (shown in each reader's language). Other has the name that was typed. */
export const SERVICE_NAME: Record<Exclude<ServiceKind, 'other'>, string> = {
  service: N_('Service and oil change'), tyres: N_('Tyres'), brakes: N_('Brakes'), repair: N_('Repair'), hu: N_('TÜV (main inspection)'),
};
export type HuResult = 'passed' | 'defects' | 'failed';
export const HU_RESULTS: HuResult[] = ['passed', 'defects', 'failed'];

export interface Next { hu?: string; service?: string; serviceKm?: number; tyres?: string }
export interface ServiceInput {
  kind: ServiceKind; name: string | null; day: string; km: number; cost: number | null;
  garage: string | null; note: string | null; result: HuResult | null; next: Next | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day "YYYY-MM-DD". */
export function isDay(x: unknown): x is string {
  if (typeof x !== 'string' || !DAY.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** The last day of that day's month (the TÜV sticker shows a month: it's valid until its end). */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
/** The same day n months later (the last day of the month when it's shorter). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const text = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[ \t]+/g, ' ').slice(0, n) : null);
const num = (v: unknown) => (v == null || v === '' ? null : typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * Checks what the app sent and tidies it. `today` is the day in German time; `fix`: a correction (no next dates).
 * Throws the English message (with its values) of what's wrong; the caller turns it into an error for the app.
 */
export class Bad extends Error { constructor(public t: string, public v: Record<string, string | number> = {}) { super(t); } }
export function readService(d: Record<string, unknown>, today: string, { fix = false } = {}): ServiceInput {
  const kind = d.kind as ServiceKind;
  if (!SERVICE_KINDS.includes(kind)) throw new Bad(N_('Choose what was done.'));
  const name = kind === 'other' ? text(d.name, 60) : null;
  if (kind === 'other' && (!name || name.length < 2)) throw new Bad(N_('Say what was done.'));
  if (!isDay(d.day)) throw new Bad(N_('Enter the day it was done, like 31.03.2027.'));
  const day = d.day;
  // A day ahead is allowed: the phone's day can be ahead of German time.
  if (day > addDays(today, 1)) throw new Bad(N_('The day can\'t be in the future.'));
  if (day < '1990-01-01') throw new Bad(N_('Enter the day it was done, like 31.03.2027.'));
  const km = num(d.km);
  if (km == null || Number.isNaN(km)) throw new Bad(N_('Enter the van\'s km.'));
  if (km < 0 || km > 2_000_000) throw new Bad(N_('The km don\'t look right.'));
  const cost = num(d.cost);
  if (Number.isNaN(cost) || (cost != null && (cost < 0 || cost > 1_000_000))) throw new Bad(N_('The cost doesn\'t look right.'));
  const result = kind === 'hu' ? (d.result as HuResult) : null;
  if (kind === 'hu' && !HU_RESULTS.includes(result as HuResult)) throw new Bad(N_('Choose how the TÜV went.'));
  // A correction changes what was recorded, not the dates it brought (those are changed on the van).
  const n = (fix ? {} : d.next || {}) as Record<string, unknown>;
  const next: Next = {};
  if (kind === 'hu' && result !== 'failed' && !fix) {
    if (!isDay(n.hu)) throw new Bad(N_('Enter the month on the new sticker, like 03/2028.'));
    next.hu = monthEnd(n.hu);
    if (next.hu <= day) throw new Bad(N_('The new TÜV date has to be after the day it was done.'));
  }
  if (kind === 'service') {
    if (n.service != null && n.service !== '') {
      if (!isDay(n.service) || n.service <= day) throw new Bad(N_('The next service has to be after the day it was done.'));
      next.service = n.service;
    }
    const nk = num(n.serviceKm);
    if (Number.isNaN(nk) || (nk != null && (nk <= km || nk > km + 500_000))) throw new Bad(N_('The next service km have to be more than the km now.'));
    if (nk != null) next.serviceKm = Math.round(nk);
  }
  if (kind === 'tyres' && n.tyres != null && n.tyres !== '') {
    if (!isDay(n.tyres) || n.tyres <= day) throw new Bad(N_('The next tyre change has to be after the day it was done.'));
    next.tyres = n.tyres;
  }
  return {
    kind, name, day, km: Math.round(km), cost: cost == null ? null : Math.round(cost * 100) / 100,
    garage: text(d.garage, 80), note: text(d.note, 1000), result, next: Object.keys(next).length ? next : null,
  };
}
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The fields a correction may change (what the record was before goes in `edits`). */
export const FIXABLE = ['name', 'day', 'km', 'cost', 'garage', 'note', 'result'] as const;

interface DetailsNow {
  odometerKm?: number | null; odometerAt?: string | null;
  due?: { hu?: string | null; service?: string | null; serviceKm?: number | null; tyres?: string | null } | null;
  lastService?: { day: string } | null;
  /** The day of the entry that last set the next service and the next tyre change (kept by the server). */
  dueFrom?: { service?: string | null; tyres?: string | null } | null;
}
/**
 * What recording this service changes on the van's record (keys with a dot are fields inside a map):
 * - the odometer when the km are higher; the last service when it's the newest (not the TÜV: it has its own card);
 * - the TÜV date when the new sticker is later than what's there (a new sticker is never earlier; a wrong date is
 *   changed by hand);
 * - the next service (date and km together) and the next tyre change when this is the newest entry that set them:
 *   the newest service decides, also when its target is sooner than the old one (blind QA F01), and an older
 *   invoice typed in afterwards changes nothing. A date or km set by hand counts as set by no entry.
 */
export function detailsPatch(now: DetailsNow | undefined, s: ServiceInput, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (now?.odometerKm == null || s.km > now.odometerKm) { out.odometerKm = s.km; out.odometerAt = s.day; }
  if (s.kind !== 'hu' && (!now?.lastService?.day || s.day >= now.lastService.day)) {
    out.lastService = { id, day: s.day, kind: s.kind, name: s.name, km: s.km };
  }
  const due = now?.due || {};
  const from = now?.dueFrom || {};
  const newest = (k: 'service' | 'tyres') => !from[k] || s.day >= from[k]!;
  if (s.next?.hu && (!due.hu || s.next.hu > due.hu)) out['due.hu'] = s.next.hu;
  if ((s.next?.service || s.next?.serviceKm != null) && newest('service')) {
    out['due.service'] = s.next.service ?? null;
    out['due.serviceKm'] = s.next.serviceKm ?? null;
    out['dueFrom.service'] = s.day;
  }
  if (s.next?.tyres && newest('tyres')) { out['due.tyres'] = s.next.tyres; out['dueFrom.tyres'] = s.day; }
  return out;
}

/**
 * Is it time to remind about this TÜV date? From one month before it runs out (the end of the sticker's month, also
 * when the date is kept as a day inside it), and once it has run out too, so a date typed in late still gets its one
 * reminder. `today` in German time.
 */
export const huRemindNow = (hu: string, today: string) => isDay(hu) && addMonths(monthEnd(hu), -1) <= today;
/** The latest TÜV date the sweep asks for (a month and a day ahead, filtered exactly by huRemindNow). */
export const huQueryUpTo = (today: string) => addMonths(addDays(today, 1), 1);

/* ---------- Service appointments (product owner, 2026-11-23) ---------- */
// Not every service is done on the spot: the van goes to the garage at a booked time. Owners and the van's station
// managers book it (orgs/{org}/serviceAppointments, written only by the `appointment` function in index.ts), move or
// cancel it, and get a reminder the chosen time before (a day by default). When it's done they fill in the service
// from it (the `service` function with appointmentId), which marks it done. Nothing is deleted: moves keep what it
// was before, a cancelled one stays as cancelled.

/** What can be booked: the four common ones, the TÜV and Other. */
export const APPT_KINDS: ServiceKind[] = ['service', 'tyres', 'brakes', 'repair', 'hu', 'other'];
/** How long before the appointment the reminder goes, in minutes; 0: no reminder. */
export const REMIND_MIN = [0, 60, 180, 1440, 2880, 10080];
export const REMIND_DEFAULT = 1440;
export interface ApptInput {
  kind: ServiceKind; name: string | null; day: string; time: string; at: number;
  garage: string | null; note: string | null; remind: number;
}
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The moment of a day and a time in German time (where the companies are), as ms. */
export function berlinMs(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const off = (ms: number) => {
    const p = fmt.formatToParts(ms);
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms;
  };
  const first = guess - off(guess);
  return guess - off(first);
}

/**
 * Checks a booking (or a move) and tidies it. `now` in ms. Throws Bad with the English message, like readService.
 * A time already gone is refused (a few minutes' grace for a phone's clock); a year and a half ahead at most.
 */
export function readAppointment(d: Record<string, unknown>, now: number): ApptInput {
  const kind = d.kind as ServiceKind;
  if (!APPT_KINDS.includes(kind)) throw new Bad(N_('Choose what the appointment is for.'));
  const name = kind === 'other' ? text(d.name, 60) : null;
  if (kind === 'other' && (!name || name.length < 2)) throw new Bad(N_('Say what the appointment is for.'));
  if (!isDay(d.day)) throw new Bad(N_('Enter the day of the appointment, like 31.03.2027.'));
  if (typeof d.time !== 'string' || !TIME.test(d.time)) throw new Bad(N_('Enter the time of the appointment, like 09:30.'));
  const at = berlinMs(d.day, d.time);
  if (at < now - 10 * 60_000) throw new Bad(N_('That time has already passed. Choose a time ahead.'));
  if (at > now + 550 * 86400_000) throw new Bad(N_('That\'s too far ahead. Book it closer to the time.'));
  const remind = d.remind == null ? REMIND_DEFAULT : Number(d.remind);
  if (!REMIND_MIN.includes(remind)) throw new Bad(N_('Choose when to be reminded.'));
  return { kind, name, day: d.day, time: d.time, at, garage: text(d.garage, 80), note: text(d.note, 1000), remind };
}

/** When the reminder goes: `remind` minutes before; none when that moment has already passed (or no reminder). */
export const remindAtFor = (at: number, remind: number, now: number) => (remind > 0 && at - remind * 60_000 > now ? at - remind * 60_000 : null);
/** What a move may change (what it was before goes in `changes`). */
export const APPT_FIELDS = ['kind', 'name', 'day', 'time', 'garage', 'note', 'remind'] as const;
