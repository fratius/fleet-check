import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { fb } from './firebase';
import { newId } from './images';
import type { Check, IdentifyResult, Invite, InvitePeek, JoinDetails, Scan, Spot, Station, Tier, Usage, Vehicle, Verdict, Walkaround } from './types';

export interface Coll<T extends { id: string }> {
  subscribe(cb: (rows: T[]) => void, onError?: (e: unknown) => void): () => void;
  add(data: Omit<T, 'id'>, id?: string): Promise<string>;
  update(id: string, patch: Partial<T>): Promise<void>;
  remove(id: string): Promise<void>;
}

/* ---------- Firestore ---------- */
/**
 * A company collection. With `stations`, only records of those stations are read: managers and
 * drivers may only query their own stations (the rules check it), owners read everything.
 */
function fsColl<T extends { id: string }>(orgId: string, name: string, stations: string[] | null = null): Coll<T> {
  const f = fb()!;
  const base = collection(f.db, 'orgs', orgId, name);
  return {
    subscribe(cb, onError) {
      if (stations && !stations.length) { cb([]); return () => {}; }
      const q = stations
        ? query(base, where('stationId', 'in', stations.slice(0, 30)), orderBy('createdAt', 'desc'), limit(500))
        : query(base, orderBy('createdAt', 'desc'), limit(500));
      return onSnapshot(q,
        (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T)),
        (e) => onError?.(e));
    },
    async add(data, id) {
      const ref = id ? doc(base, id) : doc(base);
      await setDoc(ref, stripUndefined(data as object));
      return ref.id;
    },
    async update(id, patch) { await updateDoc(doc(base, id), stripUndefined(patch as object)); },
    async remove(id) { await deleteDoc(doc(base, id)); },
  };
}
function stripUndefined<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/* ---------- this phone only (no Firebase config yet) ---------- */
const memo = new Map<string, Coll<any>>();
export const LOCAL_STATION = 'local';
function localColl<T extends { id: string } & { createdAt: number }>(name: string, seed: T[] = []): Coll<T> {
  const hit = memo.get(name);
  if (hit) return hit as Coll<T>;
  const key = 'fc.local.' + name;
  let rows: T[] | null = null;
  const subs = new Set<(r: T[]) => void>();
  const load = async () => {
    if (rows) return rows;
    try { rows = JSON.parse((await AsyncStorage.getItem(key)) || 'null') as T[] | null; } catch { rows = null; }
    if (!rows) rows = seed.slice();
    return rows;
  };
  const save = async () => {
    rows!.sort((a, b) => b.createdAt - a.createdAt);
    try { await AsyncStorage.setItem(key, JSON.stringify(rows)); } catch { /* storage full or blocked */ }
    subs.forEach((s) => s(rows!.slice()));
  };
  const c: Coll<T> = {
    subscribe(cb) { subs.add(cb); load().then((r) => cb(r.slice())); return () => { subs.delete(cb); }; },
    async add(data, id) { await load(); const row = { ...(data as object), id: id || newId() } as T; rows!.push(row); await save(); return row.id; },
    async update(id, patch) { await load(); rows = rows!.map((r) => (r.id === id ? { ...r, ...patch } : r)); await save(); },
    async remove(id) { await load(); rows = rows!.filter((r) => r.id !== id); await save(); },
  };
  memo.set(name, c);
  return c;
}

export interface Store {
  mode: 'firebase' | 'local';
  orgId: string;
  stations: Coll<Station>;
  vehicles: Coll<Vehicle>;
  walks: Coll<Walkaround>;
  checks: Coll<Check>;
  scans: Coll<Scan>;
}

/** `scope`: the stations this person may read, or null for everything (owner, app creator). */
export function makeStore(orgId: string | null, scope: string[] | null = null): Store {
  if (fb() && orgId) {
    return { mode: 'firebase', orgId, stations: fsColl(orgId, 'stations'), vehicles: fsColl(orgId, 'vehicles', scope),
      walks: fsColl(orgId, 'walkarounds', scope), checks: fsColl(orgId, 'checks', scope), scans: fsColl(orgId, 'scans') };
  }
  return { mode: 'local', orgId: 'local', stations: localColl<Station>('stations', [{ id: LOCAL_STATION, name: 'Main station', code: '', createdAt: 0 }]),
    vehicles: localColl('vehicles'), walks: localColl('walkarounds'), checks: localColl('checks'), scans: localColl('scans') };
}

/* ---------- AI, through Cloud Functions so the API key stays on the server ---------- */
export class AiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function call<I, O>(name: string, timeout = 180000) {
  return async (input: I): Promise<O> => {
    const f = fb();
    if (!f) throw new AiError('not-configured', 'AI checks need the Firebase backend. Finish the setup first.');
    try {
      const res = await httpsCallable<I, O>(f.functions, name, { timeout })(input);
      return res.data;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = (err.code || 'unknown').replace(/^functions\//, '');
      throw new AiError(code, aiMessage(code, err.message));
    }
  };
}
export function aiMessage(code: string, raw?: string): string {
  // The functions send messages written for the driver; the SDK's own messages are just the code.
  if (raw && raw.length > 24 && !/^[a-z -]+$/i.test(raw)) return raw;
  switch (code) {
    case 'not-found': return 'The AI functions aren\'t deployed yet. Check that the GitHub deploy ran.';
    case 'unauthenticated': return 'Sign in again, then try again.';
    case 'permission-denied': return 'Your account isn\'t a member of this company.';
    case 'resource-exhausted': return 'Too many AI checks in a short time, or the Anthropic credit has run out.';
    case 'failed-precondition': return raw || 'The AI service isn\'t set up. Add the ANTHROPIC_API_KEY secret.';
    case 'deadline-exceeded': return 'The AI took too long to answer. Try again.';
    case 'unavailable': case 'internal': return 'Couldn\'t reach the AI service. Check the connection and try again.';
    default: return raw || 'Something went wrong with the AI check. Try again.';
  }
}

export const ai = {
  identify: call<{ orgId: string; scanId: string; paths: string[]; tier: Tier; stationId: string | null }, IdentifyResult>('identifyVehicle', 130000),
  findDamage: call<{ orgId: string; walkId: string; tier: Tier }, { checkId: string; spots: Spot[]; notVisible: string[]; usage: Usage; model: string }>('findDamage', 310000),
  createInvite: call<{ orgId: string; role: 'manager' | 'driver'; stationId: string; count: number }, { invites: Invite[] }>('createInvite', 40000),
  peekInvite: call<{ token: string }, InvitePeek>('peekInvite', 20000),
  acceptInvite: call<{ token: string; details: JoinDetails }, { orgId: string; orgName: string; role: string; stationName: string; already: boolean }>('acceptInvite', 40000),
  createDemoCompany: call<Record<string, never>, { orgId: string; existed: boolean }>('createDemoCompany', 130000),
  deleteDemoCompany: call<{ orgId: string }, { ok: boolean }>('deleteDemoCompany', 130000),
  submitCheck: call<{ orgId: string; checkId: string; missedNote: string }, { ok: boolean }>('submitCheck', 40000),
  setupStations: call<{ orgId: string }, { done: boolean; stationId?: string }>('setupStations', 130000),
  checkSpot: call<{ orgId: string; checkId: string; spot: number; closeups: string[]; tier: Tier }, { verdict: Verdict; usage: Usage; model: string }>('checkSpot'),
};
