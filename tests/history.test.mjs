// Van assignments and their permanent history, end to end: real sign-in, Firestore rules, Cloud Functions and
// Storage on the Firebase emulators. These are the rules that must not change (ROLES.md, "Vans, drivers and
// history"): a van has one driver at a time and a driver one van; history is written by the server only and
// never edited or deleted; drivers pick up and drop off vans themselves only where the station allows it, and
// only with a full set of photos.
//
// Run: npx firebase-tools emulators:exec --only auth,firestore,functions,storage --project demo-fleet-check "npm --prefix tests run history"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { deleteApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage';

const HOST = '127.0.0.1';
const cfg = { apiKey: 'demo-key', appId: '1:1:web:1', projectId: 'demo-fleet-check', storageBucket: 'demo-fleet-check.appspot.com' };
let apps = 0;
const run = Date.now().toString(36);

async function person(name, email, password = 'secret-123') {
  const app = initializeApp(cfg, `p${++apps}`);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, HOST, 8080);
  const fns = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fns, HOST, 5001);
  const st = getStorage(app); connectStorageEmulator(st, HOST, 9199);
  if (name) {
    const c = await createUserWithEmailAndPassword(auth, email || `${name.split(' ')[0].toLowerCase()}.${run}@test.dev`, password);
    await updateProfile(c.user, { displayName: name });
  } else {
    await signInWithEmailAndPassword(auth, email, password);
  }
  const call = async (fn, data) => (await httpsCallable(fns, fn, { timeout: 120_000 })(data)).data;
  return { app, auth, db, st, uid: auth.currentUser.uid, name, call };
}
async function fails(p, code) {
  try { await p; } catch (e) {
    const got = String(e.code || '').replace(/^functions\//, '');
    if (code) assert.equal(got, code, `expected ${code}, got ${got}: ${e.message}`);
    return e;
  }
  assert.fail(`expected it to fail${code ? ' with ' + code : ''}`);
}

/** A new account with the app creator claim, as the Deploy workflow sets it. */
async function appCreator(name) {
  const p = await person(name);
  const r = await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/projects/${cfg.projectId}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: p.uid, customAttributes: JSON.stringify({ creator: true }) }),
  });
  assert.equal(r.status, 200, await r.text());
  await p.auth.currentUser.getIdToken(true);
  return p;
}

/** A real JPEG (the AI steps open the photos), made with ffmpeg. */
let jpegBytes = null;
function jpeg() {
  if (!jpegBytes) {
    const out = join(mkdtempSync(join(tmpdir(), 'jpg-')), 'p.jpg');
    execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x480', '-frames:v', '1', '-y', out]);
    jpegBytes = new Uint8Array(readFileSync(out));
  }
  return jpegBytes;
}

