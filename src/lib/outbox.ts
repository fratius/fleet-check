import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteDoc, doc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { fb } from './firebase';
import { flash } from './flash';
import { t } from './i18n';
import { newId, prepare, putBlob } from './images';
import { dropKept, keepFile, keptBlob, keptSize, sweepKept } from './keep';
import { nap, netKind } from './net';
import { Outbox, type Change, type Job, type Live, type OutFile, type Then } from './outboxcore';
import { AiError, ai, callServer, newRid, setWriter } from './store';
import type { Photo, Vehicle } from './types';
import type { Recorded } from './videos';
import type { LocalShot } from './walks';

export type { Change, Job, Then } from './outboxcore';

/**
 * The outbox (see outboxcore.ts) with the phone's storage and Firebase: walk-around photos and videos are kept on
 * the phone as soon as the person taps the button, then uploaded, the walk-around record written and the pick-up,
 * drop-off or handover sent to the server, each tried again by itself until it goes through.
 */

const KEY = 'fc.outbox.v1';
const missing = () => Object.assign(new Error('missing'), { code: 'outbox/missing' });

export const outbox = new Outbox({
  async upload(j, f, again, onBytes, onStall) {
    const blob = await keptBlob(f.key);
    if (!blob) throw missing();
    await putBlob(blob, f.path, f.mime, { again, onBytes: (sent) => onBytes(sent), onStall });
  },
  async saveWalk(j, again, onStall) {
    const f = fb();
    if (!f || !j.walk) throw new Error('Firebase is not configured');
    const r = doc(f.db, 'orgs', j.orgId, 'walkarounds', j.id);
    // Written by an earlier try? Only the server knows (this phone's cache may hold a write that never got there).
    if (again && (await getDocFromServer(r)).exists()) return;
    // Without a connection the write waits in Firestore and goes through when it's back.
    const slow = setTimeout(() => onStall(true), 10_000);
    try { await setDoc(r, JSON.parse(JSON.stringify(j.walk))); } finally { clearTimeout(slow); onStall(false); }
  },
  async server(j, onStall) {
    if (j.change) return sendChange(j, onStall);
    const th = j.then!;
    // Once per request id (functions/src/once.ts); kept with the job, so a repeat after a restart counts as the same.
    if (!j.rid) j.rid = newRid();
    const media = j.type === 'walk' ? { walkId: j.id } : { videoId: j.id };
    const base = { orgId: j.orgId, rid: j.rid };
    if (th.fn === 'pickUpVan') return callServer('pickUpVan', { ...base, vehicleId: j.vehicleId, ...media }, 130000);
    if (th.fn === 'dropOffVan') return callServer('dropOffVan', { ...base, vehicleId: j.vehicleId, ...media }, 130000);
    if (th.fn === 'addHandoverPhotos') return callServer('addHandoverPhotos', { ...base, assignmentId: th.assignmentId, kind: th.kind, walkId: j.id }, 70000);
    if (th.fn === 'addHandoverVideo') return callServer('addHandoverVideo', { ...base, assignmentId: th.assignmentId, kind: th.kind, videoId: j.id }, 130000);
    return callServer('addVanVideo', { ...base, vehicleId: j.vehicleId, videoId: j.id }, 130000);
  },
  after(j) {
    if (j.type === 'change') return;
    // The playback copy is made in the background; nobody waits for it.
    if (j.type === 'video') ai.processVideo({ orgId: j.orgId, videoId: j.id }).catch(() => {});
    flash(`van:${j.vehicleId}`, doneText(j));
  },
  async persist(jobs) {
    let list = jobs;
    if (Platform.OS === 'web') {
      // Other tabs of the web app share the list: keep the jobs they added (a tab only drops its own finished ones).
      try {
        const stored = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]') as Job[];
        const have = new Set(jobs.map((j) => j.id));
        list = [...jobs, ...stored.filter((j) => j && j.id && !have.has(j.id) && !outbox.forgotten.has(j.id))];
      } catch { /* this tab's list as it is */ }
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  },
  async dropFiles(j) { await dropKept(j.id, j.files.map((f) => f.key)); },
  errKind: netKind,
  message(e) {
    const code = (e as { code?: string })?.code;
    if (e instanceof AiError) return e.message;
    if (code === 'outbox/missing') return t('The photos or the video aren\'t on this phone any more.');
    if ((code === 'permission-denied' || code === 'firestore/permission-denied') && !(e instanceof AiError)) return t('This change was refused. Check that you still belong to this company and may change it.');
    if (code === 'not-found' || code === 'firestore/not-found') return t('What this change was for isn\'t there any more.');
    if (code === 'storage/unauthorized') return t('The upload was refused. Check that you still belong to this company, then try again.');
    if (code === 'storage/quota-exceeded') return t('The company\'s storage is full. Tell your fleet manager.');
    return t('Something went wrong. Try again.');
  },
  nap,
});

