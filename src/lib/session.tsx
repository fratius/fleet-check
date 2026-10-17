import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as fbSignOut,
  updateProfile, type User,
} from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fb } from './firebase';
import { LOCAL_STATION, ai, makeStore, type Store } from './store';
import { roleOf, type Check, type JoinDetails, type Member, type Org, type Role, type Scan, type Station, type Tier, type Vehicle, type Walkaround } from './types';

type Status = 'loading' | 'signedOut' | 'needsOrg' | 'ready';

/** A company this person belongs to, for the company switcher. */
export interface Company { id: string; name: string; role: Role }

interface Session {
  status: Status;
  mode: 'firebase' | 'local';
  user: { uid: string; email: string; name: string } | null;
  /** The app creator: sees and manages every company. */
  creator: boolean;
  companies: Company[];
  org: Org | null;
  member: Member | null;
  /** Role in the open company. The app creator acts as owner in any company. */
  role: Role | null;
  /** Owner or manager: can manage vans and people and review damage. */
  staff: boolean;
  /** Stations this person works at; every station for owners. */
  myStations: Station[];
  stations: Station[];
  stationName(id: string | null | undefined): string;
  /** Can this person manage vans, drivers and damage at this station? */
  runs(stationId: string | null | undefined): boolean;
  store: Store | null;
  vehicles: Vehicle[]; walks: Walkaround[]; checks: Check[]; scans: Scan[];
  loaded: { vehicles: boolean; walks: boolean; checks: boolean; scans: boolean; stations: boolean };
  dataError: string | null;
  /** AI model for this company's checks. The owner sets it for everyone. */
  tier: Tier;
  setTier(t: Tier): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<void>;
  createOrg(company: string, station: string): Promise<void>;
  /** Uses an invite link (one person, 24 hours) with the person's details. */
  joinWithLink(token: string, details: JoinDetails): Promise<{ orgName: string; role: string; stationName: string }>;
  /** Makes (or reopens) the person's demo company with made-up stations, people, vans and checks. */
  openDemo(): Promise<void>;
  /** Removes the open demo company. */
  removeDemo(): Promise<void>;
  switchOrg(orgId: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

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
    case 'permission-denied': return (e as Error)?.message || 'You don\'t have access to that.';
    default: return (e as Error)?.message || 'Something went wrong. Try again.';
  }
}