/** A walk-around with every photo uploaded, as the app's scanner saves it. */
async function photos(p, orgId, van, { frames = 3, source = 'camera', skipped = 0, real = false } = {}) {
  const id = doc(collection(p.db, 'orgs', orgId, 'walkarounds')).id;
  const ps = [];
  for (let n = 1; n <= frames; n++) {
    const path = `orgs/${orgId}/walkarounds/${id}/0${n}.jpg`;
    await uploadBytes(ref(p.st, path), real ? jpeg() : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
    ps.push({ n, label: `Frame ${n}`, w: 900, h: 1200, takenAt: Date.now(), path });
  }
  await setDoc(doc(p.db, 'orgs', orgId, 'walkarounds', id), {
    vehicleId: van.id, vehicleName: van.name, cls: 'van', stationId: van.stationId, source, createdAt: Date.now(), createdBy: p.uid,
    totalMs: null, frames, taken: frames - skipped, skipped, retakes: 0, photos: ps.slice(0, frames - skipped),
  });
  return id;
}

// Close every connection at the end, or the test process stays open and the runner reports the file as failed.
after(async () => {
  await Promise.allSettled(getApps().map((a) => deleteApp(a)));
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
});

const S = {};

// Test videos, made with the same ffmpeg the functions use.
const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const FFMPEG = fnRequire('ffmpeg-static');
function clip({ seconds = 10, recordedHoursAgo = 0 } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'clip-')), 'c.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=15:duration=${seconds}`,
    '-metadata', `creation_time=${new Date(Date.now() - recordedHoursAgo * 3600_000).toISOString()}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', out]);
  return new Uint8Array(readFileSync(out));
}
/** Records and uploads a video the way the app does: the original, in the uploader's own folder. */
async function video(p, opts = {}) {
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await uploadBytes(ref(p.st, `orgs/${S.org}/videos/${p.uid}/${id}/original.mp4`), clip(opts), { contentType: 'video/mp4' });
  return id;
}
const vanDoc = async (p, id) => (await getDoc(doc(p.db, 'orgs', S.org, 'vehicles', id))).data();
const history = async (p, filters) => (await getDocs(query(collection(p.db, 'orgs', S.org, 'assignments'), ...filters))).docs.map((d) => ({ id: d.id, ...d.data() }));

test('set up a company: owner, two stations, a manager, three drivers, three vans', async () => {
  S.own = await person('Olga Owner');
  const org = doc(collection(S.own.db, 'orgs'));
  S.org = org.id;
  await setDoc(org, { name: 'Test DSP', createdBy: S.own.uid, createdAt: Date.now(), stationsReady: true });
  await setDoc(doc(S.own.db, 'orgs', S.org, 'members', S.own.uid), { role: 'owner', stationIds: [], email: '', name: 'Olga Owner', joinedAt: Date.now() });
  for (const [k, name] of [['s1', 'DXX1'], ['s2', 'DXX2']]) {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'stations'));
    await setDoc(r, { name, code: name, createdAt: Date.now() });
    S[k] = r.id;
  }
  const join = async (name, role, station) => {
    const { invites } = await S.own.call('createInvite', { orgId: S.org, role, stationId: S[station], count: 1 });
    const p = await person(name);
    const [first, last] = name.split(' ');
    await p.call('acceptInvite', { token: invites[0].token, details: { firstName: first, lastName: last, phone: '+49 151 1', transporterId: role === 'driver' ? 'A1' : '' } });
    return p;
  };
  S.mgr = await join('Max Manager', 'manager', 's1');
  S.d1 = await join('Dana Driver', 'driver', 's1');
  S.d2 = await join('Erik Driver', 'driver', 's1');
  S.d3 = await join('Fay Driver', 'driver', 's2');
  S.vans = {};
  for (const [k, st] of [['v1', 's1'], ['v2', 's1'], ['v3', 's2']]) {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    S.vans[k] = { id: r.id, name: `Van ${k}`, stationId: S[st] };
    await setDoc(r, { name: `Van ${k}`, plate: k.toUpperCase(), cls: 'van', stationId: S[st], createdAt: Date.now(), createdBy: S.own.uid });
  }
});

test('managers assign vans of their station; one van per driver, one driver per van', async () => {
  const { v1, v2, v3 } = S.vans;
  await fails(S.d1.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid }), 'permission-denied');
  await fails(S.mgr.call('assignVan', { orgId: S.org, vehicleId: v3.id, driverId: S.d3.uid }), 'permission-denied');
  await fails(S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d3.uid }), 'failed-precondition');
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid });
  assert.equal((await vanDoc(S.mgr, v1.id)).assignedTo.driverId, S.d1.uid);
  // Erik takes van 1: Dana's assignment ends. Then Dana takes van 2.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d2.uid });
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  // Dana takes van 1 back: van 2 becomes free, Erik has nothing.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid });
  assert.equal((await vanDoc(S.mgr, v2.id)).assignedTo, null);
  const open = await history(S.own, [where('end', '==', null)]);
  assert.deepEqual(open.map((a) => [a.vehicleId, a.driverId]), [[v1.id, S.d1.uid]]);
  const v1h = await history(S.own, [where('vehicleId', '==', v1.id), orderBy('start', 'desc')]);
  assert.deepEqual(v1h.map((a) => a.driverName), ['Dana Driver', 'Erik Driver', 'Dana Driver']);
  assert.deepEqual(v1h.map((a) => a.endReason), [null, 'reassigned', 'reassigned']);
});

test('history is server-only: nobody writes, edits or deletes it from the app, not even the owner', async () => {
  const [a] = await history(S.own, [where('vehicleId', '==', S.vans.v1.id), limit(1)]);
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'assignments', a.id), { driverName: 'Someone else' }), 'permission-denied');
  await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'assignments', a.id)), 'permission-denied');
  await fails(setDoc(doc(S.mgr.db, 'orgs', S.org, 'assignments', 'fake'), { vehicleId: S.vans.v1.id, driverId: S.d1.uid, stationId: S.s1, start: 1, end: 2 }), 'permission-denied');
  await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicles', S.vans.v1.id), { assignedTo: null }), 'permission-denied');
  await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'vehicles', S.vans.v1.id)), 'permission-denied');
});

test('who reads history: owners everything, managers their station, drivers only their own', async () => {
  // The app's own queries.
  const mgrSession = await history(S.mgr, [where('stationId', 'in', [S.s1]), orderBy('createdAt', 'desc'), limit(500)]);
  assert.ok(mgrSession.length >= 4);
  const mgrVan = await history(S.mgr, [where('vehicleId', '==', S.vans.v1.id), where('stationId', 'in', [S.s1]), orderBy('start', 'desc'), limit(300)]);
  assert.equal(mgrVan.length, 3);
  await fails(history(S.mgr, [where('vehicleId', '==', S.vans.v3.id)]), 'permission-denied');
  const mine = await history(S.d1, [where('driverId', '==', S.d1.uid), orderBy('createdAt', 'desc'), limit(500)]);
  assert.ok(mine.length >= 2 && mine.every((a) => a.driverId === S.d1.uid));
  await fails(history(S.d1, [where('vehicleId', '==', S.vans.v1.id)]), 'permission-denied');
  await fails(history(S.d1, [where('driverId', '==', S.d2.uid)]), 'permission-denied');
  await fails(history(S.d3, [where('stationId', 'in', [S.s1])]), 'permission-denied');
});

test('drivers pick up and drop off vans only where the station allows it, and only with every photo', async () => {
  const { v1, v2 } = S.vans;
  // Off by default.
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d2, S.org, v2) }), 'failed-precondition');
  await fails(S.d2.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true }), 'permission-denied');
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'stations', S.s1), { selfAssign: true }), 'permission-denied');
  await fails(S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s2, on: true }), 'permission-denied');
  await S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true });
  // Photos are required: all of them, from the camera, by this driver, of this van.
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id }), 'invalid-argument');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d2, S.org, v2, { skipped: 1 }) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d2, S.org, v2, { source: 'library' }) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d1, S.org, v2) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d2, S.org, v1) }), 'failed-precondition');
  // Nobody marks their own photos as a pick-up, or edits them afterwards.
  const forged = doc(collection(S.d2.db, 'orgs', S.org, 'walkarounds'));
  await fails(setDoc(forged, { vehicleId: v2.id, stationId: S.s1, createdBy: S.d2.uid, createdAt: Date.now(), handover: { kind: 'pickup', assignmentId: 'x' } }), 'permission-denied');
  const pick = await photos(S.d2, S.org, v2);
  const r = await S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, walkId: pick });
  assert.equal((await vanDoc(S.d2, v2.id)).assignedTo.driverId, S.d2.uid);
  const w = (await getDoc(doc(S.d2.db, 'orgs', S.org, 'walkarounds', pick))).data();
  assert.deepEqual(w.handover, { kind: 'pickup', assignmentId: r.assignmentId });
  await fails(updateDoc(doc(S.d2.db, 'orgs', S.org, 'walkarounds', pick), { handover: null }), 'permission-denied');
  // The same photos can't be used twice; a driver with a van drops it off before taking another.
  await fails(S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: pick }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v1.id, walkId: await photos(S.d2, S.org, v1) }), 'failed-precondition');
  await fails(S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d1, S.org, v2) }), 'failed-precondition');
  const drop = await photos(S.d2, S.org, v2);
  await S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: drop });
  assert.equal((await vanDoc(S.d2, v2.id)).assignedTo, null);
  const [a] = await history(S.d2, [where('driverId', '==', S.d2.uid), orderBy('start', 'desc'), limit(1)]);
  assert.equal(a.startedBy, S.d2.uid);
  assert.equal(a.startWalkId, pick);
  assert.equal(a.endWalkId, drop);
  assert.equal(a.endReason, 'dropped off');
  // Taking over a van someone didn't drop off: their assignment ends with the new driver's photos.
  const take = await photos(S.d2, S.org, v1);
  const t = await S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v1.id, walkId: take });
  assert.equal(t.tookOverFrom, 'Dana Driver');
  const [dana] = await history(S.d1, [where('driverId', '==', S.d1.uid), where('vehicleId', '==', v1.id), orderBy('start', 'desc'), limit(1)]);
  assert.equal(dana.endReason, 'taken over');
  assert.equal(dana.endWalkId, take);
  // Switched off again: no more pick-ups or drop-offs by drivers.
  await S.own.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: false });
  await fails(S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v1.id, walkId: await photos(S.d2, S.org, v1) }), 'failed-precondition');
});

test('pick-up and drop-off with a video instead of photos; a manager adds a missing video later', async () => {
  const { v1, v2 } = S.vans;
  await S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true });
  // People upload only into their own video folder, and only videos.
  await fails(uploadBytes(ref(S.d1.st, `orgs/${S.org}/videos/${S.d2.uid}/x1/original.mp4`), clip(), { contentType: 'video/mp4' }));
  await fails(uploadBytes(ref(S.d1.st, `orgs/${S.org}/videos/${S.d1.uid}/x2/original.mp4`), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' }));
  // Too short, recorded hours ago, or someone else's: refused.
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, videoId: await video(S.d1, { seconds: 3 }) }), 'failed-precondition');
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, videoId: await video(S.d1, { recordedHoursAgo: 5 }) }), 'failed-precondition');
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, videoId: await video(S.d2) }), 'failed-precondition');
  // Picked up with a video.
  const pv = await video(S.d1);
  const r = await S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, videoId: pv });
  const a = (await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', r.assignmentId))).data();
  assert.equal(a.startVideoId, pv);
  assert.equal(a.startWalkId, null);
  const vd = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'videos', pv))).data();
  assert.equal(vd.kind, 'pickup');
  assert.equal(vd.assignmentId, r.assignmentId);
  assert.equal(vd.by, S.d1.uid);
  assert.ok(vd.durationMs >= 9000);
  // Other drivers don't see it; nobody writes video records from the app.
  await fails(getDoc(doc(S.d2.db, 'orgs', S.org, 'videos', pv)), 'permission-denied');
  await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', pv), { kind: 'dropoff' }), 'permission-denied');
  // The same video can't be used twice; dropped off with a new one.
  await fails(S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, videoId: pv }), 'failed-precondition');
  const dv = await video(S.d1);
  await S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, videoId: dv });
  const a2 = (await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', r.assignmentId))).data();
  assert.equal(a2.endVideoId, dv);
  assert.equal(a2.endReason, 'dropped off');
  assert.equal((await vanDoc(S.mgr, v2.id)).assignedTo, null);
  // The playback copy and poster.
  await S.d1.call('processVideo', { orgId: S.org, videoId: dv });
  const done = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', dv))).data();
  assert.equal(done.status, 'ready');
  assert.ok(done.playPath.endsWith('play.mp4') && done.posterPath.endsWith('poster.jpg'));
  // Erik's van 1 is made free by the manager: no drop-off video. The manager adds one afterwards; the handover
  // itself doesn't change, the video points to it.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: null });
  const [ended] = await history(S.own, [where('driverId', '==', S.d2.uid), where('vehicleId', '==', v1.id), orderBy('start', 'desc'), limit(1)]);
  assert.equal(ended.endReason, 'ended');
  await fails(S.d1.call('addHandoverVideo', { orgId: S.org, assignmentId: ended.id, kind: 'dropoff', videoId: await video(S.d1) }), 'permission-denied');
  const late = await video(S.mgr);
  await S.mgr.call('addHandoverVideo', { orgId: S.org, assignmentId: ended.id, kind: 'dropoff', videoId: late });
  const lv = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', late))).data();
  assert.equal(lv.late, true);
  assert.equal(lv.assignmentId, ended.id);
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', ended.id))).data().endVideoId ?? null, null);
  await fails(S.mgr.call('addHandoverVideo', { orgId: S.org, assignmentId: ended.id, kind: 'dropoff', videoId: await video(S.mgr) }), 'failed-precondition');
  // Back as it was for the next test: Erik has van 1, drivers don't pick up themselves.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d2.uid });
  await S.own.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: false });
});

test('walk-around videos: anyone who can scan the van films it, any time; nothing changes hands', async () => {
  const { v1, v3 } = S.vans;
  // Drivers pick up themselves is off at station 1 now: a walk-around video doesn't need it.
  const dv = await video(S.d1);
  await S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: dv });
  const d = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'videos', dv))).data();
  assert.equal(d.kind, 'walkaround');
  assert.equal(d.late, false);
  assert.equal(d.by, S.d1.uid);
  // Erik has van 1: the video notes his handover, which doesn't change.
  const van = await vanDoc(S.mgr, v1.id);
  assert.equal(d.assignmentId, van.assignedTo.assignmentId);
  assert.equal(van.assignedTo.driverId, S.d2.uid);
  // Fleet managers of the station and owners too; the manager sees the driver's video, the other driver doesn't.
  await S.mgr.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: await video(S.mgr) });
  await S.own.call('addVanVideo', { orgId: S.org, vehicleId: v3.id, videoId: await video(S.own) });
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', dv))).data().kind, 'walkaround');
  await fails(getDoc(doc(S.d2.db, 'orgs', S.org, 'videos', dv)), 'permission-denied');
  // Not at another station, not twice, not too short, not someone else's upload.
  await fails(S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v3.id, videoId: await video(S.d1) }), 'permission-denied');
  await fails(S.mgr.call('addVanVideo', { orgId: S.org, vehicleId: v3.id, videoId: await video(S.mgr) }), 'permission-denied');
  await fails(S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: dv }), 'failed-precondition');
  await fails(S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: await video(S.d1, { seconds: 3 }) }), 'failed-precondition');
  await fails(S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: await video(S.d2) }), 'failed-precondition');
  // A walk-around video isn't a drop-off: Erik still has the van.
  assert.equal((await vanDoc(S.mgr, v1.id)).assignedTo.driverId, S.d2.uid);
});

test('the app creator views the app as a driver, a manager and an owner, and gets exactly their access', async () => {
  const { v1, v3 } = S.vans;
  const cr = await appCreator('Cora Creator');
  const viewAs = (v) => setDoc(doc(cr.db, 'users', cr.uid), { viewAs: v }, { merge: true });
  // Themselves: every company and station, photos and videos included, without being a member.
  const walk = await photos(S.d1, S.org, v1);
  const photo = `orgs/${S.org}/walkarounds/${walk}/01.jpg`;
  const dv = await video(S.d1);
  const dvPath = `orgs/${S.org}/videos/${S.d1.uid}/${dv}/original.mp4`;
  assert.ok((await vanDoc(cr, v3.id)).name);
  assert.ok((await getBytes(ref(cr.st, photo))).byteLength > 0);
  assert.ok((await getBytes(ref(cr.st, dvPath))).byteLength > 0);
  // As a driver of station 1: their station only, no managing, only their own videos.
  await viewAs({ org: S.org, role: 'driver', st: S.s1 });
  assert.ok((await vanDoc(cr, v1.id)).name);
  await fails(vanDoc(cr, v3.id), 'permission-denied');
  await fails(cr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid }), 'permission-denied');
  await fails(cr.call('addVanVideo', { orgId: S.org, vehicleId: v3.id, videoId: await video(cr) }), 'permission-denied');
  await cr.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: await video(cr) });
  assert.ok((await getBytes(ref(cr.st, photo))).byteLength > 0);
  await fails(getBytes(ref(cr.st, dvPath)));
  await fails(cr.call('assignVan', { orgId: 'someOtherCompany', vehicleId: v1.id, driverId: null }), 'permission-denied');
  // As a fleet manager of station 1: invites drivers there, nothing at station 2, no station settings there.
  await viewAs({ org: S.org, role: 'manager', st: S.s1 });
  const { invites } = await cr.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
  assert.equal(invites.length, 1);
  await fails(cr.call('createInvite', { orgId: S.org, role: 'manager', stationId: S.s1, count: 1 }), 'permission-denied');
  await fails(cr.call('setSelfAssign', { orgId: S.org, stationId: S.s2, on: false }), 'permission-denied');
  assert.ok((await getBytes(ref(cr.st, dvPath))).byteLength > 0);
  // As an owner: every station of this company.
  await viewAs({ org: S.org, role: 'owner', st: null });
  await cr.call('setSelfAssign', { orgId: S.org, stationId: S.s2, on: false });
  assert.ok((await vanDoc(cr, v3.id)).name);
  // Back to themselves.
  await viewAs(null);
  assert.ok((await vanDoc(cr, v3.id)).name);
  // Nobody else can switch: the rules refuse the field, and a driver stays a driver on the server.
  await fails(setDoc(doc(S.d1.db, 'users', S.d1.uid), { viewAs: { org: S.org, role: 'owner', st: null } }, { merge: true }), 'permission-denied');
  await fails(S.d1.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: false }), 'permission-denied');
});

// Writes past the rules (the emulator's admin access), for what the app can't write itself.
let admin = null;
function adminDb() {
  if (!admin) {
    process.env.FIRESTORE_EMULATOR_HOST ||= `${HOST}:8080`;
    const { initializeApp: init } = fnRequire('firebase-admin/app');
    const { getFirestore: fs } = fnRequire('firebase-admin/firestore');
    admin = fs(init({ projectId: cfg.projectId }, 'admin'));
  }
  return admin;
}

test('a driver given a van gets a phone notification and adds the pick-up photos or video afterwards', async () => {
  const { v2 } = S.vans;
  // The push service, on this computer: it keeps what arrives; /gone answers like a phone that turned them off.
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: Buffer.concat(ch) }); res.statusCode = req.url.endsWith('/gone') ? 410 : 201; res.end(); });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  const port = srv.address().port;
  // Dana's phone: its own key pair, as a browser makes it when notifications are turned on.
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth };
  // The app may only save real push services (the rules check), so this test address is written past the rules.
  const pushCol = adminDb().collection(`users/${S.d1.uid}/push`);
  await pushCol.doc('here').set({ endpoint: `http://${HOST}:${port}/push/here`, keys, createdAt: Date.now(), device: 'test phone' });
  await pushCol.doc('gone').set({ endpoint: `http://${HOST}:${port}/push/gone`, keys, createdAt: Date.now(), device: 'old phone' });
  const r = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  srv.close();
  assert.equal(r.notified, 1);
  const msg = got.find((g) => g.url === '/push/here');
  assert.ok(msg, 'the notification arrived');
  // Signed with the server's key pair and encrypted for this phone only.
  const secret = readFileSync(new URL('../functions/.secret.local', import.meta.url), 'utf8').match(/^WEBPUSH_KEYS='(.+)'$/m);
  const pub = JSON.parse(secret[1]).publicKey;
  assert.ok(msg.headers.authorization.startsWith('vapid t=') && msg.headers.authorization.endsWith(`k=${pub}`), msg.headers.authorization);
  assert.equal(msg.headers['content-encoding'], 'aes128gcm');
  const body = JSON.parse(fnRequire('http_ece').decrypt(msg.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString());
  assert.equal(body.url, `/vehicle/${v2.id}`);
  assert.equal(body.title, 'Van v2 is yours');
  assert.match(body.body, /^Max Manager gave you Van v2 \(V2\)\. Before you drive, take the pick-up video or photos\.$/);
  // The phone that turned notifications off is forgotten.
  assert.equal((await pushCol.doc('gone').get()).exists, false);
  // The handover asks for the pick-up photos or video.
  const a = (await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', r.assignmentId))).data();
  assert.equal(a.pickupRequested, true);
  // The driver adds them (another driver can't); every photo, taken with the camera.
  await fails(S.d2.call('addHandoverPhotos', { orgId: S.org, assignmentId: r.assignmentId, kind: 'pickup', walkId: await photos(S.d2, S.org, v2) }), 'permission-denied');
  await fails(S.d1.call('addHandoverPhotos', { orgId: S.org, assignmentId: r.assignmentId, kind: 'pickup', walkId: await photos(S.d1, S.org, v2, { skipped: 1 }) }), 'failed-precondition');
  const pick = await photos(S.d1, S.org, v2);
  await S.d1.call('addHandoverPhotos', { orgId: S.org, assignmentId: r.assignmentId, kind: 'pickup', walkId: pick });
  const w = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'walkarounds', pick))).data();
  assert.deepEqual(w.handover, { kind: 'pickup', assignmentId: r.assignmentId, late: false });
  // One pick-up proof per handover, and the handover record itself doesn't change.
  await fails(S.d1.call('addHandoverVideo', { orgId: S.org, assignmentId: r.assignmentId, kind: 'pickup', videoId: await video(S.d1) }), 'failed-precondition');
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', r.assignmentId))).data().startWalkId, null);
  // Or a video: the next time Dana is given the van she films it. It counts as her pick-up, not as added late.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: null });
  const r2 = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  const pv = await video(S.d1);
  await S.d1.call('addHandoverVideo', { orgId: S.org, assignmentId: r2.assignmentId, kind: 'pickup', videoId: pv });
  const vd = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'videos', pv))).data();
  assert.equal(vd.assignmentId, r2.assignmentId);
  assert.equal(vd.late, false);
  // Taking a van yourself (a manager) asks for nothing and sends nothing.
  const r3 = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.mgr.uid });
  assert.equal(r3.notified, 0);
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'assignments', r3.assignmentId))).data().pickupRequested, false);
  // Back as it was: van 2 free.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: null });
});