let loading: Promise<void> | null = null;
/** Reads the list saved on the phone (once). */
function ready() {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY).then(async (raw) => {
      const list = JSON.parse(raw || '[]');
      if (Array.isArray(list)) outbox.load(list as Job[]);
      await sweepKept(new Set(outbox.jobs.map((j) => j.id)));
    }).catch(() => {});
  }
  return loading;
}
/*
 * The web app can be open in several tabs. One of them runs the jobs (a browser lock, released when that tab
 * closes); the others add jobs and show the list as it's saved.
 */
let uidNow: string | null = null;
let runner = Platform.OS !== 'web';
const readStored = async () => { try { const l = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); return Array.isArray(l) ? (l as Job[]) : []; } catch { return []; } };
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } }).locks : undefined;
  if (locks?.request) {
    locks.request('fratius-outbox', async () => {
      runner = true;
      await ready();
      outbox.replace(await readStored());
      outbox.start(uidNow);
      await new Promise<void>(() => {}); // held while this tab is open
    }).catch(() => { runner = true; outbox.start(uidNow); });
  } else runner = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.endsWith(KEY)) return;
    readStored().then((list) => { if (runner) { outbox.load(list); outbox.kick(); } else outbox.replace(list); });
  });
}

/** Starts the uploads of the person signed in (null: none run). Called by the session. */
export async function startOutbox(uid: string | null) {
  uidNow = uid;
  await ready();
  outbox.start(runner ? uid : null);
}

