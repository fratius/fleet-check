import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { fb } from './firebase';
import { daysTo, deadlines, fmtDay, type Deadline } from './fleet';
import { comma, N_, t, tp } from './i18n';
import type { HuResult, ServiceAppointment, ServiceKind, ServiceRecord, Vehicle, VehicleDetails } from './types';

/**
 * A van's service history (orgs/{org}/services, written by the server: functions/src/service.ts) and the TÜV.
 * Owners and the van's station managers see it; drivers don't. Labels are kept in English (N_) and shown with t().
 */

/** The four common ones in the "Add service" list, then Other (named by the person). The TÜV has its own card. */
export const ADD_KINDS: ServiceKind[] = ['service', 'tyres', 'brakes', 'repair', 'other'];
export const SERVICE_NAME: Record<ServiceKind, string> = {
  service: N_('Service and oil change'), tyres: N_('Tyres'), brakes: N_('Brakes'), repair: N_('Repair'), other: N_('Other'), hu: N_('TÜV (main inspection)'),
};
export const SERVICE_HINT: Partial<Record<ServiceKind, string>> = {
  service: N_('Oil, filters, the maker\'s service plan'), tyres: N_('New tyres or the seasonal change'), brakes: N_('Pads, discs, brake fluid'),
  repair: N_('Something fixed at the garage'), other: N_('Anything else: you name it'),
};
export const HU_RESULT: Record<HuResult, string> = { passed: N_('Passed'), defects: N_('Passed, minor defects to fix'), failed: N_('Failed, has to go again') };

/** What was done, in the reader's language (Other: as typed). */
export const serviceName = (r: { kind: ServiceKind; name: string | null }) => (r.kind === 'other' && r.name ? r.name : t(SERVICE_NAME[r.kind]));

/** Newest first: by the day it was done, then when it was recorded. */
export const byNewest = (a: ServiceRecord, b: ServiceRecord) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt;

/** One van's service history, live. Managers ask within their stations (the rules check it), owners for everything. */
export function watchServices(orgId: string, vehicleId: string, stations: string[] | null, cb: (rows: ServiceRecord[]) => void, onError?: () => void) {
  if (stations && !stations.length) { cb([]); return () => {}; }
  const base = collection(fb()!.db, 'orgs', orgId, 'services');
  const q = stations
    ? query(base, where('vehicleId', '==', vehicleId), where('stationId', 'in', stations.slice(0, 30)), orderBy('day', 'desc'), limit(300))
    : query(base, where('vehicleId', '==', vehicleId), orderBy('day', 'desc'), limit(300));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<ServiceRecord, 'id'>), id: d.id })).sort(byNewest)),
    (e) => { console.warn('The list services of the van was refused:', e); onError?.(); });
}

/** The service deadlines of a van (next service by date or km, tyre change), soonest first. */
export const serviceDue = (v: Vehicle, d: VehicleDetails | null | undefined): Deadline[] =>
  deadlines(v, d).filter((x) => x.key === 'service' || x.key === 'serviceKm' || x.key === 'tyres');
export const huDue = (v: Vehicle, d: VehicleDetails | null | undefined): Deadline | null => deadlines(v, d).find((x) => x.key === 'hu') || null;

/** One line per van for the Data tab: its TÜV, next service, last service, and what was done in the period. */
export interface ServiceVanRow {
  id: string; name: string; plate: string | null; stationId: string | null; retired: boolean; model: string;
  hu: Deadline | null; next: Deadline | null; last: VehicleDetails['lastService'] | null; n: number; cost: number;
  /** The next booked appointment (or one whose time has come and isn't filled in yet). */
  appt: ServiceAppointment | null;
}
export function serviceVanRows(vans: Vehicle[], details: VehicleDetails[], services: ServiceRecord[], appts: ServiceAppointment[] = []): ServiceVanRow[] {
  const open = openAppointments(appts);
  const det = new Map(details.map((d) => [d.id, d]));
  const per = new Map<string, { n: number; cost: number }>();
  for (const r of services) {
    const p = per.get(r.vehicleId) || { n: 0, cost: 0 };
    p.n += 1; p.cost += r.cost || 0;
    per.set(r.vehicleId, p);
  }
  return vans.filter((v) => !v.retired || per.has(v.id)).map((v) => {
    const d = det.get(v.id);
    const p = per.get(v.id);
    return {
      id: v.id, name: v.name, plate: v.plate || null, stationId: v.stationId || null, retired: !!v.retired, model: [v.make, v.model].filter(Boolean).join(' '),
      hu: huDue(v, d), next: serviceDue(v, d)[0] || null, last: d?.lastService || null, n: p?.n || 0, cost: p?.cost || 0,
      appt: open.find((a) => a.vehicleId === v.id) || null,
    };
  });
}

/* ---------- Service appointments (functions/src/service.ts) ---------- */

/** What can be booked: the four common ones, the TÜV and Other. */
export const BOOK_KINDS: ServiceKind[] = ['service', 'tyres', 'brakes', 'repair', 'hu', 'other'];
/** When the reminder goes, in minutes before (0: none). The server takes only these. */
export const REMIND: [number, string][] = [
  [60, N_('1 hour before')], [180, N_('3 hours before')], [1440, N_('1 day before')], [2880, N_('2 days before')], [10080, N_('1 week before')], [0, N_('No reminder')],
];
export const REMIND_DEFAULT = 1440;
export const remindLabel = (m: number) => t(REMIND.find(([x]) => x === m)?.[1] || REMIND[2][1]);

export { readTime } from './datefmt';

/** The booked ones, soonest first (the session keeps the latest 500 of every kind). */
export const openAppointments = (rows: ServiceAppointment[], vehicleId?: string) =>
  rows.filter((a) => a.status === 'booked' && (!vehicleId || a.vehicleId === vehicleId)).sort((a, b) => a.at - b.at);

/**
 * How close an appointment is, for a pill: its time has come (fill in the service), today, tomorrow, in n days, or
 * just its day. `soon`: today, tomorrow or the time has come (Review lists the ones within a week).
 */
export function apptState(a: Pick<ServiceAppointment, 'day' | 'time' | 'at'>, now = Date.now()): { text: string; v: 'bad' | 'amber' | 'default'; soon: boolean; days: number } {
  const days = daysTo(a.day, now);
  if (a.at <= now) return { text: t('Fill in the service'), v: 'bad', soon: true, days };
  if (days <= 0) return { text: t('Today, {time}', { time: a.time }), v: 'amber', soon: true, days };
  if (days === 1) return { text: t('Tomorrow, {time}', { time: a.time }), v: 'amber', soon: true, days };
  return { text: days <= 7 ? tp(days, 'In {n} day', 'In {n} days') : fmtDay(a.day), v: 'default', soon: false, days };
}
/** "25 Nov 2026, 09:30". */
export const apptWhen = (a: Pick<ServiceAppointment, 'day' | 'time'>) => `${fmtDay(a.day)}${comma()}${a.time}`;

/** The van's next garage visit drivers may see, while it's not more than half a day past (vehicles.garageVisit). */
export const visitOf = (v: Pick<Vehicle, 'garageVisit' | 'retired'>, now = Date.now()) =>
  (v.garageVisit && !v.retired && v.garageVisit.at > now - 12 * 3600_000 ? v.garageVisit : null);
