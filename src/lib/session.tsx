import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as fbSignOut,
  updateProfile, type User,
} from 'firebase/auth';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fb } from './firebase';
import { makeStore, type Store } from './store';
import type { Check, Member, Org, Scan, Tier, Vehicle, Walkaround } from './types';

type Status = 'loading' | 'signedOut' | 'needsOrg' | 'ready';

interface Session {
  status: Status;
  mode: 'firebase' | 'local';
  user: { uid: string; email: string; name: string } | null;
  org: Org | null;
  member: Member | null;
  store: Store | null;
  vehicles: Vehicle[]; walks: Walkaround[]; checks: Check[]; scans: Scan[];
  loaded: { vehicles: boolean; walks: boolean; checks: boolean; scans: boolean };
  dataError: string | null;
  tier: Tier;
  setTier(t: Tier): void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<void>;
  createOrg(company: string): Promise<void>;
  joinOrg(code: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

const code6 = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-email': return 'That email address doesn\'t look right.';
    case 'auth/missing-password': return 'Enter your password.';
    case 'auth/weak-password': return 'Use at least 6 characters for the password.';
    case 'auth/email-already-in-use': return 'An account with this email already exists. Sign in instead.';
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': return 'Email or password is wrong.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/network-request-failed': return 'No connection. Check your internet and try again.';
    case 'auth/operation-not-allowed': return 'Email sign-in isn\'t turned on in Firebase yet.';
    case 'permission-denied': return 'You don\'t have access to that. Check the invite code.';
    default: return (e as Error)?.message || 'Something went wrong. Try again.';
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const f = fb();
  const mode: 'firebase' | 'local' = f ? 'firebase' : 'local';
  const [status, setStatus] = useState<Status>(f ? 'loading' : 'ready');
  const [user, setUser] = useState<Session['user']>(f ? null : { uid: 'local', email: '', name: 'You' });
  const [org, setOrg] = useState<Org | null>(f ? null : { id: 'local', name: 'This phone', inviteCode: '', createdBy: 'local' });
  const [member, setMember] = useState<Member | null>(f ? null : { uid: 'local', role: 'admin', email: '', name: 'You' });
  const [tier, setTierState] = useState<Tier>('default');
  const fbUser = useRef<User | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('fc.tier').then((t) => { if (t === 'quick' || t === 'default' || t === 'complex') setTierState(t); }).catch(() => {});
  }, []);
  const setTier = useCallback((t: Tier) => { setTierState(t); AsyncStorage.setItem('fc.tier', t).catch(() => {}); }, []);

  const loadOrg = useCallback(async (u: User) => {
    const f2 = fb()!;
    const prof = await getDoc(doc(f2.db, 'users', u.uid));
    const orgId = prof.exists() ? (prof.data().orgId as string | undefined) : undefined;
    if (!orgId) { setOrg(null); setMember(null); setStatus('needsOrg'); return; }
    const [o, m] = await Promise.all([getDoc(doc(f2.db, 'orgs', orgId)), getDoc(doc(f2.db, 'orgs', orgId, 'members', u.uid))]);
    if (!o.exists() || !m.exists()) { setOrg(null); setMember(null); setStatus('needsOrg'); return; }
    setOrg({ id: o.id, ...(o.data() as Omit<Org, 'id'>) });
    setMember({ uid: u.uid, ...(m.data() as Omit<Member, 'uid'>) });
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (!f) return;
    return onAuthStateChanged(f.auth, async (u) => {
      fbUser.current = u;
      if (!u) { setUser(null); setOrg(null); setMember(null); setStatus('signedOut'); return; }
      setUser({ uid: u.uid, email: u.email || '', name: u.displayName || (u.email || '').split('@')[0] });
      try { await loadOrg(u); } catch { setStatus('needsOrg'); }
    });
  }, [f, loadOrg]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(fb()!.auth, email.trim(), password);
  }, []);
  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(fb()!.auth, email.trim(), password);
    if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
    setUser({ uid: cred.user.uid, email: cred.user.email || '', name: name.trim() || (cred.user.email || '').split('@')[0] });
  }, []);
  const createOrg = useCallback(async (company: string) => {
    const f2 = fb()!, u = fbUser.current!;
    const ref = doc(collection(f2.db, 'orgs'));
    const inviteCode = code6();
    const name = u.displayName || (u.email || '').split('@')[0];
    await setDoc(ref, { name: company.trim(), inviteCode, createdBy: u.uid, createdAt: Date.now() });
    await setDoc(doc(f2.db, 'orgs', ref.id, 'members', u.uid), { role: 'admin', email: u.email || '', name, joinedAt: Date.now() });
    await setDoc(doc(f2.db, 'invites', inviteCode), { orgId: ref.id, createdBy: u.uid, createdAt: Date.now() });
    await setDoc(doc(f2.db, 'users', u.uid), { orgId: ref.id, email: u.email || '', name });
    await loadOrg(u);
  }, [loadOrg]);
  const joinOrg = useCallback(async (codeIn: string) => {
    const f2 = fb()!, u = fbUser.current!;
    const code = codeIn.trim().toUpperCase();
    const inv = await getDoc(doc(f2.db, 'invites', code));
    if (!inv.exists()) throw { code: 'permission-denied', message: 'No company uses this invite code.' };
    const orgId = inv.data().orgId as string;
    const name = u.displayName || (u.email || '').split('@')[0];
    await setDoc(doc(f2.db, 'orgs', orgId, 'members', u.uid), { role: 'driver', email: u.email || '', name, joinedAt: Date.now(), inviteCode: code });
    await setDoc(doc(f2.db, 'users', u.uid), { orgId, email: u.email || '', name });
    await loadOrg(u);
  }, [loadOrg]);
  const resetPassword = useCallback(async (email: string) => { await sendPasswordResetEmail(fb()!.auth, email.trim()); }, []);
  const signOut = useCallback(async () => { if (fb()) await fbSignOut(fb()!.auth); }, []);

  const store = useMemo(() => (status === 'ready' ? makeStore(mode === 'firebase' ? org?.id || null : null) : null), [status, mode, org?.id]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [walks, setWalks] = useState<Walkaround[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loaded, setLoaded] = useState({ vehicles: false, walks: false, checks: false, scans: false });
  const [dataError, setDataError] = useState<string | null>(null);
  useEffect(() => {
    setVehicles([]); setWalks([]); setChecks([]); setScans([]);
    setLoaded({ vehicles: false, walks: false, checks: false, scans: false });
    setDataError(null);
    if (!store) return;
    const err = () => setDataError('Lost the connection to the fleet data. Check your internet, then reopen the app.');
    const u1 = store.vehicles.subscribe((r) => { setVehicles(r); setLoaded((l) => ({ ...l, vehicles: true })); }, err);
    const u2 = store.walks.subscribe((r) => { setWalks(r); setLoaded((l) => ({ ...l, walks: true })); }, err);
    const u3 = store.checks.subscribe((r) => { setChecks(r); setLoaded((l) => ({ ...l, checks: true })); }, err);
    const u4 = store.scans.subscribe((r) => { setScans(r); setLoaded((l) => ({ ...l, scans: true })); }, err);
    return () => { u1(); u2(); u3(); u4(); };
  }, [store]);

  const value: Session = {
    status, mode, user, org, member, store, vehicles, walks, checks, scans, loaded, dataError, tier, setTier,
    signIn, signUp, createOrg, joinOrg, resetPassword, signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Photos of a walk-around that's in progress or just finished, kept in memory until uploaded. */
export const draft = {
  walk: null as null | { vehicleId: string; photos: { n: number; label: string; uri: string; w: number; h: number; takenAt: number; retakes: number }[]; frames: number; retakes: number; skipped: number; totalMs: number; source: 'camera' | 'library' },
};
