import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  EmailAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as fbSignOut,
  updateProfile, type User,
} from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fb } from './firebase';
import { t } from './i18n';
import { useLang } from './lang';
import { forgetPush, refreshPush } from './push';
import { LOCAL_STATION, ai, makeStore, type Store } from './store';
import { roleOf, type Assignment, type Check, type Purchase, type Routine, type RoutineDone, type CheckUsage, type DriverRecord, type Tour, type VehicleCosts, type VehicleDetails, type Video, type JoinDetails, type Member, type Org, type Role, type Scan, type Station, type Tier, type Vehicle, type Walkaround } from './types';

type Status = 'loading' | 'signedOut' | 'needsOrg' | 'ready';

/** A company this person belongs to, for the company switcher. */
export interface Company { id: string; name: string; role: Role }

/** The app creator viewing the open company as an owner, fleet manager or driver (of one station). */
export interface ViewAs { org: string; role: Role; st: string | null }
function parseViewAs(v: unknown): ViewAs | null {
  const x = v as { org?: unknown; role?: unknown; st?: unknown } | null | undefined;
  if (!x || typeof x.org !== 'string') return null;
  const role: Role = x.role === 'owner' ? 'owner' : x.role === 'manager' ? 'manager' : 'driver';
  return { org: x.org, role, st: role !== 'owner' && typeof x.st === 'string' ? x.st : null };
}

interface Session {
  status: Status;
  mode: 'firebase' | 'local';
  user: { uid: string; email: string; name: string } | null;
  /** The app creator: sees and manages every company. False while viewing the app as someone else. */
  creator: boolean;
  /** Can switch to viewing the app as an owner, manager or driver: the app creator (and test mode). */
  canViewAs: boolean;
  /** Sees AI speed and cost and the test log: the app creator as themselves (and test mode, as the owner). */
  seesAiStats: boolean;
  /** Viewing the open company as this role; null when being yourself. The server and the rules apply it too. */
  viewAs: ViewAs | null;
  /** View the open company as this role (managers and drivers at a station), or null to be yourself again. */
  setViewAs(role: Role | null, stationId?: string | null): Promise<void>;
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
  /** Recent assignments (the latest 500 in scope). Full history per van or person: watchHistory. */
  assignments: Assignment[];
  /** Recent handover videos (the latest 500 in scope; drivers: their own). */
  videos: Video[];
  /** Contract, insurance and deadlines of the vans in scope: owners and managers only (empty for drivers). */
  details: VehicleDetails[];
  /** What each van costs: owners only (empty for everyone else). */
  costs: VehicleCosts[];
  /** Driver records in scope (owners and managers); a driver gets only their own. */
  records: DriverRecord[];
  /** Recent tours (the latest 500 in scope; drivers: their own). */
  tours: Tour[];
  /** Recent refuels, washes and parts (the latest 500 in scope; drivers: their own). */
  purchases: Purchase[];
  /** Checks for drivers in this company, and the recent checks done this person may read. */
  routines: Routine[];
  routineDone: RoutineDone[];
  /** This person's own driver record, if there is one. */
  myRecord: DriverRecord | null;
  /** Owners change company settings: dashboard photos on tours, how often licences are checked. */
  setOrgSettings(patch: Partial<Pick<Org, 'dashScans' | 'licenceCheckMonths'>>): Promise<void>;
  /** The van this person drives now, if any. */
  myVan: Vehicle | null;
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
  /** Makes (or reopens) the person's demo company with made-up stations, people, vans and checks. `fresh` starts it over. */
  openDemo(fresh?: boolean): Promise<void>;
  /** Removes the open demo company. */
  removeDemo(): Promise<void>;
  switchOrg(orgId: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Deletes the person's account after they entered their password again (deleteAccount on the server). */
  deleteAccount(password: string): Promise<void>;
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
    case 'auth/invalid-email': return t('That email address doesn\'t look right.');
    case 'auth/missing-password': return t('Enter your password.');
    case 'auth/weak-password': return t('Use at least 6 characters for the password.');
    case 'auth/email-already-in-use': return t('An account with this email already exists. Sign in instead.');
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': return t('Email or password is wrong.');
    case 'auth/too-many-requests': return t('Too many attempts. Wait a minute, then try again.');
    case 'auth/network-request-failed': return t('No connection. Check your internet and try again.');
    case 'auth/operation-not-allowed': return t('Email sign-in isn\'t turned on in Firebase yet.');
    // Messages from the server and the app are written for people already; translated where the app has them.
    case 'permission-denied': return (e as Error)?.message ? t((e as Error).message) : t('You don\'t have access to that.');
    default: return (e as Error)?.message ? t((e as Error).message) : t('Something went wrong. Try again.');
  }
}

