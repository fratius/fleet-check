import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

import { fb } from './firebase';
import type { Invite, Member, Org, Role, Station } from './types';

/** People, stations and invite codes of a company. Firestore only; test mode has none of this. */

const db = () => fb()!.db;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const code6 = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export function watchMembers(orgId: string, cb: (rows: Member[]) => void, onError?: () => void) {
  return onSnapshot(collection(db(), 'orgs', orgId, 'members'),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }))),
    () => onError?.());
}

export function watchInvites(orgId: string, cb: (rows: Invite[]) => void, onError?: () => void) {
  return onSnapshot(query(collection(db(), 'invites'), where('orgId', '==', orgId), orderBy('createdAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => d.data() as Invite)),
    () => onError?.());
}

export async function createInvite(org: Org, station: Station, role: 'manager' | 'driver', uid: string): Promise<Invite> {
  for (let tries = 0; tries < 5; tries++) {
    const code = code6();
    const ref = doc(db(), 'invites', code);
    if ((await getDoc(ref)).exists()) continue;
    const inv: Invite = { code, orgId: org.id, orgName: org.name, role, stationId: station.id, stationName: station.name, createdBy: uid, createdAt: Date.now() };
    await setDoc(ref, inv);
    return inv;
  }
  throw new Error('Couldn\'t make a new code. Try again.');
}
export const deleteInvite = (code: string) => deleteDoc(doc(db(), 'invites', code));

export const setMember = (orgId: string, uid: string, patch: { role?: Role; stationIds?: string[] }) => updateDoc(doc(db(), 'orgs', orgId, 'members', uid), patch);
export const removeMember = (orgId: string, uid: string) => deleteDoc(doc(db(), 'orgs', orgId, 'members', uid));

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