test('AI speed and cost: only the app creator sees them, in the functions\' answers and in the data', async () => {
  const { v1 } = S.vans;
  const cr = await appCreator('Cleo Creator');
  // A driver runs a damage check (the emulator answers for the AI, with made-up usage).
  const walk = await photos(S.d1, S.org, v1, { real: true });
  const f = await S.d1.call('findDamage', { orgId: S.org, walkId: walk, tier: 'default' });
  assert.equal(f.spots.length, 1);
  assert.equal(f.usage, undefined, 'the driver gets no speed or cost back');
  const kref = doc(S.d1.db, 'orgs', S.org, 'checks', f.checkId);
  const k = (await getDoc(kref)).data();
  for (const field of ['pass1', 'pass2', 'serverMs', 'prepMs']) assert.equal(k[field], undefined, `${field} isn't on the check`);
  // The close-up check: no time on the verdict.
  const close = `orgs/${S.org}/checks/${f.checkId}/close1.jpg`;
  await uploadBytes(ref(S.d1.st, close), jpeg(), { contentType: 'image/jpeg' });
  const sp = await S.d1.call('checkSpot', { orgId: S.org, checkId: f.checkId, spot: 0, closeups: [close], tier: 'default' });
  assert.equal(sp.verdict.verdict, 'damage');
  assert.equal(sp.verdict.ms, undefined);
  assert.equal(sp.usage, undefined);
  assert.equal((await getDoc(kref)).data().spots[0].verdict.ms, undefined);
  // Speed and cost are kept apart: the driver, the manager and the owner can't read them; the app creator can.
  const uPath = ['orgs', S.org, 'checkUsage', f.checkId];
  for (const p of [S.d1, S.mgr, S.own]) await fails(getDoc(doc(p.db, ...uPath)), 'permission-denied');
  const u = (await getDoc(doc(cr.db, ...uPath))).data();
  assert.equal(u.pass1.calls, 1);
  assert.ok(u.pass1.cost > 0 && u.pass1.ms >= 0);
  assert.equal(u.pass2.calls, 1);
  assert.equal(u.spotMs[0], 1234);
  assert.ok(u.serverMs >= 0 && u.prepMs >= 0);
  // The app creator running a check gets them back.
  const walk2 = await photos(cr, S.org, v1, { real: true });
  assert.ok((await cr.call('findDamage', { orgId: S.org, walkId: walk2, tier: 'default' })).usage.cost > 0);
  // Type scans carry cost: only the app creator reads them, and the manager's answer has none.
  const scanId = 'scan' + Date.now().toString(36);
  const sp1 = `orgs/${S.org}/scans/${scanId}/1.jpg`;
  await uploadBytes(ref(S.mgr.st, sp1), jpeg(), { contentType: 'image/jpeg' });
  const id = await S.mgr.call('identifyVehicle', { orgId: S.org, scanId, paths: [sp1], tier: 'default', stationId: S.s1 });
  assert.equal(id.scan.predicted, 'large_van');
  assert.equal(id.scan.cost, null);
  assert.equal(id.scan.ms, null);
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'scans', scanId)), 'permission-denied');
  await updateDoc(doc(S.mgr.db, 'orgs', S.org, 'scans', scanId), { verdict: 'correct', actual: 'large_van' });
  assert.ok((await getDoc(doc(cr.db, 'orgs', S.org, 'scans', scanId))).data().cost > 0);
  // Checks saved before this change: the Deploy workflow moves their speed and cost out. Safe to run twice.
  const old = adminDb().collection(`orgs/${S.org}/checks`).doc();
  await old.set({ vehicleId: v1.id, vehicleName: v1.name, stationId: S.s1, createdAt: Date.now(), tier: 'default', model: 'm', status: 'reviewed',
    pass1: { ms: 9000, calls: 1, images: 3, inTok: 1, outTok: 1, cost: 0.2 }, pass2: { ms: 4000, calls: 1, images: 2, inTok: 1, outTok: 1, cost: 0.1 },
    serverMs: 9500, prepMs: 400, spots: [{ panel: 'door', verdict: { verdict: 'damage', ms: 4000, reason: 'x' } }, { panel: 'roof', verdict: null }] });
  const move = () => execFileSync(process.execPath, [new URL('../functions/scripts/move-usage.cjs', import.meta.url).pathname],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || `${HOST}:8080`, PROJECT: cfg.projectId }, encoding: 'utf8' });
  assert.match(move(), /Moved the speed and cost of \d+ damage check/);
  const o = (await old.get()).data();
  for (const field of ['pass1', 'pass2', 'serverMs', 'prepMs']) assert.equal(o[field], undefined);
  assert.equal(o.spots[0].verdict.ms, undefined);
  assert.equal(o.spots[0].verdict.reason, 'x');
  const ou = (await adminDb().doc(`orgs/${S.org}/checkUsage/${old.id}`).get()).data();
  assert.equal(ou.pass1.cost, 0.2);
  assert.equal(ou.pass2.cost, 0.1);
  assert.equal(ou.serverMs, 9500);
  assert.equal(ou.spotMs[0], 4000);
  assert.match(move(), /No damage checks to move/);
});

