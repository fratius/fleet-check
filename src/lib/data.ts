import { collection, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fb } from './firebase';
import { useSession } from './session';
import { t } from './i18n';
import { ai } from './store';
import type { Assignment, DamageLog, Incident, Purchase, Tour } from './types';

/**
 * Records for the Data tab and the driver pages, read straight from Firestore for a period. Owners read every
 * station; managers query their own (the rules check it); drivers only their own rows.
 */

const db = () => fb()!.db;
type Scope = { stations: string[] | null; driverId?: string | null };

function watch<T>(orgId: string, name: string, scope: Scope, cons: QueryConstraint[], cb: (rows: T[]) => void, onError: () => void, max = 3000) {
  if (scope.stations && !scope.stations.length && !scope.driverId) { cb([]); return () => {}; }
  const base = collection(db(), 'orgs', orgId, name);
  const who: QueryConstraint[] = scope.driverId ? [where(name === 'damageLog' ? 'driverIds' : 'driverId', name === 'damageLog' ? 'array-contains' : '==', scope.driverId)]
    : scope.stations ? [where('stationId', 'in', scope.stations.slice(0, 30))] : [];
  return onSnapshot(query(base, ...who, ...cons, limit(max)), (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T)), () => onError());
}

export interface PeriodData { tours: Tour[]; assignments: Assignment[]; logs: DamageLog[]; incidents: Incident[]; purchases: Purchase[]; loading: boolean; error: string | null }

/**
 * Everything the Data tab needs from `from` until now. In test mode it comes from the records on this phone.
 * Also asks the server once to fill in the damage log for checks reviewed before it existed.
 */
export function usePeriodData(from: number): PeriodData {
  const s = useSession();
  const orgId = s.org?.id;
  const firebase = s.mode === 'firebase';
  const scopeKey = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  const stations = scopeKey === '*' ? null : scopeKey ? scopeKey.split(',') : [];
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [logs, setLogs] = useState<DamageLog[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local (test mode) copies.
  const [local, setLocal] = useState<{ tours: Tour[]; incidents: Incident[] }>({ tours: [], incidents: [] });
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId || !s.staff) return;
    setError(null);
    if (!firebase) {
      const a = s.store!.tours.subscribe((r) => setLocal((l) => ({ ...l, tours: r })));
      const b = s.store!.incidents.subscribe((r) => setLocal((l) => ({ ...l, incidents: r })));
      return () => { a(); b(); };
    }
    setTours(null); setAssignments(null); setLogs(null); setIncidents(null); setPurchases(null);
    const fail = () => setError(t('Couldn\'t load all the numbers. Check the connection, then open the tab again.'));
    const sc = { stations: stations ? stations : null };
    const fromDay = new Date(from).toISOString().slice(0, 10);
    const subs = [
      watch<Tour>(orgId, 'tours', sc, [where('createdAt', '>=', from), orderBy('createdAt', 'desc')], setTours, fail),
      // Van history that started in the period, plus a month before (a driver can keep a van for weeks).
      watch<Assignment>(orgId, 'assignments', sc, [where('createdAt', '>=', from - 31 * 86_400_000), orderBy('createdAt', 'desc')], setAssignments, fail),
      watch<DamageLog>(orgId, 'damageLog', sc, [where('foundAt', '>=', from), orderBy('foundAt', 'desc')], setLogs, fail),
      watch<Incident>(orgId, 'incidents', sc, [where('day', '>=', fromDay), orderBy('day', 'desc')], setIncidents, fail),
      watch<Purchase>(orgId, 'purchases', sc, [where('createdAt', '>=', from), orderBy('createdAt', 'desc')], setPurchases, fail),
    ];
    // Checks reviewed before the damage log existed (or changed since) get theirs now. Once per period per visit.
    const key = `${orgId}:${from}`;
    if (synced.current !== key) {
      synced.current = key;
      ai.syncDamageLog({ orgId, since: from }).catch(() => {});
    }
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, firebase, scopeKey, from, s.staff]);

  return useMemo(() => {
    if (!firebase) {
      return { tours: local.tours, assignments: s.assignments, logs: [], incidents: local.incidents, purchases: s.purchases.filter((p) => p.createdAt >= from), loading: false, error: null };
    }
    // Open van assignments from the session, in case one started before the window.
    const byId = new Map((assignments || []).map((a) => [a.id, a]));
    for (const a of s.assignments) if (!byId.has(a.id)) byId.set(a.id, a);
    return {
      tours: tours || [], assignments: [...byId.values()], logs: logs || [], incidents: incidents || [], purchases: purchases || [],
      loading: !tours || !assignments || !logs || !incidents || !purchases, error,
    };
  }, [firebase, local, s.assignments, s.purchases, from, tours, assignments, logs, incidents, purchases, error]);
}

/** One driver's tours, incidents and damage log (their page). Drivers get their own. */
export function useDriverData(uid: string | undefined) {
  const s = useSession();
  const orgId = s.org?.id;
  const firebase = s.mode === 'firebase';
  const own = uid === s.user?.uid && !s.staff;
  const scopeKey = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [logs, setLogs] = useState<DamageLog[] | null>(null);
  const [localRows, setLocalRows] = useState<{ tours: Tour[]; incidents: Incident[] }>({ tours: [], incidents: [] });
  useEffect(() => {
    if (!orgId || !uid) return;
    if (!firebase) {
      const a = s.store!.tours.subscribe((r) => setLocalRows((l) => ({ ...l, tours: r.filter((t) => t.driverId === uid) })));
      const b = s.store!.incidents.subscribe((r) => setLocalRows((l) => ({ ...l, incidents: r.filter((i) => i.driverId === uid) })));
      return () => { a(); b(); };
    }
    if (!s.staff && !own) return;
    setTours(null); setIncidents(null); setLogs(null);
    const stations = scopeKey === '*' ? null : scopeKey ? scopeKey.split(',') : [];
    const base = (name: string) => collection(db(), 'orgs', orgId, name);
    const mine = (field: string, op: '==' | 'array-contains' = '==') => where(field, op, uid);
    const st = stations && !own ? [where('stationId', 'in', stations.slice(0, 30))] : [];
    const map = <T,>(cb: (r: T[]) => void) => (snap: { docs: { id: string; data(): unknown }[] }) => cb(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T));
    const subs = [
      onSnapshot(query(base('tours'), mine('driverId'), ...st, orderBy('createdAt', 'desc'), limit(300)), map<Tour>(setTours), () => setTours([])),
      onSnapshot(query(base('incidents'), mine('driverId'), ...st, orderBy('createdAt', 'desc'), limit(200)), map<Incident>(setIncidents), () => setIncidents([])),
      // Managers read the damage log of their station and keep this driver's lines; owners and the driver ask by driver.
      stations && !own
        ? onSnapshot(query(base('damageLog'), ...st, orderBy('foundAt', 'desc'), limit(500)), map<DamageLog>((r) => setLogs(r.filter((l) => l.driverIds?.includes(uid)))), () => setLogs([]))
        : onSnapshot(query(base('damageLog'), mine('driverIds', 'array-contains'), orderBy('foundAt', 'desc'), limit(300)), map<DamageLog>(setLogs), () => setLogs([])),
    ];
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, uid, firebase, own, scopeKey, s.staff]);
  if (!firebase) return { tours: localRows.tours, incidents: localRows.incidents, logs: [] as DamageLog[] };
  return { tours, incidents, logs };
}