/** What a screen shows: a copy made at each change (the React Compiler keeps results while an object stays the same). */
export interface OutboxView { version: number; jobs: Job[]; live: Map<string, Live>; done: Set<string> }
let view: OutboxView | null = null;
function snapshot(): OutboxView {
  if (!view || view.version !== outbox.version) {
    view = {
      version: outbox.version,
      jobs: outbox.jobs.map((j) => ({ ...j, files: j.files.map((f) => ({ ...f })) })),
      live: new Map([...outbox.live].map(([k, l]) => [k, { ...l }])),
      done: new Set(outbox.done),
    };
  }
  return view;
}
const subscribe = (cb: () => void) => outbox.subscribe(cb);
/** The outbox as it is now, re-rendering when it changes. Changes go through `outbox` (retry, remove). */
export function useOutbox(): OutboxView {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** What it is, for lists: "Pick-up photos of eSprinter 02". */
export function jobTitle(j: Job) {
  if (j.type === 'change') return j.title || t('A change');
  const van = j.vehicleName;
  if (j.type === 'walk') return j.what === 'pickup' ? t('Pick-up photos of {van}', { van }) : j.what === 'dropoff' ? t('Drop-off photos of {van}', { van }) : t('Walk-around of {van}', { van });
  return j.what === 'pickup' ? t('Pick-up video of {van}', { van }) : j.what === 'dropoff' ? t('Drop-off video of {van}', { van }) : t('Video of {van}', { van });
}

/** The message on the van's page once it went through. */
export function doneText(j: Job) {
  const van = j.vehicleName;
  const fn = j.then?.fn;
  if (j.type === 'walk') {
    if (fn === 'pickUpVan') return t('You picked up {van}. The photos are kept with its history.', { van });
    if (fn === 'dropOffVan') return t('You dropped off {van}. The photos are kept with its history.', { van });
    if (fn === 'addHandoverPhotos') return j.what === 'pickup' ? t('The pick-up photos of {van} are saved with its history.', { van }) : t('The drop-off photos of {van} are saved with its history.', { van });
    return t('The walk-around of {van} is uploaded.', { van });
  }
  if (fn === 'pickUpVan') return t('You picked up {van}. The video is kept with its history.', { van });
  if (fn === 'dropOffVan') return t('You dropped off {van}. The video is kept with its history.', { van });
  if (fn === 'addHandoverVideo') return j.what === 'pickup' ? t('The pick-up video of {van} is saved with its history.', { van }) : t('The video was added.');
  return t('The video of {van} is saved with the van.', { van });
}

/** The photos or video waiting for this van's pick-up or drop-off (or for a handover, with `assignmentId`). */
export function pendingHandover(jobs: Job[], uid: string | null | undefined, vehicleId: string, what: Job['what'], assignmentId?: string | null) {
  return jobs.find((j) => j.uid === uid && j.vehicleId === vehicleId && j.what === what && (j.assignmentId || null) === (assignmentId || null)) || null;
}

const thenFor = (what: 'pickup' | 'dropoff' | 'walkaround', assignmentId: string | null, video: boolean): Then | null => {
  if (what === 'walkaround') return video ? { fn: 'addVanVideo' } : null;
  if (assignmentId) return { fn: video ? 'addHandoverVideo' : 'addHandoverPhotos', assignmentId, kind: what };
  return { fn: what === 'pickup' ? 'pickUpVan' : 'dropOffVan' };
};

/**
 * Keeps a walk-around's photos on the phone (made smaller first, as they'll be uploaded) and puts it in the outbox,
 * with its pick-up, drop-off or handover. Returns the walk-around's id; the outbox does the rest.
 */
export async function queueWalk(o: {
  orgId: string; uid: string; v: Vehicle; shots: LocalShot[]; what: 'pickup' | 'dropoff' | 'walkaround'; assignmentId?: string | null;
  meta: { source: 'camera' | 'library'; frames: number; skipped: number; retakes: number; totalMs: number | null };
}, onPrep?: (done: number, total: number) => void): Promise<string> {
  await ready();
  const id = newId();
  const files: OutFile[] = [];
  const photos: Photo[] = [];
  try {
    for (let i = 0; i < o.shots.length; i++) {
      const s = o.shots[i];
      const p = await prepare(s.uri, s.w, s.h);
      const name = `${String(s.n).padStart(2, '0')}.jpg`;
      const key = await keepFile(id, name, { uri: p.uri, move: true });
      const path = `orgs/${o.orgId}/walkarounds/${id}/${name}`;
      files.push({ key, path, mime: 'image/jpeg', size: await keptSize(key) });
      photos.push({ n: s.n, label: s.label, w: p.w, h: p.h, takenAt: s.takenAt, path });
      onPrep?.(i + 1, o.shots.length);
    }
  } catch (e) {
    await dropKept(id, files.map((f) => f.key)).catch(() => {});
    throw e;
  }
  const v = o.v, now = Date.now();
  await outbox.add({
    id, type: 'walk', what: o.what, orgId: o.orgId, uid: o.uid, vehicleId: v.id, vehicleName: v.name, assignmentId: o.assignmentId || null,
    then: thenFor(o.what, o.assignmentId || null, false), createdAt: now, files, status: 'queued', rid: newRid(),
    walk: {
      vehicleId: v.id, vehicleName: v.name, cls: v.cls, stationId: v.stationId, source: o.meta.source, createdAt: now, createdBy: o.uid,
      totalMs: o.meta.totalMs, frames: o.meta.frames, taken: o.shots.length, skipped: o.meta.skipped, retakes: o.meta.retakes, photos,
    },
  });
  return id;
}

/** Keeps a recorded video on the phone and puts it in the outbox with what it's for. Returns the video's id. */
export async function queueVideo(o: { orgId: string; uid: string; v: Vehicle; rec: Recorded; what: 'pickup' | 'dropoff' | 'walkaround'; assignmentId?: string | null }): Promise<string> {
  await ready();
  const id = newId();
  const name = `original.${o.rec.ext}`;
  // The phone app's recording is a temporary file: moved. The web app's is a file object.
  const key = await keepFile(id, name, o.rec.file ? { blob: o.rec.file } : { uri: o.rec.uri, move: Platform.OS !== 'web' });
  await outbox.add({
    id, type: 'video', what: o.what, orgId: o.orgId, uid: o.uid, vehicleId: o.v.id, vehicleName: o.v.name, assignmentId: o.assignmentId || null,
    then: thenFor(o.what, o.assignmentId || null, true), createdAt: Date.now(), status: 'queued', rid: newRid(),
    files: [{ key, path: `orgs/${o.orgId}/videos/${o.uid}/${id}/${name}`, mime: o.rec.mime, size: o.rec.size ?? (await keptSize(key)) }],
  });
  return id;
}

/* ---------- Changes: calls and record writes that wait on the phone ---------- */

/** Record writes started in this session (Firestore shows them at once and sends them when it can). */
const writing = new Map<string, Promise<void>>();
function startWrite(id: string, c: Extract<Change, { kind: 'write' }>) {
  const f = fb();
  if (!f) return Promise.reject(new Error('Firebase is not configured'));
  const [col, ...rest] = c.path;
  const ref = doc(f.db, col, ...rest);
  const data = c.data ? JSON.parse(JSON.stringify(c.data)) : {};
  const p = c.op === 'delete' ? deleteDoc(ref) : c.op === 'update' ? updateDoc(ref, data) : setDoc(ref, data, c.merge ? { merge: true } : {});
  writing.set(id, p);
  p.catch(() => {}).finally(() => writing.delete(id));
  return p;
}
/** The outbox's step for a change. */
async function sendChange(j: Job, onStall: (stalled: boolean) => void): Promise<unknown> {
  const c = j.change!;
  if (c.kind === 'call') return callServer(c.fn, c.data, 180000);
  // Started already in this session: wait for it (without a connection Firestore sends it when it's back).
  const slow = setTimeout(() => onStall(true), 5000);
  try { await (writing.get(j.id) || startWrite(j.id, c)); } finally { clearTimeout(slow); onStall(false); }
  return null;
}

/** Sent with `send()` and still waiting (no connection, or something before it is still on its way). */
export const QUEUED = Symbol('queued');
/**
 * How long a screen waits for a change to go through before carrying on without it. A record write shows at once
 * anyway, so only a refusal is waited for; a call's answer is waited for longer.
 */
const FAST_MS = { call: 8000, write: 1500 };

/**
 * Sends a change through the outbox: kept on the phone at once, sent as soon as it can, and again by itself without
 * a connection (the server does it once, by its request id). Online it's done before this returns, with the
 * server's answer (or its refusal, thrown, as before). Without a connection it returns QUEUED: the change waits on
 * the phone and goes through by itself, also after the app was closed; the strip and the van or person page show it.
 * A record write shows on the screen at once either way.
 */
export async function send<O = unknown>(o: {
  title: string; change: Change; orgId?: string; vehicleId?: string | null; vehicleName?: string | null; personId?: string | null;
  /** Photos uploaded first (kept on the phone until they're up), for example a check's photo. */
  files?: { uri: string; path: string; mime: string }[];
}): Promise<O | typeof QUEUED> {
  await ready();
  const uid = fb()?.auth.currentUser?.uid || uidNow;
  if (!uid) throw new Error('Not signed in');
  const id = newId();
  const files: OutFile[] = [];
  for (const [i, f] of (o.files || []).entries()) {
    const key = await keepFile(id, `${i + 1}.${f.path.split('.').pop() || 'jpg'}`, { uri: f.uri, move: Platform.OS !== 'web' });
    files.push({ key, path: f.path, mime: f.mime, size: await keptSize(key) });
  }
  const change: Change = o.change.kind === 'call' ? { ...o.change, data: { ...o.change.data, rid: (o.change.data.rid as string) || newRid() } } : o.change;
  const orgId = o.orgId || (change.kind === 'call' ? String(change.data.orgId || '') : change.path[0] === 'orgs' ? change.path[1] : '');
  const job: Job = {
    id, type: 'change', what: 'change', orgId, uid, vehicleId: o.vehicleId || '', vehicleName: o.vehicleName || '', assignmentId: null,
    then: null, createdAt: Date.now(), files, status: 'queued', change, title: o.title, personId: o.personId || null,
  };
  // A write shows on the screen straight away (Firestore keeps it until it's sent).
  if (change.kind === 'write') startWrite(id, change).catch(() => {});
  await outbox.add(job);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let off = () => {};
    const check = () => {
      if (outbox.done.has(id)) { off(); resolve(outbox.results.get(id) as O); return; }
      const j = outbox.jobs.find((x) => x.id === id);
      if (!j) { off(); resolve(QUEUED); return; }
      if (j.status === 'failed') {
        // Refused while the person waits: shown on the screen as before, not kept as a stopped upload.
        off();
        const err = j.error || t('Something went wrong. Try again.');
        outbox.remove(id).catch(() => {});
        reject(new AiError('refused', err));
        return;
      }
      // No connection (this one or one before it), or slow: carry on, it goes through by itself.
      const waiting = outbox.jobs.some((x) => x.uid === uid && outbox.live.get(x.id)?.waiting);
      if (waiting || Date.now() - t0 > FAST_MS[change.kind]) { off(); resolve(QUEUED); }
    };
    off = outbox.subscribe(check);
    const timer = setInterval(check, 500);
    const stop = off;
    off = () => { stop(); clearInterval(timer); };
    check();
  });
}

/** A server call as a change (see send). */
export function sendCall<O = unknown>(fn: string, data: Record<string, unknown>, about: {
  title: string; vehicleId?: string | null; vehicleName?: string | null; personId?: string | null; files?: { uri: string; path: string; mime: string }[];
}) {
  return send<O>({ ...about, change: { kind: 'call', fn, data } });
}
/** A record write as a change (see send). `path`: ['orgs', orgId, collection, id]. */
export function sendWrite(op: 'set' | 'update' | 'delete', path: string[], data: Record<string, unknown> | null, about: { title: string; vehicleId?: string | null; vehicleName?: string | null; personId?: string | null; merge?: boolean }) {
  return send({ ...about, change: { kind: 'write', op, path, data, merge: about.merge } });
}

// Record writes from the store (lib/store.ts) go through here.
setWriter((op, path, data, about) => sendWrite(op, path, data, about));

/** A change still on its way that matches (for example this check on this van), so the screen shows it instead of the buttons. */
export function pendingChange(jobs: Job[], uid: string | null | undefined, match: (c: Change) => boolean) {
  return jobs.find((j) => j.uid === uid && j.type === 'change' && j.change && match(j.change)) || null;
}
