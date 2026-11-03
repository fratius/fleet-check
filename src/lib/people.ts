import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

import { standing } from './billing';
import { fb } from './firebase';
import { t } from './i18n';
import { readCache, writeCache } from './offline';
import { sendWrite } from './outbox';
import type { Assignment, Check, DamageNote, Invite, Member, Org, Walkaround } from './types';

/** People, stations and invite links of a company. Firestore only; test mode has none of this. */

const db = () => fb()!.db;
export function watchMembers(orgId: string, cb: (rows: Member[]) => void, onError?: () => void) {
  // Without a connection: the people this phone saw last (lib/offline.ts), until the server answers.
  const uid = fb()?.auth.currentUser?.uid;
  const key = uid ? `${uid}-${orgId}-members` : null;
  let live = false, gone = false;
  if (key) readCache<Member[]>(key).then((rows) => { if (!live && !gone && rows) cb(rows); });
  const off = onSnapshot(collection(db(), 'orgs', orgId, 'members'), (snap) => {
    const rows = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }));
    if (!snap.metadata.fromCache) { live = true; if (key) writeCache(key, rows); }
    else if (!live && !rows.length) return;
    cb(rows);
  }, () => onError?.());
  return () => { gone = true; off(); };
}

/** One walk-around by id, for history links to photos older than the ones the app keeps loaded. */
export async function fetchWalk(orgId: string, id: string): Promise<Walkaround | null> {
  try {
    const d = await getDoc(doc(db(), 'orgs', orgId, 'walkarounds', id));
    return d.exists() ? ({ id: d.id, ...(d.data() as Omit<Walkaround, 'id'>) }) : null;
  } catch { return null; }
}

/** One damage check by id, live; null when it isn't there or can't be read. */
export function watchCheck(orgId: string, id: string, cb: (k: Check | null) => void) {
  return onSnapshot(doc(db(), 'orgs', orgId, 'checks', id), (d) => cb(d.exists() ? ({ id: d.id, ...(d.data() as Omit<Check, 'id'>) }) : null), () => cb(null));
}

/** One person's membership; null once they've left the company. */
export function watchMember(orgId: string, uid: string, cb: (m: Member | null) => void, onError?: () => void) {
  return onSnapshot(doc(db(), 'orgs', orgId, 'members', uid),
    (d) => cb(d.exists() ? ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }) : null),
    () => onError?.());
}

export function watchInvites(orgId: string, cb: (rows: Invite[]) => void, onError?: () => void) {
  return onSnapshot(query(collection(db(), 'invites'), where('orgId', '==', orgId), orderBy('createdAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => d.data() as Invite)),
    () => onError?.());
}

// Changes go through the outbox (lib/outbox.ts): kept on the phone and sent by themselves without a connection.
export const deleteInvite = (token: string) => sendWrite('delete', ['invites', token], null, { title: t('Cancel an invite link') });

/**
 * Where the web app is: https://app.fratius.com once that domain is connected, the project's own address until then.
 * The Deploy workflow checks and writes it to config/web (functions/scripts/set-web-url.cjs); read once per sign-in.
 */
let webOrigin: string | null = null;
export async function loadWebUrl() {
  try {
    const u = (await getDoc(doc(db(), 'config', 'web'))).data()?.url;
    if (typeof u === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(u)) webOrigin = u;
  } catch { /* offline: the address below */ }
}
/** The web address of an invite link. It opens the join page of the web app. */
export function inviteUrl(token: string) {
  const here = typeof window !== 'undefined' && window.location?.origin?.startsWith('http') ? window.location.origin : null;
  return `${webOrigin || here || `https://${fb()?.app.options.projectId}.web.app`}/join/${token}`;
}
/** The token from a pasted invite link (or the bare token). */
export function tokenFrom(text: string) {
  const t = text.trim();
  const m = t.match(/join\/([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
}


export async function addStation(orgId: string, name: string, code: string) {
  const ref = doc(collection(db(), 'orgs', orgId, 'stations'));
  await sendWrite('set', ['orgs', orgId, 'stations', ref.id], { name: name.trim().slice(0, 40), code: code.trim().toUpperCase().slice(0, 12), createdAt: Date.now() },
    { title: t('Add the station {name}', { name: name.trim().slice(0, 40) }) });
  return ref.id;
}
export const renameStation = (orgId: string, id: string, name: string, code: string) =>
  sendWrite('update', ['orgs', orgId, 'stations', id], { name: name.trim().slice(0, 40), code: code.trim().toUpperCase().slice(0, 12) }, { title: t('Change the station {name}', { name: name.trim().slice(0, 40) }) });
export const deleteStation = (orgId: string, id: string) => sendWrite('delete', ['orgs', orgId, 'stations', id], null, { title: t('Remove a station') });

/** For the app creator: every company with a few numbers. */
export interface CompanyRow { id: string; name: string; createdAt: number; vans: number; people: number; checks: number; trial: ReturnType<typeof standing> }
export async function allCompanies(): Promise<CompanyRow[]> {
  const snap = await getDocs(query(collection(db(), 'orgs'), orderBy('createdAt', 'desc')));
  const count = async (orgId: string, c: string) => {
    try { return (await getCountFromServer(collection(db(), 'orgs', orgId, c))).data().count; } catch { return -1; }
  };
  return Promise.all(snap.docs.map(async (d) => {
    const o = d.data() as Org;
    const [vans, people, checks] = await Promise.all([count(d.id, 'vehicles'), count(d.id, 'members'), count(d.id, 'checks')]);
    return { id: d.id, name: o.name, createdAt: o.createdAt || 0, vans, people, checks, trial: standing(o) };
  }));
}

/**
 * Assignment history of one van or one person, newest first. Owners read everything; managers only their
 * stations (the rules check it); drivers only their own.
 */
export function watchHistory(orgId: string, by: { vehicleId?: string; driverId?: string }, stations: string[] | null,
  cb: (rows: Assignment[]) => void, onError?: () => void) {
  const base = collection(db(), 'orgs', orgId, 'assignments');
  const f = by.vehicleId ? where('vehicleId', '==', by.vehicleId) : where('driverId', '==', by.driverId);
  const q = stations ? query(base, f, where('stationId', 'in', stations.slice(0, 30)), orderBy('start', 'desc'), limit(300))
    : query(base, f, orderBy('start', 'desc'), limit(300));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Assignment, 'id'>) }))), () => onError?.());
}