const LOCAL_ORG: Org = { id: 'local', name: 'This phone', createdBy: 'local', stationsReady: true };
const TEST_ROLE = (Constants.expoConfig?.extra as { testRole?: string } | undefined)?.testRole;
const LOCAL_MEMBER: Member = TEST_ROLE === 'manager' || TEST_ROLE === 'driver'
  ? { uid: 'local', role: TEST_ROLE, stationIds: [LOCAL_STATION], email: '', name: 'You' }
  : { uid: 'local', role: 'owner', stationIds: [], email: '', name: 'You' };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const f = fb();
  const mode: 'firebase' | 'local' = f ? 'firebase' : 'local';
  const [status, setStatus] = useState<Status>(f ? 'loading' : 'ready');
  const [user, setUser] = useState<Session['user']>(f ? null : { uid: 'local', email: '', name: 'You' });
  const [creator, setCreator] = useState(false);
  const [companies, setCompanies] = useState<Company[]>(f ? [] : [{ id: 'local', name: LOCAL_ORG.name, role: roleOf(LOCAL_MEMBER)! }]);
  const [org, setOrg] = useState<Org | null>(f ? null : LOCAL_ORG);
  const [member, setMember] = useState<Member | null>(f ? null : LOCAL_MEMBER);
  const [localTier, setLocalTier] = useState<Tier>('default');
  const fbUser = useRef<User | null>(null);
  const orgRef = useRef<Org | null>(null);
  const isCreator = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('fc.tier').then((t) => { if (t === 'quick' || t === 'default' || t === 'complex') setLocalTier(t); }).catch(() => {});
  }, []);

  /** Reads the person's companies and opens `want` (or the one they had open last). */
  // Several loads can overlap (sign-in, joining, switching); only the latest one may set the state.
  const loadSeq = useRef(0);
  const load = useCallback(async (u: User, want?: string) => {
    const f2 = fb()!;
    const my = ++loadSeq.current;
    const prof = await getDoc(doc(f2.db, 'users', u.uid));
    const p = (prof.exists() ? prof.data() : {}) as { orgIds?: string[]; orgId?: string };
    const ids = Array.from(new Set([...(p.orgIds || []), ...(p.orgId ? [p.orgId] : [])]));
    const rows = (await Promise.all(ids.map(async (id) => {
      try {
        const [o, m] = await Promise.all([getDoc(doc(f2.db, 'orgs', id)), getDoc(doc(f2.db, 'orgs', id, 'members', u.uid))]);
        if (!o.exists() || !m.exists()) return null;
        return { org: { id, ...(o.data() as Omit<Org, 'id'>) }, member: { uid: u.uid, ...(m.data() as Omit<Member, 'uid'>) } };
      } catch { return null; }
    }))).filter(Boolean) as { org: Org; member: Member }[];
    if (my !== loadSeq.current) return;
    setCompanies(rows.map((r) => ({ id: r.org.id, name: r.org.name, role: roleOf(r.member)! })));
    const target = want || p.orgId;
    let pick = rows.find((r) => r.org.id === target) || rows[0] || null;
    // The app creator can open any company, member or not.
    if (target && !rows.some((r) => r.org.id === target) && isCreator.current) {
      const o = await getDoc(doc(f2.db, 'orgs', target)).catch(() => null);
      if (o?.exists()) pick = { org: { id: target, ...(o.data() as Omit<Org, 'id'>) }, member: { uid: u.uid, role: 'owner', stationIds: [], email: u.email || '', name: u.displayName || 'App creator' } };
    }
    if (my !== loadSeq.current) return;
    if (!pick) { setOrg(null); setMember(null); setStatus('needsOrg'); return; }
    setOrg(pick.org);
    setMember(pick.member);
    setStatus('ready');
    if (p.orgId !== pick.org.id) setDoc(doc(f2.db, 'users', u.uid), { orgId: pick.org.id }, { merge: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!f) return;
    return onAuthStateChanged(f.auth, async (u) => {
      fbUser.current = u;
      if (!u) { setUser(null); setOrg(null); setMember(null); setCompanies([]); setCreator(false); isCreator.current = false; setStatus('signedOut'); return; }
      setUser({ uid: u.uid, email: u.email || '', name: u.displayName || (u.email || '').split('@')[0] });
      // Refresh the sign-in token so a newly given app creator claim shows up straight away.
      try { const t = await u.getIdTokenResult(true); isCreator.current = t.claims.creator === true; } catch { isCreator.current = false; }
      setCreator(isCreator.current);
      try { await load(u); } catch { setStatus('needsOrg'); }
    });
  }, [f, load]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(fb()!.auth, email.trim(), password);
  }, []);
  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(fb()!.auth, email.trim(), password);
    if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
    setUser({ uid: cred.user.uid, email: cred.user.email || '', name: name.trim() || (cred.user.email || '').split('@')[0] });
  }, []);
  const displayName = (u: User) => u.displayName || (u.email || '').split('@')[0];

  /** A new company with its first station; the person becomes its owner. */
  const createOrg = useCallback(async (company: string, station: string) => {
    const f2 = fb()!, u = fbUser.current!;
    const ref = doc(collection(f2.db, 'orgs'));
    await setDoc(ref, { name: company.trim().slice(0, 60), createdBy: u.uid, createdAt: Date.now(), stationsReady: true });
    await setDoc(doc(f2.db, 'orgs', ref.id, 'members', u.uid), { role: 'owner', stationIds: [], email: u.email || '', name: displayName(u), joinedAt: Date.now() });
    await setDoc(doc(collection(f2.db, 'orgs', ref.id, 'stations')), { name: station.trim().slice(0, 40) || 'Main station', code: '', createdAt: Date.now() });
    await setDoc(doc(f2.db, 'users', u.uid), { orgIds: arrayUnion(ref.id), orgId: ref.id, email: u.email || '', name: displayName(u) }, { merge: true });
    await load(u, ref.id);
  }, [load]);

  const joinWithLink = useCallback(async (token: string, details: JoinDetails) => {
    const u = fb()!.auth.currentUser || fbUser.current!;
    const r = await ai.acceptInvite({ token, details });
    // The server set the display name; refresh so the app shows it.
    await u.reload().catch(() => {});
    setUser({ uid: u.uid, email: u.email || '', name: u.displayName || [details.firstName, details.lastName].join(' ') });
    await load(u, r.orgId);
    return r;
  }, [load]);

  const openDemo = useCallback(async () => {
    const u = fb()!.auth.currentUser || fbUser.current!;
    const r = await ai.createDemoCompany({});
    await load(u, r.orgId);
  }, [load]);

  const removeDemoFn = useCallback(async () => {
    const u = fbUser.current!;
    if (!orgRef.current?.demo) return;
    setStatus('loading');
    try { await ai.deleteDemoCompany({ orgId: orgRef.current.id }); } finally { await load(u).catch(() => setStatus('needsOrg')); }
  }, [load]);

  const switchOrg = useCallback(async (orgId: string) => {
    const u = fbUser.current;
    if (!u) return;
    setStatus('loading');
    try { await load(u, orgId); } catch { setStatus('needsOrg'); }
  }, [load]);

  const resetPassword = useCallback(async (email: string) => { await sendPasswordResetEmail(fb()!.auth, email.trim()); }, []);
  const signOut = useCallback(async () => { if (fb()) await fbSignOut(fb()!.auth); }, []);

  orgRef.current = org;
  const role = roleOf(member);
  const tier: Tier = mode === 'local' ? localTier : (org?.aiTier || 'default');
  const setTier = useCallback(async (t: Tier) => {
    if (mode === 'local') { setLocalTier(t); AsyncStorage.setItem('fc.tier', t).catch(() => {}); return; }
    if (!org || role !== 'owner') return;
    await updateDoc(doc(fb()!.db, 'orgs', org.id), { aiTier: t });
    setOrg((o) => (o && o.id === org.id ? { ...o, aiTier: t } : o));
  }, [mode, org, role]);
  const staff = role === 'owner' || role === 'manager';
  // Owners (and the app creator) read every station; managers and drivers only their own.
  const scopeKey = role === 'owner' ? '*' : (member?.stationIds || []).join(',');
  const store = useMemo(() => {
    if (status !== 'ready') return null;
    if (mode === 'local') return makeStore(null);
    return makeStore(org?.id || null, scopeKey === '*' ? null : scopeKey ? scopeKey.split(',') : []);
  }, [status, mode, org?.id, scopeKey]);

  const [stations, setStations] = useState<Station[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [walks, setWalks] = useState<Walkaround[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loaded, setLoaded] = useState({ vehicles: false, walks: false, checks: false, scans: false, stations: false });
  const [dataError, setDataError] = useState<string | null>(null);
  useEffect(() => {
    setStations([]); setVehicles([]); setWalks([]); setChecks([]); setScans([]);
    setLoaded({ vehicles: false, walks: false, checks: false, scans: false, stations: false });
    setDataError(null);
    if (!store) return;
    const err = () => setDataError('Couldn\'t load the fleet data. Check your internet, then reopen the app.');
    const subs = [
      store.stations.subscribe((r) => { setStations(r.slice().sort((a, b) => a.createdAt - b.createdAt)); setLoaded((l) => ({ ...l, stations: true })); }, err),
      store.vehicles.subscribe((r) => { setVehicles(r); setLoaded((l) => ({ ...l, vehicles: true })); }, err),
      store.walks.subscribe((r) => { setWalks(r); setLoaded((l) => ({ ...l, walks: true })); }, err),
      store.checks.subscribe((r) => { setChecks(r); setLoaded((l) => ({ ...l, checks: true })); }, err),
    ];
    if (staff) subs.push(store.scans.subscribe((r) => { setScans(r); setLoaded((l) => ({ ...l, scans: true })); }, err));
    else setLoaded((l) => ({ ...l, scans: true }));
    return () => subs.forEach((u) => u());
  }, [store, staff]);

  // A company made before stations existed: the owner's first visit moves it onto a "Main station".
  const migrating = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !org || org.stationsReady || role !== 'owner' || migrating.current === org.id) return;
    migrating.current = org.id;
    ai.setupStations({ orgId: org.id })
      .then(() => { setOrg((o) => (o && o.id === org.id ? { ...o, stationsReady: true } : o)); if (fbUser.current) load(fbUser.current, org.id).catch(() => {}); })
      .catch(() => { migrating.current = null; });
  }, [mode, status, org, role, load]);

  const myStations = useMemo(() => {
    if (mode === 'local' || role === 'owner') return stations;
    const ids = member?.stationIds || [];
    return stations.filter((st) => ids.includes(st.id));
  }, [stations, member, role, mode]);
  const stationName = useCallback((id: string | null | undefined) => {
    const st = stations.find((x) => x.id === (id || (mode === 'local' ? LOCAL_STATION : '')));
    return st ? st.name : id ? 'Unknown station' : 'No station';
  }, [stations, mode]);
  const runs = useCallback((stationId: string | null | undefined) => {
    if (role === 'owner') return true;
    return role === 'manager' && !!stationId && (member?.stationIds || []).includes(stationId);
  }, [role, member]);

  const value: Session = {
    status, mode, user, creator, companies, org, member, role, staff, myStations, stations, stationName, runs,
    store, vehicles, walks, checks, scans, loaded, dataError, tier, setTier,
    signIn, signUp, createOrg, joinWithLink, openDemo, removeDemo: removeDemoFn, switchOrg, resetPassword, signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
