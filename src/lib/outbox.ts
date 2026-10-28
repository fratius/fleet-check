import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { fb } from './firebase';
import { flash } from './flash';
import { t } from './i18n';
import { newId, prepare, putBlob } from './images';
import { dropKept, keepFile, keptBlob, keptSize, sweepKept } from './keep';
import { nap, netKind } from './net';
import { Outbox, type Job, type Live, type OutFile, type Then } from './outboxcore';
import { AiError, ai } from './store';
import type { Photo, Vehicle } from './types';
import type { Recorded } from './videos';
import type { LocalShot } from './walks';

export type { Job, Then } from './outboxcore';

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
  async server(j) {
    const th = j.then!;
    const media = j.type === 'walk' ? { walkId: j.id } : { videoId: j.id };
    if (th.fn === 'pickUpVan') await ai.pickUpVan({ orgId: j.orgId, vehicleId: j.vehicleId, ...media });
    else if (th.fn === 'dropOffVan') await ai.dropOffVan({ orgId: j.orgId, vehicleId: j.vehicleId, ...media });
    else if (th.fn === 'addHandoverPhotos') await ai.addHandoverPhotos({ orgId: j.orgId, assignmentId: th.assignmentId, kind: th.kind, walkId: j.id });
    else if (th.fn === 'addHandoverVideo') await ai.addHandoverVideo({ orgId: j.orgId, assignmentId: th.assignmentId, kind: th.kind, videoId: j.id });
    else await ai.addVanVideo({ orgId: j.orgId, vehicleId: j.vehicleId, videoId: j.id });
  },
  after(j) {
    // The playback copy is made in the background; nobody waits for it.
    if (j.type === 'video') ai.processVideo({ orgId: j.orgId, videoId: j.id }).catch(() => {});
    flash(`van:${j.vehicleId}`, doneText(j));
  },
  async persist(jobs) { await AsyncStorage.setItem(KEY, JSON.stringify(jobs)); },
  async dropFiles(j) { await dropKept(j.id, j.files.map((f) => f.key)); },
  errKind: netKind,
  message(e) {
    const code = (e as { code?: string })?.code;
    if (e instanceof AiError) return e.message;
    if (code === 'outbox/missing') return t('The photos or the video aren\'t on this phone any more.');
    if (code === 'storage/unauthorized' || code === 'permission-denied' || code === 'firestore/permission-denied') return t('The upload was refused. Check that you still belong to this company, then try again.');
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
/** Starts the uploads of the person signed in (null: none run). Called by the session. */
export async function startOutbox(uid: string | null) {
  await ready();
  outbox.start(uid);
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

const thenFor = (what: Job['what'], assignmentId: string | null, video: boolean): Then | null => {
  if (what === 'walkaround') return video ? { fn: 'addVanVideo' } : null;
  if (assignmentId) return { fn: video ? 'addHandoverVideo' : 'addHandoverPhotos', assignmentId, kind: what };
  return { fn: what === 'pickup' ? 'pickUpVan' : 'dropOffVan' };
};

/**
 * Keeps a walk-around's photos on the phone (made smaller first, as they'll be uploaded) and puts it in the outbox,
 * with its pick-up, drop-off or handover. Returns the walk-around's id; the outbox does the rest.
 */
export async function queueWalk(o: {
  orgId: string; uid: string; v: Vehicle; shots: LocalShot[]; what: Job['what']; assignmentId?: string | null;
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
    then: thenFor(o.what, o.assignmentId || null, false), createdAt: now, files, status: 'queued',
    walk: {
      vehicleId: v.id, vehicleName: v.name, cls: v.cls, stationId: v.stationId, source: o.meta.source, createdAt: now, createdBy: o.uid,
      totalMs: o.meta.totalMs, frames: o.meta.frames, taken: o.shots.length, skipped: o.meta.skipped, retakes: o.meta.retakes, photos,
    },
  });
  return id;
}

/** Keeps a recorded video on the phone and puts it in the outbox with what it's for. Returns the video's id. */
export async function queueVideo(o: { orgId: string; uid: string; v: Vehicle; rec: Recorded; what: Job['what']; assignmentId?: string | null }): Promise<string> {
  await ready();
  const id = newId();
  const name = `original.${o.rec.ext}`;
  // The phone app's recording is a temporary file: moved. The web app's is a file object.
  const key = await keepFile(id, name, o.rec.file ? { blob: o.rec.file } : { uri: o.rec.uri, move: Platform.OS !== 'web' });
  await outbox.add({
    id, type: 'video', what: o.what, orgId: o.orgId, uid: o.uid, vehicleId: o.v.id, vehicleName: o.v.name, assignmentId: o.assignmentId || null,
    then: thenFor(o.what, o.assignmentId || null, true), createdAt: Date.now(), status: 'queued',
    files: [{ key, path: `orgs/${o.orgId}/videos/${o.uid}/${id}/${name}`, mime: o.rec.mime, size: o.rec.size ?? (await keptSize(key)) }],
  });
  return id;
}