test('retiring, moving and removing keep the history and free the van', async () => {
  const { v1, v2 } = S.vans;
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  await S.mgr.call('retireVan', { orgId: S.org, vehicleId: v2.id });
  const v2d = await vanDoc(S.mgr, v2.id);
  assert.equal(v2d.retired, true);
  assert.equal(v2d.assignedTo, null);
  await fails(S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid }), 'failed-precondition');
  await S.mgr.call('retireVan', { orgId: S.org, vehicleId: v2.id, restore: true });
  // Removing a person goes through the server and frees their van.
  await fails(deleteDoc(doc(S.mgr.db, 'orgs', S.org, 'members', S.d2.uid)), 'permission-denied');
  await S.mgr.call('removePerson', { orgId: S.org, uid: S.d2.uid });
  assert.equal((await vanDoc(S.mgr, v1.id)).assignedTo, null);
  const erik = await history(S.own, [where('driverId', '==', S.d2.uid), orderBy('start', 'desc')]);
  assert.ok(erik.length >= 3, 'a removed driver keeps their history');
  assert.equal(erik[0].endReason, 'driver removed');
  // Moving a driver to another station ends their van there.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid });
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'members', S.d1.uid), { stationIds: [S.s2] }), 'permission-denied');
  await S.own.call('changePerson', { orgId: S.org, uid: S.d1.uid, stationId: S.s2 });
  assert.equal((await vanDoc(S.own, v1.id)).assignedTo, null);
  const [last] = await history(S.own, [where('driverId', '==', S.d1.uid), orderBy('start', 'desc'), limit(1)]);
  assert.equal(last.endReason, 'driver moved');
  // Moving a van to another station ends its assignment.
  await S.own.call('changePerson', { orgId: S.org, uid: S.d1.uid, stationId: S.s1 });
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v1.id, driverId: S.d1.uid });
  // Its contract and deadlines (owners and managers only) go with it to the new station; its costs are owners' only.
  await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v1.id), { stationId: S.s1, createdAt: Date.now(), ownership: 'leased', kmPerYear: 40000 });
  await fails(setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleCosts', v1.id), { createdAt: Date.now(), monthly: 700 }), 'permission-denied');
  await setDoc(doc(S.own.db, 'orgs', S.org, 'vehicleCosts', v1.id), { createdAt: Date.now(), monthly: 700 });
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleCosts', v1.id)), 'permission-denied');
  await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicleDetails', v1.id)), 'permission-denied');
  await fails(S.mgr.call('moveVan', { orgId: S.org, vehicleId: v1.id, stationId: S.s2 }), 'permission-denied');
  await S.own.call('moveVan', { orgId: S.org, vehicleId: v1.id, stationId: S.s2 });
  const v1d = await vanDoc(S.own, v1.id);
  assert.equal(v1d.stationId, S.s2);
  assert.equal(v1d.assignedTo, null);
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'vehicleDetails', v1.id))).data().stationId, S.s2);
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v1.id)), 'permission-denied');
});

