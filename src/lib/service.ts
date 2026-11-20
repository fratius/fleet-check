import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { fb } from './firebase';
import { deadlines, type Deadline } from './fleet';
import { N_, t } from './i18n';
import type { HuResult, ServiceKind, ServiceRecord, Vehicle, VehicleDetails } from './types';

/**
 * A van's service history (orgs/{org}/services, written by the server: functions/src/service.ts) and the TÜV.
 * Owners and the van's station managers see it; drivers don't. Labels are kept in English (N_) and shown with t().
 */

/** The four common ones in the "Add service" list, then Other (named by the person). The TÜV has its own card. */
export const ADD_KINDS: ServiceKind[] = ['service', 'tyres', 'brakes', 'repair', 'other'];
export const SERVICE_NAME: Record<ServiceKind, string> = {
  service: N_('Service and oil change'), tyres: N_('Tyres'), brakes: N_('Brakes'), repair: N_('Repair'), other: N_('Other'), hu: N_('TÜV (main inspection)'),
};
export const SERVICE_HINT: Record<ServiceKind, string> = {
  service: N_('Oil, filters, the maker\'s service plan'), tyres: N_('New tyres or the seasonal change'), brakes: N_('Pads, discs, brake fluid'),
  repair: N_('Something fixed at the garage'), other: N_('Anything else: you name it'), hu: N_('The periodic inspection, with the new sticker'),
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
}
export function serviceVanRows(vans: Vehicle[], details: VehicleDetails[], services: ServiceRecord[]): ServiceVanRow[] {
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
    };
  });
}