/**
 * All walk-arounds and damage checks of one van, newest first (up to 300 each), for its damage record. Owners
 * read everything; managers and drivers what's at their stations.
 */
export function watchVanRecords(orgId: string, vehicleId: string, stations: string[] | null,
  cb: (r: { walks: Walkaround[] | null; checks: Check[] | null }) => void, onError?: () => void) {
  let walks: Walkaround[] | null = null, checks: Check[] | null = null;
  const q = (name: string) => {
    const base = collection(db(), 'orgs', orgId, name);
    return stations ? query(base, where('vehicleId', '==', vehicleId), where('stationId', 'in', stations.slice(0, 30)), orderBy('createdAt', 'desc'), limit(300))
      : query(base, where('vehicleId', '==', vehicleId), orderBy('createdAt', 'desc'), limit(300));
  };
  if (stations && !stations.length) { cb({ walks: [], checks: [] }); return () => {}; }
  const a = onSnapshot(q('walkarounds'), (snap) => { walks = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Walkaround, 'id'>) })); cb({ walks, checks }); }, () => onError?.());
  const b = onSnapshot(q('checks'), (snap) => { checks = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Check, 'id'>) })); cb({ walks, checks }); }, () => onError?.());
  return () => { a(); b(); };
}

/** Comments on a van's damage, oldest first. Owners and the station's managers only. */
export function watchDamageNotes(orgId: string, vehicleId: string, stations: string[] | null, cb: (rows: DamageNote[]) => void, onError?: () => void) {
  const base = collection(db(), 'orgs', orgId, 'damageNotes');
  if (stations && !stations.length) { cb([]); return () => {}; }
  const q = stations ? query(base, where('vehicleId', '==', vehicleId), where('stationId', 'in', stations.slice(0, 30)), orderBy('createdAt', 'asc'), limit(500))
    : query(base, where('vehicleId', '==', vehicleId), orderBy('createdAt', 'asc'), limit(500));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DamageNote, 'id'>) }))), () => onError?.());
}
export async function addDamageNote(orgId: string, n: Omit<DamageNote, 'id' | 'createdAt'>) {
  const ref = doc(collection(db(), 'orgs', orgId, 'damageNotes'));
  await sendWrite('set', ['orgs', orgId, 'damageNotes', ref.id], { ...n, text: n.text.trim().slice(0, 1000), createdAt: Date.now() },
    { title: t('A comment on damage'), vehicleId: (n as { vehicleId?: string }).vehicleId || null });
}