test('driver records: managers keep their station\'s; licence checks only through the server', async () => {
  const rec = (p, uid) => getDoc(doc(p.db, 'orgs', S.org, 'driverRecords', uid));
  await setDoc(doc(S.mgr.db, 'orgs', S.org, 'driverRecords', S.d1.uid), { stationId: S.s1, createdAt: Date.now(), licenceClasses: ['B'], licenceValid: '2031-05-31' });
  await fails(setDoc(doc(S.mgr.db, 'orgs', S.org, 'driverRecords', S.d3.uid), { stationId: S.s2, createdAt: Date.now() }), 'permission-denied');
  await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org, 'driverRecords', S.d1.uid), { checks: [{ day: '2026-01-01', ok: true }] }), 'permission-denied');
  const today = new Date().toISOString().slice(0, 10);
  await S.mgr.call('recordLicenceCheck', { orgId: S.org, uid: S.d1.uid, ok: true, note: '', day: today });
  await fails(S.d1.call('recordLicenceCheck', { orgId: S.org, uid: S.d1.uid, ok: true, note: '', day: today }), 'permission-denied');
  await fails(S.mgr.call('recordLicenceCheck', { orgId: S.org, uid: S.mgr.uid, ok: true, note: '', day: today }), 'failed-precondition');
  await fails(S.mgr.call('recordLicenceCheck', { orgId: S.org, uid: S.d3.uid, ok: true, note: '', day: today }), 'permission-denied');
  await fails(S.mgr.call('recordLicenceCheck', { orgId: S.org, uid: S.d1.uid, ok: false, note: '', day: today }), 'invalid-argument');
  await fails(S.mgr.call('recordLicenceCheck', { orgId: S.org, uid: S.d1.uid, ok: true, note: '', day: '2030-01-01' }), 'invalid-argument');
  const r = (await rec(S.d1, S.d1.uid)).data();
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0].byName, 'Max Manager');
  assert.equal(r.licenceValid, '2031-05-31');
  await fails(rec(S.d1, S.mgr.uid), 'permission-denied');
  // The record goes with the driver to another station (and the old station's manager loses it).
  await S.own.call('changePerson', { orgId: S.org, uid: S.d1.uid, stationId: S.s2 });
  assert.equal((await rec(S.own, S.d1.uid)).data().stationId, S.s2);
  await fails(rec(S.mgr, S.d1.uid), 'permission-denied');
  await S.own.call('changePerson', { orgId: S.org, uid: S.d1.uid, stationId: S.s1 });
  assert.equal((await rec(S.mgr, S.d1.uid)).data().stationId, S.s1);
  // Incidents: the station's manager adds them, the driver reads their own.
  await setDoc(doc(collection(S.mgr.db, 'orgs', S.org, 'incidents')), { driverId: S.d1.uid, driverName: 'Dana Driver', vehicleId: null, vehicleName: null, stationId: S.s1,
    day: today, time: '10:00', kind: 'fine', fineType: 'parking', atFault: null, note: 'Bus stop', by: S.mgr.uid, byName: 'Max Manager', createdAt: Date.now() });
  const mine = await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'incidents'), where('driverId', '==', S.d1.uid), orderBy('createdAt', 'desc')));
  assert.equal(mine.size, 1);
});