const LOCAL_ORG: Org = { id: 'local', name: 'This phone', createdBy: 'local', stationsReady: true };
const TEST_ROLE = (Constants.expoConfig?.extra as { testRole?: string } | undefined)?.testRole;
const LOCAL_MEMBER: Member = TEST_ROLE === 'manager' || TEST_ROLE === 'driver'
  ? { uid: 'local', role: TEST_ROLE, stationIds: [LOCAL_STATION], email: '', name: 'You' }
  : { uid: 'local', role: 'owner', stationIds: [], email: '', name: 'You' };

const displayName = (u: User) => u.displayName || (u.email || '').split('@')[0];

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const f = fb();
  const mode: 'firebase' | 'local' = f ? 'firebase' : 'local';
  const [status, setStatus] = useState<Status>(f ? 'loading' : 'ready');
  const [user, setUser] = useState<Session['user']>(f ? null : { uid: 'local', email: '', name: 'You' });
  const [creator, setCreator] = useState(false);
  const [companies, setCompanies] = useState<Company[]>(f ? [] : [{ id: 'local', name: LOCAL_ORG.name, role: roleOf(LOCAL_MEMBER)! }]);
  const [org, setOrg] = useState<Org | null>(f ? null : LOCAL_ORG);
  const [member, setMember] = useState<Member | null>(f ? null : LOCAL_MEMBER);
  const [localTier, setLocalTier] = useState<Tier>('quick');
  const [viewAs, setViewAsState] = useState<ViewAs | null>(null);
  const fbUser = useRef<User | null>(null);
  const orgRef = useRef<Org | null>(null);
  const isCreator = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('fc.tier').then((t) => { if (t === 'quick' || t === 'default' || t === 'complex') setLocalTier(t); }).catch(() => {});
    // Test mode: the role picked in the Account tab stays on this phone.
    if (!f) {
      AsyncStorage.getItem('fc.viewAs').then((t) => {
        const va = t ? parseViewAs(JSON.parse(t)) : null;
        if (va) { setViewAsState(va); setMember({ ...LOCAL_MEMBER, role: va.role, stationIds: va.st ? [va.st] : [] }); }
      }).catch(() => {});
    }
  }, [f]);

  /** Reads the person's companies and opens `want` (or the one they had open last). */
  // Several loads can overlap (sign-in, joining, switching); only the latest one may set the state.
  const loadSeq = useRef(0);
  const langCtx = useLang();
  const langRef = useRef(langCtx);
  langRef.current = langCtx;
  const load = useCallback(async (u: User, want?: string) => {
    const f2 = fb()!;
    const my = ++loadSeq.current;
    const prof = await getDoc(doc(f2.db, 'users', u.uid));
    const p = (prof.exists() ? prof.data() : {}) as { orgIds?: string[]; orgId?: string; viewAs?: unknown; lang?: unknown; appLang?: unknown };
    // The language on the profile follows the person to this phone.
    langRef.current.fromProfile(u.uid, p);
    // The app creator viewing a company as someone else: only that company, with that role and station.
    const va = isCreator.current ? parseViewAs(p.viewAs) : null;
    if (va) {
      const [o, real] = await Promise.all([getDoc(doc(f2.db, 'orgs', va.org)).catch(() => null), getDoc(doc(f2.db, 'orgs', va.org, 'members', u.uid)).catch(() => null)]);
      if (my !== loadSeq.current) return;
      if (o?.exists()) {
        const org: Org = { id: va.org, ...(o.data() as Omit<Org, 'id'>) };
        setViewAsState(va);
        setCompanies([{ id: org.id, name: org.name, role: va.role }]);
        setOrg(org);
        setMember({ uid: u.uid, role: va.role, stationIds: va.st ? [va.st] : [], email: u.email || '', name: (real?.data() as Member | undefined)?.name || displayName(u) });
        setStatus('ready');
        return;
      }
      // The company is gone (for example a removed demo): be yourself again.
      await setDoc(doc(f2.db, 'users', u.uid), { viewAs: null }, { merge: true }).catch(() => {});
    }
    setViewAsState(null);
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
      if (!u) { setUser(null); setOrg(null); setMember(null); setCompanies([]); setCreator(false); setViewAsState(null); isCreator.current = false; setStatus('signedOut'); return; }
      setUser({ uid: u.uid, email: u.email || '', name: u.displayName || (u.email || '').split('@')[0] });
      // Refresh the sign-in token so a newly given app creator claim shows up straight away.
      try { const t = await u.getIdTokenResult(true); isCreator.current = t.claims.creator === true; } catch { isCreator.current = false; }
      setCreator(isCreator.current);
      try { await load(u); } catch { setStatus('needsOrg'); }
      // If this phone has notifications on, they go to whoever is signed in now.
      refreshPush(u.uid);
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

  /** A new company with its first station; the person becomes its owner. */
  const createOrg = useCallback(async (company: string, station: string) => {
    const f2 = fb()!, u = fbUser.current!;
    const ref = doc(collection(f2.db, 'orgs'));
    await setDoc(ref, { name: company.trim().slice(0, 60), createdBy: u.uid, createdAt: Date.now(), stationsReady: true });
    await setDoc(doc(f2.db, 'orgs', ref.id, 'members', u.uid), { role: 'owner', stationIds: [], email: u.email || '', name: displayName(u), joinedAt: Date.now() });
    await setDoc(doc(collection(f2.db, 'orgs', ref.id, 'stations')), { name: station.trim().slice(0, 40) || t('Main station'), code: '', createdAt: Date.now() });
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

  const openDemo = useCallback(async (fresh = false) => {
    const u = fb()!.auth.currentUser || fbUser.current!;
    if (fresh) setStatus('loading');
    const r = await ai.createDemoCompany(fresh ? { fresh: true } : {}).catch(async (e) => { if (fresh) await load(u).catch(() => setStatus('needsOrg')); throw e; });
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

  const setViewAs = useCallback(async (r: Role | null, stationId?: string | null) => {
    const next: ViewAs | null = r && orgRef.current ? { org: orgRef.current.id, role: r, st: r === 'owner' ? null : stationId || null } : null;
    if (next && next.role !== 'owner' && !next.st) throw new Error(t('Pick a station.'));
    if (!fb()) {
      setViewAsState(next);
      setMember(next ? { ...LOCAL_MEMBER, role: next.role, stationIds: next.st ? [next.st] : [] } : LOCAL_MEMBER);
      AsyncStorage.setItem('fc.viewAs', JSON.stringify(next)).catch(() => {});
      return;
    }
    const u = fbUser.current, o = orgRef.current;
    if (!u || !o || !isCreator.current) return;
    setStatus('loading');
    try {
      await setDoc(doc(fb()!.db, 'users', u.uid), { viewAs: next }, { merge: true });
    } finally {
      await load(u, o.id).catch(() => setStatus('needsOrg'));
    }
  }, [load]);

  const resetPassword = useCallback(async (email: string) => { await sendPasswordResetEmail(fb()!.auth, email.trim()); }, []);
  const signOut = useCallback(async () => {
    if (!fb()) return;
    // This phone stops getting this person's notifications.
    if (fbUser.current) await forgetPush(fbUser.current.uid);
    await fbSignOut(fb()!.auth);
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    const f2 = fb(), u = f2?.auth.currentUser;
    if (!f2 || !u?.email) return;
    // A fresh sign-in, so the server knows the password was entered just now.
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    await ai.deleteAccount({});
    await fbSignOut(f2.auth).catch(() => {});
  }, []);

  orgRef.current = org;
  const role = roleOf(member);
  const tier: Tier = mode === 'local' ? localTier : (org?.aiTier || 'quick');
  const setTier = useCallback(async (t: Tier) => {
    if (mode === 'local') { setLocalTier(t); AsyncStorage.setItem('fc.tier', t).catch(() => {}); return; }
    if (!org || role !== 'owner') return;
    await updateDoc(doc(fb()!.db, 'orgs', org.id), { aiTier: t });
    setOrg((o) => (o && o.id === org.id ? { ...o, aiTier: t } : o));
  }, [mode, org, role]);
  const staff = role === 'owner' || role === 'manager';
  const seesAiStats = mode === 'local' ? !viewAs : creator && !viewAs;
  // Owners (and the app creator) read every station; managers and drivers only their own.
  const scopeKey = role === 'owner' ? '*' : (member?.stationIds || []).join(',');
  const driverOnly = role === 'driver' ? user?.uid || null : null;
  const store = useMemo(() => {
    if (status !== 'ready') return null;
    if (mode === 'local') return makeStore(null);
    return makeStore(org?.id || null, scopeKey === '*' ? null : scopeKey ? scopeKey.split(',') : [], driverOnly);
  }, [status, mode, org?.id, scopeKey, driverOnly]);

  const [stations, setStations] = useState<Station[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [walks, setWalks] = useState<Walkaround[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [usage, setUsage] = useState<CheckUsage[]>([]);
  const [details, setDetails] = useState<VehicleDetails[]>([]);
  const [costs, setCosts] = useState<VehicleCosts[]>([]);
  const [records, setRecords] = useState<DriverRecord[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineDone, setRoutineDone] = useState<RoutineDone[]>([]);
  const [ownRecord, setOwnRecord] = useState<DriverRecord | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState({ vehicles: false, walks: false, checks: false, scans: false, stations: false });
  const [dataError, setDataError] = useState<string | null>(null);
  useEffect(() => {
    setStations([]); setVehicles([]); setWalks([]); setChecks([]); setScans([]); setUsage([]); setDetails([]); setAssignments([]); setVideos([]);
    setCosts([]); setRecords([]); setTours([]); setPurchases([]); setRoutines([]); setRoutineDone([]); setOwnRecord(null);
    setLoaded({ vehicles: false, walks: false, checks: false, scans: false, stations: false });
    setDataError(null);
    if (!store) return;
    const err = () => setDataError(t('Couldn\'t load the fleet data. Check your internet, then reopen the app.'));
    const subs = [
      store.stations.subscribe((r) => { setStations(r.slice().sort((a, b) => a.createdAt - b.createdAt)); setLoaded((l) => ({ ...l, stations: true })); }, err),
      store.vehicles.subscribe((r) => { setVehicles(r); setLoaded((l) => ({ ...l, vehicles: true })); }, err),
      store.walks.subscribe((r) => { setWalks(r); setLoaded((l) => ({ ...l, walks: true })); }, err),
      store.checks.subscribe((r) => { setChecks(r); setLoaded((l) => ({ ...l, checks: true })); }, err),
      store.assignments.subscribe((r) => setAssignments(r), () => {}),
      store.videos.subscribe((r) => setVideos(r), () => {}),
      store.tours.subscribe((r) => setTours(r), () => {}),
      store.purchases.subscribe((r) => setPurchases(r), () => {}),
      store.routines.subscribe((r) => setRoutines(r), () => {}),
      store.routineDone.subscribe((r) => setRoutineDone(r), () => {}),
    ];
    // The business side of the vans and the driver records: owners and managers (the rules refuse drivers).
    if (staff) {
      subs.push(store.details.subscribe((r) => setDetails(r), () => {}));
      subs.push(store.records.subscribe((r) => setRecords(r), () => {}));
    }
    // What the vans cost: owners only.
    if (role === 'owner') subs.push(store.costs.subscribe((r) => setCosts(r), () => {}));
    // Everyone reads their own driver record (licence checks and briefings are about them).
    const uid = user?.uid;
    if (store.mode === 'firebase' && uid && !staff) {
      subs.push(onSnapshot(doc(fb()!.db, 'orgs', store.orgId, 'driverRecords', uid),
        (d) => setOwnRecord(d.exists() ? ({ ...(d.data() as Omit<DriverRecord, 'id'>), id: d.id }) : null), () => setOwnRecord(null)));
    }
    // Type scans and AI speed and cost: only the app creator reads them (the rules refuse everyone else).
    if (seesAiStats) {
      subs.push(store.scans.subscribe((r) => { setScans(r); setLoaded((l) => ({ ...l, scans: true })); }, err));
      subs.push(store.usage.subscribe((r) => setUsage(r), () => {}));
    } else setLoaded((l) => ({ ...l, scans: true }));
    return () => subs.forEach((u) => u());
  }, [store, seesAiStats, staff, role, user?.uid]);
  // For the app creator: each check with its AI speed and cost filled in.
  const checksShown = useMemo(() => {
    if (!seesAiStats || !usage.length) return checks;
    const by = new Map(usage.map((u) => [u.checkId || u.id, u]));
    return checks.map((k) => {
      const u = by.get(k.id);
      if (!u) return k;
      return { ...k, pass1: u.pass1, pass2: u.pass2, spots: k.spots.map((p, j) => (p.verdict ? { ...p, verdict: { ...p.verdict, ms: u.spotMs?.[j] ?? null } } : p)) };
    });
  }, [checks, usage, seesAiStats]);

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
    return st ? st.name : id ? t('Unknown station') : t('No station');
  }, [stations, mode]);
  const runs = useCallback((stationId: string | null | undefined) => {
    if (role === 'owner') return true;
    return role === 'manager' && !!stationId && (member?.stationIds || []).includes(stationId);
  }, [role, member]);

  const setOrgSettings = useCallback(async (patch: Partial<Pick<Org, 'dashScans' | 'licenceCheckMonths'>>) => {
    if (!org || role !== 'owner') return;
    const full: Record<string, unknown> = { ...patch };
    if ('dashScans' in patch) { full.dashScansBy = user?.name || ''; full.dashScansAt = Date.now(); }
    if (mode === 'firebase') await updateDoc(doc(fb()!.db, 'orgs', org.id), full);
    setOrg((o) => (o && o.id === org.id ? { ...o, ...full } : o));
  }, [org, role, mode, user?.name]);
  const myRecord = useMemo(() => (staff ? records.find((r) => r.id === user?.uid) || null : ownRecord), [staff, records, ownRecord, user?.uid]);
  const myVan = useMemo(() => vehicles.find((v) => !v.retired && v.assignedTo?.driverId === user?.uid) || null, [vehicles, user?.uid]);
  const value: Session = {
    status, mode, user, creator: creator && !viewAs, canViewAs: mode === 'local' || creator, viewAs, setViewAs, companies, org, member, role, staff, myStations, stations, stationName, runs,
    store, vehicles, walks, checks: checksShown, scans, seesAiStats, details, costs, records, tours, purchases, routines, routineDone, myRecord, setOrgSettings, assignments, videos, myVan, loaded, dataError, tier, setTier,
    signIn, signUp, createOrg, joinWithLink, openDemo, removeDemo: removeDemoFn, switchOrg, resetPassword, signOut, deleteAccount,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
