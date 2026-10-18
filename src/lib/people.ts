import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

import { fb } from './firebase';
import type { Assignment, Invite, Member, Org, Walkaround } from './types';

/** People, stations and invite links of a company. Firestore only; test mode has none of this. */

const db = () => fb()!.db;
export function watchMembers(orgId: string, cb: (rows: Member[]) => void, onError?: () => void) {
  return onSnapshot(collection(db(), 'orgs', orgId, 'members'),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }))),
    () => onError?.());
}

/** One walk-around by id, for history links to photos older than the ones the app keeps loaded. */
export async function fetchWalk(orgId: string, id: string): Promise<Walkaround | null> {
  try {
    const d = await getDoc(doc(db(), 'orgs', orgId, 'walkarounds', id));
    return d.exists() ? ({ id: d.id, ...(d.data() as Omit<Walkaround, 'id'>) }) : null;
  } catch { return null; }
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

export const deleteInvite = (token: string) => deleteDoc(doc(db(), 'invites', token));

/** The web address of an invite link. It opens the join page of the web app. */
export function inviteUrl(token: string) {
  const origin = typeof window !== 'undefined' && window.location?.origin?.startsWith('http') ? window.location.origin : `https://${fb()?.app.options.projectId}.web.app`;
  return `${origin}/join/${token}`;
}
/** The token from a pasted invite link (or the bare token). */
export function tokenFrom(text: string) {
  const t = text.trim();
  const m = t.match(/join\/([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
}


export async function addStation(orgId: string, name: string, code: string) {
  const ref = doc(collection(db(), 'orgs', orgId, 'stations'));
  await setDoc(ref, { name: name.trim().slice(0, 40), code: code.trim().toUpperCase().slice(0, 12), createdAt: Date.now() });
  return ref.id;
}
export const renameStation = (orgId: string, id: string, name: string, code: string) =>
  updateDoc(doc(db(), 'orgs', orgId, 'stations', id), { name: name.trim().slice(0, 40), code: code.trim().toUpperCase().slice(0, 12) });
export const deleteStation = (orgId: string, id: string) => deleteDoc(doc(db(), 'orgs', orgId, 'stations', id));

/** For the app creator: every company with a few numbers. */
export interface CompanyRow { id: string; name: string; createdAt: number; vans: number; people: number; checks: number }
export async function allCompanies(): Promise<CompanyRow[]> {
  const snap = await getDocs(query(collection(db(), 'orgs'), orderBy('createdAt', 'desc')));
  const count = async (orgId: string, c: string) => {
    try { return (await getCountFromServer(collection(db(), 'orgs', orgId, c))).data().count; } catch { return -1; }
  };
  return Promise.all(snap.docs.map(async (d) => {
    const o = d.data() as Org;
    const [vans, people, checks] = await Promise.all([count(d.id, 'vehicles'), count(d.id, 'members'), count(d.id, 'checks')]);
    return { id: d.id, name: o.name, createdAt: o.createdAt || 0, vans, people, checks };
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