test('tours from dashboard photos: start, end, kilometres, fuel, and the van\'s odometer', async () => {
  const { v2 } = S.vans;
  await updateDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicles', v2.id), { fuel: 'diesel', tankL: 80, make: 'Ford', model: 'Transit' });
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  const shot = async (p) => {
    const path = `orgs/${S.org}/dash/${p.uid}/${Date.now().toString(36)}.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const p1 = await shot(S.d1);
  // Off until the owner turns it on.
  await fails(S.d1.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: p1 }), 'failed-precondition');
  await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org), { dashScans: true }), 'permission-denied');
  await updateDoc(doc(S.own.db, 'orgs', S.org), { dashScans: true, dashScansBy: 'Olga Owner', dashScansAt: Date.now() });
  const r1 = await S.d1.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: p1 });
  assert.equal(r1.values.odometerKm, 48213);
  assert.equal(r1.will, 'start');
  assert.equal(r1.usage, undefined, 'drivers don\'t get AI cost');
  // Someone without the van (another station, or a photo path that isn't theirs) can't.
  await fails(S.d3.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: await shot(S.d3) }), 'permission-denied');
  await fails(S.mgr.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: p1 }), 'invalid-argument');
  await fails(S.d3.call('saveReading', { orgId: S.org, readId: r1.readId, values: { odometerKm: 48213 }, refuel: null }), 'not-found');
  const s1 = await S.d1.call('saveReading', { orgId: S.org, readId: r1.readId, values: { odometerKm: 48213, fuelPct: 75, batteryPct: null, rangeKm: null, warnings: [] }, refuel: null });
  assert.equal(s1.role, 'start');
  await fails(S.d1.call('saveReading', { orgId: S.org, readId: r1.readId, values: { odometerKm: 48213 }, refuel: null }), 'failed-precondition');
  const open = (await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'tours'), where('driverId', '==', S.d1.uid), orderBy('createdAt', 'desc')))).docs.map((d) => d.data());
  assert.equal(open.length, 1);
  assert.equal(open[0].start.km, 48213);
  assert.equal(open[0].model, 'Ford Transit');
  await fails(setDoc(doc(S.own.db, 'orgs', S.org, 'tours', 'fake'), { driverId: S.d1.uid, stationId: S.s1, km: 1, createdAt: 1 }), 'permission-denied');
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v2.id))).data().odometerKm, 48213);
  // The end photo: the odometer can't go down; then 130 km, an eighth of the 80-litre tank: 10 litres, 7.7 l/100 km.
  const r2 = await S.d1.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: await shot(S.d1) });
  assert.equal(r2.will, 'end');
  assert.equal(r2.endsMine, true);
  await fails(S.d1.call('saveReading', { orgId: S.org, readId: r2.readId, values: { odometerKm: 48100, fuelPct: 60 }, refuel: { litres: null, kwh: null, unknown: false } }), 'failed-precondition');
  const s2 = await S.d1.call('saveReading', { orgId: S.org, readId: r2.readId, values: { odometerKm: 48343, fuelPct: 62.5, batteryPct: null, rangeKm: null, warnings: ['Check engine'] }, refuel: { litres: null, kwh: null, unknown: false } });
  assert.equal(s2.role, 'end');
  const t = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'tours', s2.tourId))).data();
  assert.equal(t.km, 130);
  assert.equal(t.used, 10);
  assert.equal(t.per100, 7.7);
  assert.equal(t.endedHow, 'photo');
  assert.equal(t.open, false);
  assert.deepEqual(t.warnings, ['Check engine']);
  // A misread that would add thousands of kilometres needs a "yes, that's right".
  const r3 = await S.d1.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: await shot(S.d1) });
  await fails(S.d1.call('saveReading', { orgId: S.org, readId: r3.readId, values: { odometerKm: 60000, fuelPct: 50 }, refuel: null }), 'out-of-range');
  const s3 = await S.d1.call('saveReading', { orgId: S.org, readId: r3.readId, values: { odometerKm: 60000, fuelPct: 50 }, refuel: null, sure: true });
  assert.equal(s3.role, 'start');
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v2.id))).data().odometerKm, 60000);
  // The station's manager ends a tour the driver left open (the van is back).
  const r4 = await S.mgr.call('readDashboard', { orgId: S.org, vehicleId: v2.id, path: await shot(S.mgr) });
  assert.equal(r4.will, 'end');
  assert.equal(r4.endsMine, false);
  const s4 = await S.mgr.call('saveReading', { orgId: S.org, readId: r4.readId, values: { odometerKm: 60120, fuelPct: 40 }, refuel: null });
  assert.equal(s4.role, 'end');
  const t4 = (await getDoc(doc(S.own.db, 'orgs', S.org, 'tours', s4.tourId))).data();
  assert.equal(t4.km, 120);
  assert.equal(t4.used, null, 'no fuel figure without the driver\'s answer about refuelling');
  // Readings: the driver reads their own, nobody writes them.
  const mineR = await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'readings'), where('driverId', '==', S.d1.uid)));
  assert.ok(mineR.size >= 3);
});

test('damage log: new damage and who had the van, after the review', async () => {
  const { v2 } = S.vans;
  const before = await photos(S.d1, S.org, v2);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await photos(S.d1, S.org, v2);
  const k = adminDb().collection(`orgs/${S.org}/checks`).doc();
  await k.set({ vehicleId: v2.id, vehicleName: v2.name, stationId: S.s1, walkId: after, createdAt: Date.now(), createdBy: S.d1.uid, status: 'reviewed',
    spots: [{ panel: 'door' }, { panel: 'bumper' }], review: { decisions: { 0: { damage: true, known: null }, 1: { damage: false } }, manual: [{ panel: 'mirror', known: null }], at: Date.now() } });
  await fails(S.d1.call('logReview', { orgId: S.org, checkId: k.id }), 'permission-denied');
  await S.mgr.call('logReview', { orgId: S.org, checkId: k.id });
  const log = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'damageLog', k.id))).data();
  assert.equal(log.n, 2);
  assert.deepEqual(log.driverIds, [S.d1.uid]);
  assert.ok(log.from && log.from < log.foundAt);
  void before;
  const mine = await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'damageLog'), where('driverIds', 'array-contains', S.d1.uid), orderBy('foundAt', 'desc')));
  assert.equal(mine.size, 1);
  await fails(getDoc(doc(S.d3.db, 'orgs', S.org, 'damageLog', k.id)), 'permission-denied');
  // The Data tab fills in what's missing (checks reviewed before the log existed); after that, nothing is left.
  await S.mgr.call('syncDamageLog', { orgId: S.org, since: Date.now() - 86400_000 });
  assert.equal((await S.mgr.call('syncDamageLog', { orgId: S.org, since: Date.now() - 86400_000 })).updated, 0);
  await fails(S.d1.call('syncDamageLog', { orgId: S.org, since: 0 }), 'permission-denied');
});

test('records from a photo of a document: read, sorted, costs only for owners, the photo deleted', async () => {
  const { v2 } = S.vans;
  const shot = async (p) => {
    const path = `orgs/${S.org}/docs/${p.uid}/${Date.now().toString(36)}-1.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  // The station's manager: the van's details, no costs (not even asked for), the payload worked out.
  const pm = await shot(S.mgr);
  const r = await S.mgr.call('readDocument', { orgId: S.org, target: 'van', id: v2.id, paths: [pm] });
  assert.equal(r.kind, 'registration certificate');
  const got = Object.fromEntries(r.fields.map((f) => [f.key, f.value]));
  assert.equal(got.vin, 'WF0XXXTTGXKA12345');
  assert.equal(got.firstReg, '2023-05-15');
  assert.equal(got.grossKg, 3500);
  assert.equal(got.payloadKg, 1190);
  assert.equal(got['due.hu'], '2027-03-31');
  assert.equal(got.fuel, 'diesel');
  assert.equal(got.monthly, undefined, 'a manager never gets costs');
  assert.equal(got.emptyKg, undefined);
  assert.equal(r.usage, undefined);
  // The photo isn't kept.
  await fails(getBytes(ref(S.own.st, pm)));
  // The owner gets the costs too.
  const ro = await S.own.call('readDocument', { orgId: S.org, target: 'van', id: v2.id, paths: [await shot(S.own)] });
  assert.equal(ro.fields.find((f) => f.key === 'monthly').value, 705.5);
  // Drivers can't; another station's van can't; someone else's photo can't.
  await fails(S.d1.call('readDocument', { orgId: S.org, target: 'van', id: v2.id, paths: [await shot(S.d1)] }), 'permission-denied');
  await fails(S.mgr.call('readDocument', { orgId: S.org, target: 'van', id: S.vans.v3.id, paths: [await shot(S.mgr)] }), 'permission-denied');
  await fails(S.mgr.call('readDocument', { orgId: S.org, target: 'van', id: v2.id, paths: [await shot(S.own)] }), 'invalid-argument');
  await fails(S.mgr.call('readDocument', { orgId: S.org, target: 'driver', id: S.d3.uid, paths: [await shot(S.mgr)] }), 'permission-denied');
  // A driver's document: only the driver fields are asked for.
  const rd = await S.mgr.call('readDocument', { orgId: S.org, target: 'driver', id: S.d1.uid, paths: [await shot(S.mgr)] });
  assert.ok(rd.fields.every((f) => ['licenceClasses', 'licenceValid', 'employment', 'employedFrom', 'employedTo', 'vanBriefing', 'safetyBriefing'].includes(f.key)));
});

test('costs move out of the record managers read (Deploy runs this once)', async () => {
  const { v3 } = S.vans;
  const det = adminDb().doc(`orgs/${S.org}/vehicleDetails/${v3.id}`);
  await det.set({ stationId: S.s2, createdAt: Date.now(), ownership: 'leased', monthly: 650, excessPerKm: 0.08, premium: 2100, deductible: 1000 });
  const move = () => execFileSync(process.execPath, [new URL('../functions/scripts/move-costs.cjs', import.meta.url).pathname],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || `${HOST}:8080`, PROJECT: cfg.projectId }, encoding: 'utf8' });
  assert.match(move(), /Moved the costs of \d+ van/);
  const d = (await det.get()).data();
  for (const f of ['monthly', 'excessPerKm', 'premium', 'deductible']) assert.equal(d[f], undefined);
  assert.equal(d.ownership, 'leased');
  const c = (await getDoc(doc(S.own.db, 'orgs', S.org, 'vehicleCosts', v3.id))).data();
  assert.equal(c.monthly, 650);
  assert.equal(c.premium, 2100);
  assert.match(move(), /No van costs to move/);
});

test('the demo company: a driver login with a van, history, and pick-up at the first station', async () => {
  const me = await person('Demo Tester');
  const { orgId } = await me.call('createDemoCompany', {});
  const org = (await getDoc(doc(me.db, 'orgs', orgId))).data();
  const login = org.demoLogins.find((l) => l.role === 'driver');
  assert.ok(login.email && login.password);
  const alex = await person(null, login.email, login.password);
  const mine = (await getDocs(query(collection(alex.db, 'orgs', orgId, 'assignments'), where('driverId', '==', alex.uid), orderBy('createdAt', 'desc')))).docs.map((d) => d.data());
  assert.ok(mine.length >= 3, 'the demo driver has a history');
  const open = mine.filter((a) => a.end == null);
  assert.equal(open.length, 1, 'the demo driver has one van now');
  assert.ok(open[0].startWalkId, 'and picked it up with photos');
  // Tours, records and incidents: the driver reads their own; the owner everything, costs included.
  const tours = await getDocs(query(collection(alex.db, 'orgs', orgId, 'tours'), where('driverId', '==', alex.uid), orderBy('createdAt', 'desc')));
  assert.ok(tours.size >= 5, 'the demo driver has tours');
  assert.ok((await getDoc(doc(alex.db, 'orgs', orgId, 'driverRecords', alex.uid))).exists());
  assert.ok((await getDocs(collection(me.db, 'orgs', orgId, 'incidents'))).size >= 5);
  assert.ok((await getDocs(collection(me.db, 'orgs', orgId, 'vehicleCosts'))).size >= 10);
  assert.ok((await getDocs(collection(me.db, 'orgs', orgId, 'damageLog'))).size >= 3);
  const withFuel = (await getDocs(collection(me.db, 'orgs', orgId, 'tours'))).docs.map((d) => d.data()).filter((t) => t.per100 != null);
  assert.ok(withFuel.length > 50, 'most demo tours have a fuel figure');
  const van = { id: open[0].vehicleId, name: open[0].vehicleName, stationId: open[0].stationId };
  await alex.call('dropOffVan', { orgId, vehicleId: van.id, walkId: await photos(alex, orgId, van) });
  const v = (await getDoc(doc(alex.db, 'orgs', orgId, 'vehicles', van.id))).data();
  assert.equal(v.assignedTo, null);
  await me.call('deleteDemoCompany', { orgId });
  await fails(person(null, login.email, login.password));
});
