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

import { ACTIONS } from './permissions.mjs';

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
  return setCreator(await person(name), true);
}
/** Gives or takes the app creator claim (as Deploy does from APP_CREATOR_EMAILS). */
async function setCreator(p, on) {
  const r = await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/projects/${cfg.projectId}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: p.uid, customAttributes: JSON.stringify(on ? { creator: true } : {}) }),
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
async function photos(p, orgId, van, { frames = 3, source = 'camera', skipped = 0, real = false, takenAgo = 0, forHandover = null } = {}) {
  const id = doc(collection(p.db, 'orgs', orgId, 'walkarounds')).id;
  const ps = [];
  for (let n = 1; n <= frames; n++) {
    const path = `orgs/${orgId}/walkarounds/${id}/0${n}.jpg`;
    await uploadBytes(ref(p.st, path), real ? jpeg() : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
    ps.push({ n, label: `Frame ${n}`, w: 900, h: 1200, takenAt: Date.now() - takenAgo, path });
  }
  await setDoc(doc(p.db, 'orgs', orgId, 'walkarounds', id), {
    vehicleId: van.id, vehicleName: van.name, cls: 'van', stationId: van.stationId, source, createdAt: Date.now(), createdBy: p.uid,
    totalMs: null, frames, taken: frames - skipped, skipped, retakes: 0, photos: ps.slice(0, frames - skipped),
    // The app says a pick-up or drop-off follows (src/lib/outbox.ts queueWalk).
    ...(forHandover ? { forHandover } : {}),
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
function clip({ seconds = 10, recordedHoursAgo = 0, size = '320x240' } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'clip-')), 'c.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=15:duration=${seconds}`,
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
/** Waits for what a trigger writes (it runs after the write that started it). */
async function waitFor(get, what, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
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
    S.vans[k] = { id: r.id, name: `Van ${k}`, stationId: S[st], plate: k.toUpperCase() };
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
  // The history calls the van by its number plate, not its name or model (lib/vans.ts).
  assert.deepEqual(v1h.map((a) => a.vehicleName), ['V1', 'V1', 'V1']);
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
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d2, S.org, v2) }), 'failed-precondition');
  await fails(S.d2.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true }), 'permission-denied');
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'stations', S.s1), { selfAssign: true }), 'permission-denied');
  await fails(S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s2, on: true }), 'permission-denied');
  await S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true });
  // Photos are required: all of them, from the camera, by this driver, of this van.
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate }), 'invalid-argument');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d2, S.org, v2, { skipped: 1 }) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d2, S.org, v2, { source: 'library' }) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d1, S.org, v2) }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d2, S.org, v1) }), 'failed-precondition');
  // Photos kept on the phone without a connection for hours are uploaded fresh, but taken too long ago.
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: await photos(S.d2, S.org, v2, { takenAgo: 3 * 3600_000 }) }), 'failed-precondition');
  // Nobody marks their own photos as a pick-up, or edits them afterwards.
  const forged = doc(collection(S.d2.db, 'orgs', S.org, 'walkarounds'));
  await fails(setDoc(forged, { vehicleId: v2.id, stationId: S.s1, createdBy: S.d2.uid, createdAt: Date.now(), handover: { kind: 'pickup', assignmentId: 'x' } }), 'permission-denied');
  const pick = await photos(S.d2, S.org, v2);
  const r = await S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: pick });
  assert.equal((await vanDoc(S.d2, v2.id)).assignedTo.driverId, S.d2.uid);
  const w = (await getDoc(doc(S.d2.db, 'orgs', S.org, 'walkarounds', pick))).data();
  assert.deepEqual(w.handover, { kind: 'pickup', assignmentId: r.assignmentId });
  await fails(updateDoc(doc(S.d2.db, 'orgs', S.org, 'walkarounds', pick), { handover: null }), 'permission-denied');
  // The phone lost the answer and sends it again (its outbox): answered as done, nothing recorded twice.
  assert.deepEqual(await S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, walkId: pick }), { assignmentId: r.assignmentId, unchanged: true });
  assert.equal((await history(S.own, [where('driverId', '==', S.d2.uid), where('end', '==', null)])).length, 1);
  // The same photos can't be used twice; a driver with a van drops it off before taking another.
  await fails(S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: pick }), 'failed-precondition');
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v1.id, plate: v1.plate, walkId: await photos(S.d2, S.org, v1) }), 'failed-precondition');
  await fails(S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: await photos(S.d1, S.org, v2) }), 'failed-precondition');
  const drop = await photos(S.d2, S.org, v2);
  // Sent twice at once (the phone tried again while the first call was still running): both answered as done, one drop-off.
  const both = await Promise.all([1, 2].map(() => S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: drop })));
  assert.ok(both.every((x) => x.ok), JSON.stringify(both));
  assert.equal(both.filter((x) => !x.unchanged).length, 1, JSON.stringify(both));
  assert.equal((await vanDoc(S.mgr, v2.id)).assignedTo, null);
  // Dropped off, it's no longer Erik's: drivers read only the van they have (blind test, cause 3a).
  await fails(vanDoc(S.d2, v2.id), 'permission-denied');
  assert.deepEqual(await S.d2.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: drop }), { ok: true, unchanged: true });
  // Someone else's photos are never "already done" for you.
  await fails(S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, walkId: drop }), 'failed-precondition');
  const [a] = await history(S.d2, [where('driverId', '==', S.d2.uid), orderBy('start', 'desc'), limit(1)]);
  assert.equal(a.startedBy, S.d2.uid);
  assert.equal(a.startWalkId, pick);
  assert.equal(a.endWalkId, drop);
  assert.equal(a.endReason, 'dropped off');
  // Taking over a van someone didn't drop off: their assignment ends with the new driver's photos.
  const take = await photos(S.d2, S.org, v1);
  // Only after the driver said "take it over" (blind test, cause 3a): asked first, nothing changes.
  await fails(S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v1.id, plate: v1.plate, walkId: take }), 'already-exists');
  assert.equal((await vanDoc(S.mgr, v1.id)).assignedTo.driverId, S.d1.uid);
  const t = await S.d2.call('pickUpVan', { orgId: S.org, vehicleId: v1.id, plate: v1.plate, walkId: take, takeOver: true });
  // Drivers never see another driver's name: not in the answer, not on the van, not on Dana's ended assignment.
  assert.equal(t.tookOver, true);
  assert.equal(t.tookOverFrom, undefined);
  const [dana] = await history(S.d1, [where('driverId', '==', S.d1.uid), where('vehicleId', '==', v1.id), orderBy('start', 'desc'), limit(1)]);
  assert.equal(dana.endReason, 'taken over');
  assert.equal(dana.endWalkId, take);
  assert.equal(dana.endedBy, S.d2.uid);
  assert.equal(dana.endedByName, null);
  assert.ok(!JSON.stringify(dana).includes('Erik Driver'), JSON.stringify(dana));
  // Dana no longer reads the van at all; Erik's view of it has no name either.
  await fails(vanDoc(S.d1, v1.id), 'permission-denied');
  const taken = await vanDoc(S.d2, v1.id);
  assert.equal(taken.assignedTo.driverId, S.d2.uid);
  assert.ok(!JSON.stringify(taken).includes('Erik Driver') && !JSON.stringify(taken).includes('driverName'), JSON.stringify(taken.assignedTo));
  // The manager still sees who: from the company's names.
  await waitFor(async () => (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'names', S.d2.uid))).data()?.name === 'Erik Driver', 'Erik\'s name in the company\'s names');
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
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, videoId: await video(S.d1, { seconds: 3 }) }), 'failed-precondition');
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, videoId: await video(S.d1, { recordedHoursAgo: 5 }) }), 'failed-precondition');
  await fails(S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, videoId: await video(S.d2) }), 'failed-precondition');
  // Picked up with a video.
  const pv = await video(S.d1);
  const r = await S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, videoId: pv });
  assert.deepEqual(await S.d1.call('pickUpVan', { orgId: S.org, vehicleId: v2.id, plate: v2.plate, videoId: pv }), { assignmentId: r.assignmentId, unchanged: true });
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
  assert.deepEqual(await S.d1.call('dropOffVan', { orgId: S.org, vehicleId: v2.id, videoId: dv }), { ok: true, unchanged: true });
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
  assert.deepEqual(await S.mgr.call('addHandoverVideo', { orgId: S.org, assignmentId: ended.id, kind: 'dropoff', videoId: late }), { ok: true, unchanged: true });
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
  // Sent again (the phone lost the answer): done, one record. For another van it's refused.
  assert.deepEqual(await S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: dv }), { ok: true, unchanged: true });
  await fails(S.d1.call('addVanVideo', { orgId: S.org, vehicleId: S.vans.v2.id, videoId: dv }), 'failed-precondition');
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
  // Vans are called by their number plate (lib/vans.ts), in notifications too.
  assert.equal(body.title, 'V2 is yours');
  assert.match(body.body, /^Max Manager gave you V2\. Before you drive, take the pick-up video or photos\.$/);
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
  assert.deepEqual(await S.d1.call('addHandoverPhotos', { orgId: S.org, assignmentId: r.assignmentId, kind: 'pickup', walkId: pick }), { ok: true, unchanged: true });
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
  assert.deepEqual(await S.d1.call('addHandoverVideo', { orgId: S.org, assignmentId: r2.assignmentId, kind: 'pickup', videoId: pv }), { ok: true, unchanged: true });
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
  // The phone asks for another model: the company's (set only by the app creator, Fast by default) is used.
  const f = await S.d1.call('findDamage', { orgId: S.org, walkId: walk, tier: 'complex' });
  assert.equal(f.spots.length, 1);
  assert.equal((await getDoc(doc(S.d1.db, 'orgs', S.org, 'checks', f.checkId))).data().tier, 'quick');
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
  // The plate from the photo for the form: found by the type scan, read again from a crop of the full-size photo.
  // The stand-in for the AI reads the same plate both times, so it's sure; the third read isn't needed.
  assert.deepEqual(id.plate, { text: 'B-FR 1234', sure: true });
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'scans', scanId)), 'permission-denied');
  await updateDoc(doc(S.mgr.db, 'orgs', S.org, 'scans', scanId), { verdict: 'correct', actual: 'large_van' });
  const scanDoc = (await getDoc(doc(cr.db, 'orgs', S.org, 'scans', scanId))).data();
  assert.ok(scanDoc.cost > 0);
  assert.equal(scanDoc.plate, 'B-FR 1234');
  assert.equal(scanDoc.plateSure, true);
  assert.equal(scanDoc.plateModels.length, 1);
  // The plate read is part of the scan's cost: the type read and one plate read.
  assert.ok(scanDoc.inTok > 1500);
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
  // On the van, for everyone at the station (the driver too): the latest photo's km, fuel and warning lights.
  const van = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicles', v2.id))).data();
  assert.equal(van.dash.km, 60120);
  assert.equal(van.dash.fuelPct, 40);
  assert.deepEqual(van.dash.warnings, []);
  assert.equal(van.dash.by, S.mgr.uid);
  assert.equal(van.dash.byName, undefined, 'drivers read the van: no names on it');
  assert.equal(van.dash.from, 'tour');
  // The driver's km with the van: from their first photo to the latest one (the manager's counts: Dana still has it).
  const mine = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'assignments', van.assignedTo.assignmentId))).data();
  assert.equal(mine.kmStart, 48213);
  assert.equal(mine.kmEnd, 60120);
  assert.equal(van.assignedTo.kmStart, 48213);
  assert.equal(van.assignedTo.kmEnd, 60120);
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

test('the whole fleet from a file: read, checked, then added; vans already there only filled in; new stations; the plan; who may', async () => {
  // A company of its own, so the vans and the station it adds don't change the other tests.
  const own = await person('Imke Importer');
  const org = doc(collection(own.db, 'orgs')).id;
  await setDoc(doc(own.db, 'orgs', org), { name: 'Import DSP', createdBy: own.uid, createdAt: Date.now(), stationsReady: true });
  await setDoc(doc(own.db, 'orgs', org, 'members', own.uid), { role: 'owner', stationIds: [], email: '', name: 'Imke Importer', joinedAt: Date.now() });
  const st = {};
  for (const name of ['DXX1', 'DXX2']) {
    const r = doc(collection(own.db, 'orgs', org, 'stations'));
    await setDoc(r, { name, code: name, createdAt: Date.now() });
    st[name] = r.id;
  }
  const join = async (name, role) => {
    const { invites } = await own.call('createInvite', { orgId: org, role, stationId: st.DXX1, count: 1 });
    const p = await person(name);
    await p.call('acceptInvite', { token: invites[0].token, details: { firstName: name.split(' ')[0], lastName: name.split(' ')[1], phone: '+49 151 2', transporterId: '' } });
    return p;
  };
  const mgr = await join('Mira Importmanager', 'manager');
  const drv = await join('Paul Importdriver', 'driver');
  // A van already in the fleet, with its TÜV month already set.
  const v1 = doc(collection(own.db, 'orgs', org, 'vehicles')).id;
  await setDoc(doc(own.db, 'orgs', org, 'vehicles', v1), { name: 'Old one', plate: 'V1', cls: 'large_van', stationId: st.DXX1, createdAt: Date.now(), createdBy: own.uid });
  await setDoc(doc(own.db, 'orgs', org, 'vehicleDetails', v1), { stationId: st.DXX1, createdAt: Date.now(), due: { hu: '2026-01-31' } });

  const csv = [
    'Kennzeichen;Fzg-Nr.;Standort;Fahrzeug;FIN;HU;Leasingrate;Kraftstoff;Fahrer',
    'B-NEW 1;N1;DXX1;Mercedes-Benz Sprinter;WDB9066331S000001;03/2027;705,50;Diesel;Max',
    'B-NEW 2;N2;Hamburg;Mercedes-Benz Sprinter;;;;Elektro;',
    'V1;;dxx1;Ford Transit;WF0XXXTTGXKA00001;05/2028;800;;',
    'B-NEW 3;;DXX2;Unknown Thing;;;;;',
    'Summe;;;;;;1505,5;;',
  ].join('\r\n');
  const put = async (p, body, type, ext) => {
    const path = `orgs/${org}/imports/${p.uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await uploadBytes(ref(p.st, path), typeof body === 'string' ? new TextEncoder().encode(body) : body, { contentType: type });
    return path;
  };
  const vanBy = async (plate) => {
    const q = await adminDb().collection(`orgs/${org}/vehicles`).where('plate', '==', plate).get();
    return q.docs[0] ? { id: q.docs[0].id, ...q.docs[0].data() } : null;
  };
  const extra = async (coll, id) => (await adminDb().doc(`orgs/${org}/${coll}/${id}`).get()).data();

  // The owner reads the list: every van with its details, its type from the model, its station by name or code.
  const path = await put(own, csv, 'text/csv', 'csv');
  const r = await own.call('readFleetFile', { orgId: org, paths: [path], name: 'Fuhrpark.csv' });
  assert.deepEqual(r.rows.map((x) => x.plate), ['B-NEW 1', 'B-NEW 2', 'V1', 'B-NEW 3']);
  assert.equal(r.noPlate, 1, 'the totals line');
  assert.equal(r.drivers, true);
  const [a, b, c, d] = r.rows;
  assert.deepEqual([a.name, a.stationId, a.cls, a.make, a.model], ['N1', st.DXX1, 'large_van', 'Mercedes-Benz', 'Sprinter']);
  assert.deepEqual(a.values, { vin: 'WDB9066331S000001', 'due.hu': '2027-03-31', monthly: 705.5, fuel: 'diesel' });
  assert.deepEqual([b.station, b.stationId, b.values.fuel], ['Hamburg', null, 'electric']);
  assert.deepEqual([c.have, c.stationId, c.elsewhere], [v1, st.DXX1, false]);
  assert.deepEqual([d.stationId, d.cls], [st.DXX2, null], 'a model the AI couldn\'t place: the person picks the type');
  assert.equal(r.usage, undefined);
  // The file isn't kept, and what was read is the server's only.
  await fails(getBytes(ref(own.st, path)));
  await fails(getDocs(collection(own.db, 'orgs', org, 'imports')), 'permission-denied');

  // More new vans than the plan has room for: nothing is added.
  await adminDb().doc(`orgs/${org}`).update({ 'billing.vans': 3 });
  const picks = [
    { i: 0, cls: 'large_van', stationId: st.DXX1 }, { i: 1, cls: 'large_van', newStation: 'Hamburg' }, { i: 2 },
    { i: 3, cls: 'compact_van', stationId: st.DXX2, plate: 'b-new 33' },
  ];
  await fails(own.call('addVans', { orgId: org, importId: r.importId, vans: picks }), 'resource-exhausted');
  assert.equal(await vanBy('B-NEW 1'), null);
  await adminDb().doc(`orgs/${org}`).update({ billing: fnRequire('firebase-admin/firestore').FieldValue.delete() });
  // A van without a type, and a plate twice, are refused before anything is written.
  await fails(own.call('addVans', { orgId: org, importId: r.importId, vans: [{ i: 3, stationId: st.DXX2 }] }), 'invalid-argument');
  await fails(own.call('addVans', { orgId: org, importId: r.importId, vans: [{ i: 0, cls: 'large_van', stationId: st.DXX1 }, { i: 3, cls: 'large_van', stationId: st.DXX2, plate: 'B-NEW 1' }] }), 'invalid-argument');
  // Another person can't save the owner's reading.
  await fails(mgr.call('addVans', { orgId: org, importId: r.importId, vans: [{ i: 0, cls: 'large_van', stationId: st.DXX1 }] }), 'not-found');

  const res = await own.call('addVans', { orgId: org, importId: r.importId, vans: picks });
  assert.deepEqual(res, { added: 3, filled: 1, unchanged: 0, elsewhere: 0, stations: ['Hamburg'] });
  const n1 = await vanBy('B-NEW 1');
  assert.deepEqual([n1.name, n1.stationId, n1.cls, n1.roof, n1.make, n1.model, n1.vin, n1.fuel, n1.createdBy], ['N1', st.DXX1, 'large_van', 'high', 'Mercedes-Benz', 'Sprinter', 'WDB9066331S000001', 'diesel', own.uid]);
  assert.equal(n1.assignedTo, undefined, 'vans aren\'t given to drivers from a file');
  assert.deepEqual([(await extra('vehicleDetails', n1.id)).due.hu, (await extra('vehicleDetails', n1.id)).stationId], ['2027-03-31', st.DXX1]);
  assert.equal((await extra('vehicleCosts', n1.id)).monthly, 705.5);
  const hamburg = (await adminDb().collection(`orgs/${org}/stations`).where('name', '==', 'Hamburg').get()).docs;
  assert.equal(hamburg.length, 1);
  assert.equal((await vanBy('B-NEW 2')).stationId, hamburg[0].id);
  assert.deepEqual([(await vanBy('B-NEW 33')).stationId, (await vanBy('B-NEW 33')).cls], [st.DXX2, 'compact_van'], 'the plate as the person corrected it');
  // The van that was there: only what it didn't have. Its name and its TÜV month stay.
  const old = await vanBy('V1');
  assert.deepEqual([old.name, old.vin, old.make, old.model], ['Old one', 'WF0XXXTTGXKA00001', 'Ford', 'Transit']);
  assert.equal((await extra('vehicleDetails', v1)).due.hu, '2026-01-31');
  assert.equal((await extra('vehicleCosts', v1)).monthly, 800);
  await waitFor(async () => (await adminDb().doc(`orgs/${org}`).get()).data().fleetSize === 4, 'the fleet size');
  // The reading is used up.
  await fails(own.call('addVans', { orgId: org, importId: r.importId, vans: picks }), 'not-found');

  // The station's manager: no costs (not even asked for); a van at another station is only "elsewhere".
  const rm = await mgr.call('readFleetFile', { orgId: org, paths: [await put(mgr, csv, 'text/csv', 'csv')], name: null });
  assert.ok(rm.rows.every((x) => x.values.monthly === undefined));
  // (B-NEW 3 was saved as B-NEW 33, so it's new again: at DXX2, which the app doesn't let this manager add to.)
  assert.deepEqual(rm.rows.map((x) => [x.plate, !!x.have, x.elsewhere]), [['B-NEW 1', true, false], ['B-NEW 2', false, true], ['V1', true, false], ['B-NEW 3', false, false]]);
  assert.deepEqual(await mgr.call('addVans', { orgId: org, importId: rm.importId, vans: [{ i: 1 }] }), { added: 0, filled: 0, unchanged: 0, elsewhere: 1, stations: [] });
  const two = ['Kennzeichen;Fzg-Nr.;Standort;Fahrzeug', 'B-MGR 1;;Bremen;Mercedes-Benz Sprinter', 'B-MGR 2;;;Mercedes-Benz Sprinter'].join('\n');
  const rm2 = await mgr.call('readFleetFile', { orgId: org, paths: [await put(mgr, two, 'text/csv', 'csv')], name: 'two.csv' });
  await fails(mgr.call('addVans', { orgId: org, importId: rm2.importId, vans: [{ i: 0, cls: 'large_van', newStation: 'Bremen' }] }), 'permission-denied');
  await fails(mgr.call('addVans', { orgId: org, importId: rm2.importId, vans: [{ i: 1, cls: 'large_van', stationId: st.DXX2 }] }), 'permission-denied');
  assert.deepEqual(await mgr.call('addVans', { orgId: org, importId: rm2.importId, vans: [{ i: 1, cls: 'large_van', stationId: st.DXX1 }] }), { added: 1, filled: 0, unchanged: 0, elsewhere: 0, stations: [] });
  assert.equal((await vanBy('B-MGR 2')).stationId, st.DXX1);

  // A PDF goes to the AI to be copied into a table first.
  const pdf = await own.call('readFleetFile', { orgId: org, paths: [await put(own, '%PDF-1.4\n%fleet\n', 'application/pdf', 'pdf')], name: 'Liste.pdf' });
  assert.deepEqual(pdf.rows.map((x) => x.plate), ['B-PDF 1', 'B-PDF 2']);
  // Drivers can't upload or read a fleet list; nobody reads someone else's file; an old Excel file is explained.
  await fails(put(drv, csv, 'text/csv', 'csv'));
  await fails(drv.call('readFleetFile', { orgId: org, paths: [`orgs/${org}/imports/${drv.uid}/x.csv`], name: null }), 'permission-denied');
  await fails(mgr.call('readFleetFile', { orgId: org, paths: [path], name: null }), 'invalid-argument');
  const xls = await fails(own.call('readFleetFile', { orgId: org, paths: [await put(own, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'application/vnd.ms-excel', 'xls')], name: 'alt.xls' }), 'invalid-argument');
  assert.match(xls.message, /old Excel file/);
});

test('refuel, wash and parts: dashboard, the fuel card checked, a manager allows a wrong one, the receipt, every attempt kept', async () => {
  const { v2 } = S.vans;
  const shot = async (p) => {
    const path = `orgs/${S.org}/buys/${p.uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const buy = async (p, id) => (await getDoc(doc(p.db, 'orgs', S.org, 'purchases', id))).data();
  // The van's fuel card in its record (the business side): only the last digits.
  await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v2.id), { fuelCard: 'DKV card ending 4471' }, { merge: true });
  // The manager's phone gets notifications (a push service on this computer, as in the test above).
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => { got.push({ url: req.url, body: Buffer.concat(ch) }); res.statusCode = 201; res.end(); });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  await adminDb().collection(`users/${S.mgr.uid}/push`).doc('mgr').set({ endpoint: `http://${HOST}:${srv.address().port}/push/mgr`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth }, createdAt: Date.now(), device: 'manager phone' });
  const opened = () => got.map((g) => JSON.parse(fnRequire('http_ece').decrypt(g.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString()));
  try {
    // 1. The right card: dashboard, card, receipt, done. The manager hears about it with the details.
    const dashShot = await shot(S.d1);
    const st = await S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: dashShot });
    assert.equal(st.needsCard, true);
    // Sent again with the same photo (the phone lost the answer): the same one, not a second.
    assert.equal((await S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: dashShot })).id, st.id);
    assert.equal((await buy(S.d1, st.id)).status, 'open');
    const dr = await S.d1.call('purchase', { orgId: S.org, action: 'dash', id: st.id });
    assert.equal(dr.values.odometerKm, 48213);
    // Not on another station's van, not someone else's photo, and parts only for owners and managers.
    await fails(S.d3.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: await shot(S.d3) }), 'permission-denied');
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: await shot(S.mgr) }), 'invalid-argument');
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'parts', vehicleId: v2.id, path: await shot(S.d1) }), 'permission-denied');
    // The receipt comes after the card.
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: st.id, path: await shot(S.d1) }), 'failed-precondition');
    const card = await shot(S.d1);
    const c1 = await S.d1.call('purchase', { orgId: S.org, action: 'card', id: st.id, path: card });
    assert.equal(c1.result, 'match');
    assert.equal((await S.d1.call('purchase', { orgId: S.org, action: 'card', id: st.id, path: card })).result, 'match');
    // The card photo isn't kept, only its last 4 digits.
    await fails(getBytes(ref(S.own.st, card)));
    assert.equal((await buy(S.d1, st.id)).card.read.last4, '4471');
    // Someone else can't carry on with it.
    await fails(S.mgr.call('purchase', { orgId: S.org, action: 'receipt', id: st.id, path: await shot(S.mgr) }), 'permission-denied');
    const receipt = await shot(S.d1);
    const rc = await S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: st.id, path: receipt });
    assert.equal(rc.litres, 45.2);
    assert.equal((await S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: st.id, path: receipt })).litres, 45.2);
    assert.equal(rc.receipt.total, 79.1);
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'finish', id: st.id, values: { odometerKm: 60300, fuelPct: 25, total: 79.1 } }), 'invalid-argument');
    const f1 = await S.d1.call('purchase', { orgId: S.org, action: 'finish', id: st.id, values: { odometerKm: 60300, fuelPct: 25, litres: 45.2, total: 79.1 } });
    assert.deepEqual(f1.flags, []);
    assert.equal(f1.notified, 1);
    const b1 = await buy(S.mgr, st.id);
    assert.equal(b1.status, 'done');
    assert.equal(b1.litres, 45.2);
    assert.equal(b1.total, 79.1);
    assert.deepEqual(b1.corrected, ['odometerKm', 'fuelPct']);
    assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v2.id))).data().odometerKm, 60300);
    // On the van for everyone at the station: the km, the fuel after filling up (25% and 45.2 l in 80 l: 82%),
    // and the warning lights the AI read on the dashboard photo.
    const vf = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicles', v2.id))).data();
    assert.equal(vf.dash.km, 60300);
    assert.equal(vf.dash.from, 'fuel');
    assert.equal(vf.dash.fuelPct, 82);
    assert.deepEqual(vf.dash.warnings, ['Tyre pressure']);
    const m1 = opened().at(-1);
    assert.equal(m1.title, 'Refuel: V2, 45.2 l, €79.10');
    assert.match(m1.body, /^Dana Driver at Test Tankstelle, 60,300 km\.$/);
    assert.equal(m1.url, `/buy/${st.id}`);
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'cancel', id: st.id }), 'failed-precondition');

    // 2. Not the van's card: the driver is stopped and told whom to call; the manager refuses; the driver cancels.
    await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', v2.id), { fuelCard: 'Shell card ending 1234' }, { merge: true });
    const w = await S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'wash', vehicleId: v2.id, path: await shot(S.d1) });
    const c2 = await S.d1.call('purchase', { orgId: S.org, action: 'card', id: w.id, path: await shot(S.d1) });
    assert.equal(c2.result, 'mismatch');
    assert.match(c2.why, /ending 4471.*ends 1234/);
    assert.deepEqual(c2.people, [{ name: 'Max Manager', phone: '+49 151 1' }]);
    const stop = opened().at(-1);
    assert.match(stop.title, /^Stop: V2, not the van's card$/);
    assert.match(stop.body, /Allow or refuse the wash\.$/);
    assert.equal((await buy(S.mgr, w.id)).status, 'waiting');
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: w.id, path: await shot(S.d1) }), 'failed-precondition');
    // Only the station's managers and owners decide; not the driver, not another station's people.
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'decide', id: w.id, allow: true }), 'permission-denied');
    await fails(S.d3.call('purchase', { orgId: S.org, action: 'decide', id: w.id, allow: true }), 'permission-denied');
    await S.mgr.call('purchase', { orgId: S.org, action: 'decide', id: w.id, allow: false, note: 'Use the card in the glovebox.' });
    await fails(S.own.call('purchase', { orgId: S.org, action: 'decide', id: w.id, allow: true }), 'failed-precondition');
    await fails(S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: w.id, path: await shot(S.d1) }), 'failed-precondition');
    await S.d1.call('purchase', { orgId: S.org, action: 'cancel', id: w.id });
    const bw = await buy(S.d1, w.id);
    assert.equal(bw.status, 'cancelled');
    assert.equal(bw.decision.allow, false);
    assert.equal(bw.decision.note, 'Use the card in the glovebox.');

    // 3. No card at all: same as a wrong one. The owner allows it; the driver carries on and the flag stays.
    // (Started twice at once with the same photo, as a phone trying again would: one purchase.)
    const nShot = await shot(S.d1);
    const [n, n2] = await Promise.all([1, 2].map(() => S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: nShot })));
    assert.equal(n2.id, n.id);
    const c3 = await S.d1.call('purchase', { orgId: S.org, action: 'card', id: n.id, missing: true });
    assert.equal(c3.result, 'missing');
    await S.own.call('purchase', { orgId: S.org, action: 'decide', id: n.id, allow: true });
    await S.d1.call('purchase', { orgId: S.org, action: 'receipt', id: n.id, path: await shot(S.d1) });
    const f3 = await S.d1.call('purchase', { orgId: S.org, action: 'finish', id: n.id, values: { odometerKm: 60410, fuelPct: 75, litres: 45.2, total: 79.1 } });
    const keys = f3.flags.map((x) => x.key).sort();
    // The card, 45 litres into a tank with room for 20, and the receipt paid with another card.
    assert.deepEqual(keys, ['card', 'litres', 'receiptCard']);
    assert.match(f3.flags.find((x) => x.key === 'card').text, /Olga Owner allowed it\.$/);

    // 4. One at a time: starting again closes what was left open (it stays in the history).
    const a = await S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'fuel', vehicleId: v2.id, path: await shot(S.d1) });
    const b = await S.d1.call('purchase', { orgId: S.org, action: 'start', kind: 'wash', vehicleId: v2.id, path: await shot(S.d1) });
    const left = await buy(S.d1, a.id);
    assert.equal(left.status, 'cancelled');
    assert.equal(left.cancel.reason, 'Started another one');
    // The station's manager can close one a driver left.
    await S.mgr.call('purchase', { orgId: S.org, action: 'cancel', id: b.id, reason: 'Driver went home' });

    // 5. Parts (a manager): dashboard, the parts, the receipt and why. No card check; the owners hear about it.
    const pt = await S.mgr.call('purchase', { orgId: S.org, action: 'start', kind: 'parts', vehicleId: v2.id, path: await shot(S.mgr) });
    assert.equal(pt.needsCard, false);
    await fails(S.mgr.call('purchase', { orgId: S.org, action: 'receipt', id: pt.id, path: await shot(S.mgr), parts: [await shot(S.mgr)], note: '' }), 'invalid-argument');
    await fails(S.mgr.call('purchase', { orgId: S.org, action: 'receipt', id: pt.id, path: await shot(S.mgr), parts: [], note: 'Mirror broke' }), 'invalid-argument');
    await S.mgr.call('purchase', { orgId: S.org, action: 'receipt', id: pt.id, path: await shot(S.mgr), parts: [await shot(S.mgr), await shot(S.mgr)], note: 'Left mirror glass broke on the tour.' });
    await S.mgr.call('purchase', { orgId: S.org, action: 'finish', id: pt.id, values: { odometerKm: 60420, total: 34.5 } });
    const bp = await buy(S.own, pt.id);
    assert.equal(bp.status, 'done');
    // Each finished one moves the van's km on, and the km of the driver who has it (Dana, whoever bought).
    const vn = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicles', v2.id))).data();
    assert.equal(vn.dash.km, 60420);
    assert.equal(vn.dash.from, 'parts');
    assert.equal(vn.dash.by, S.mgr.uid);
    assert.equal(vn.dash.byName, undefined);
    assert.equal(vn.assignedTo.kmEnd, 60420);
    assert.equal((await getDoc(doc(S.d1.db, 'orgs', S.org, 'assignments', vn.assignedTo.assignmentId))).data().kmEnd, 60420);
    assert.equal(bp.parts.length, 2);
    assert.equal(bp.note, 'Left mirror glass broke on the tour.');

    // Every attempt is kept: the driver reads their own (5), the manager the station's; nobody changes them.
    const mine = await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'purchases'), where('by', '==', S.d1.uid), orderBy('createdAt', 'desc')));
    assert.deepEqual(mine.docs.map((d) => d.data().status).sort(), ['cancelled', 'cancelled', 'cancelled', 'done', 'done']);
    const station = await getDocs(query(collection(S.mgr.db, 'orgs', S.org, 'purchases'), where('stationId', 'in', [S.s1]), orderBy('createdAt', 'desc')));
    assert.equal(station.size, 6);
    await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org, 'purchases', w.id), { status: 'done' }), 'permission-denied');
    await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'purchases', st.id)), 'permission-denied');
  } finally {
    srv.close();
  }
});

test('km per driver: the next driver starts at the last photo\'s km; earlier data is filled in once', async () => {
  const { v2, v3 } = S.vans;
  // The manager takes the van straight after Dana: the start is its last reading (from the last 24 hours), and
  // Dana's km end there.
  const before = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicles', v2.id))).data();
  const r = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.mgr.uid });
  const next = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'assignments', r.assignmentId))).data();
  assert.equal(next.kmStart, 60420);
  assert.equal(next.kmEnd, null);
  const dana = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'assignments', before.assignedTo.assignmentId))).data();
  assert.equal(dana.end != null, true);
  assert.equal(dana.kmEnd, 60420);
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v2.id, driverId: S.d1.uid });
  // A van and a driver from before: their km are worked out from the photos, once (Deploy runs this).
  const a = adminDb().collection(`orgs/${S.org}/assignments`).doc();
  const t0 = Date.now();
  await adminDb().collection(`orgs/${S.org}/readings`).add({ vehicleId: v3.id, stationId: S.s2, by: S.d3.uid, byName: 'Fay Driver', at: t0 - 3 * 3600_000, odometerKm: 1000, fuelPct: 50, warnings: [] });
  await a.set({ vehicleId: v3.id, vehicleName: v3.name, plate: 'V3', driverId: S.d3.uid, driverName: 'Fay Driver', stationId: S.s2, start: t0 - 2 * 3600_000, end: null,
    startedBy: S.own.uid, startedByName: 'Olga Owner', endedBy: null, endedByName: null, endReason: null, createdAt: t0 - 2 * 3600_000 });
  await adminDb().collection(`orgs/${S.org}/readings`).add({ vehicleId: v3.id, stationId: S.s2, by: S.d3.uid, byName: 'Fay Driver', at: t0 - 3600_000, odometerKm: 1100, fuelPct: 40, warnings: ['AdBlue'] });
  const vref = adminDb().doc(`orgs/${S.org}/vehicles/${v3.id}`);
  const { FieldValue } = fnRequire('firebase-admin/firestore');
  await vref.update({ assignedTo: { assignmentId: a.id, driverId: S.d3.uid, driverName: 'Fay Driver', since: t0 - 2 * 3600_000 }, dash: FieldValue.delete() });
  await adminDb().doc(`orgs/${S.org}`).update({ vanDash: FieldValue.delete() });
  const fill = () => execFileSync(process.execPath, [new URL('../functions/scripts/van-dash.cjs', import.meta.url).pathname],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || `${HOST}:8080`, PROJECT: cfg.projectId }, encoding: 'utf8' });
  assert.match(fill(), /Filled in the km and dashboard of \d+ van/);
  const fay = (await a.get()).data();
  assert.equal(fay.kmStart, 1000);
  assert.equal(fay.kmEnd, 1100);
  const v = (await vref.get()).data();
  assert.equal(v.dash.km, 1100);
  assert.deepEqual(v.dash.warnings, ['AdBlue']);
  assert.equal(v.assignedTo.kmEnd, 1100);
  assert.match(fill(), /No companies to fill in/);
});

test('checks for drivers: set by the manager, done by the driver who has the van, reminders when not done', async () => {
  const { v2 } = S.vans;
  const R = (p, x) => p.call('routine', { orgId: S.org, ...x });
  const vanOf = async (p) => (await getDoc(doc(p.db, 'orgs', S.org, 'vehicles', v2.id))).data();
  // Owners and fleet managers set them; managers only for their station.
  await fails(R(S.d1, { action: 'save', key: 'Oil level', how: 'daily', vans: 'all', stationId: S.s1, photo: false }), 'permission-denied');
  await fails(R(S.mgr, { action: 'save', key: 'Oil level', how: 'daily', vans: 'all', stationId: null, photo: false }), 'permission-denied');
  await fails(R(S.mgr, { action: 'save', key: 'Oil level', how: 'daily', vans: 'all', stationId: S.s2, photo: false }), 'permission-denied');
  await fails(R(S.mgr, { action: 'save', name: 'x', how: 'daily', vans: 'all', stationId: S.s1, photo: false }), 'invalid-argument');
  await fails(R(S.mgr, { action: 'save', key: 'Oil level', how: 'days', days: 9, vans: 'all', stationId: S.s1, photo: false }), 'invalid-argument');
  const oil = (await R(S.mgr, { action: 'save', key: 'Oil level', how: 'daily', vans: 'all', stationId: S.s1, photo: false })).id;
  const cargo = (await R(S.mgr, { action: 'save', key: 'Cargo area clean and empty', how: 'every', vans: [v2.id], stationId: S.s1, photo: true })).id;
  // An electric-only check doesn't touch a diesel van.
  await R(S.own, { action: 'save', key: 'Plugged in to charge', how: 'daily', vans: 'electric', stationId: null, photo: false });
  // Due now on Dana's van, and she sees it.
  let van = await vanOf(S.d1);
  assert.deepEqual(van.todo.map((x) => x.id).sort(), [oil, cargo].sort());
  // Someone at another station can't do it; the driver does it.
  await fails(S.d3.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: oil, ok: true }), 'permission-denied');
  const d1 = await S.d1.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: oil, ok: true, id: 'oilDoneByDana1' });
  assert.deepEqual(d1.todo.map((x) => x.id), [cargo]);
  // Sent again (the phone lost the answer): one record. Someone else can't use that name.
  assert.equal((await S.d1.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: oil, ok: true, id: 'oilDoneByDana1' })).id, 'oilDoneByDana1');
  await fails(S.mgr.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: oil, ok: true, id: 'oilDoneByDana1' }), 'invalid-argument');
  // The cargo area needs a photo; a problem needs a note.
  await fails(S.d1.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: cargo, ok: true }), 'invalid-argument');
  const path = `orgs/${S.org}/routines/${S.d1.uid}/${Date.now()}.jpg`;
  await uploadBytes(ref(S.d1.st, path), jpeg(), { contentType: 'image/jpeg' });
  await fails(S.d1.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: cargo, ok: false, note: '', path }), 'invalid-argument');
  const d2 = await S.d1.call('routineDone', { orgId: S.org, vehicleId: v2.id, routineId: cargo, ok: false, note: 'Boxes left from yesterday', path });
  assert.deepEqual(d2.todo, []);
  van = await vanOf(S.d1);
  assert.equal(van.routines[cargo].ok, false);
  assert.equal(van.routines[cargo].note, 'Boxes left from yesterday');
  assert.equal(van.routines[oil].by, S.d1.uid);
  assert.equal(van.routines[oil].byName, undefined, 'everyone at the station reads the van: no names on it');
  // Kept: the manager reads the station's, the driver her own; nobody writes them.
  const done = await getDocs(query(collection(S.mgr.db, 'orgs', S.org, 'routineDone'), where('stationId', 'in', [S.s1]), orderBy('createdAt', 'desc')));
  assert.equal(done.size, 2);
  assert.equal((await getDocs(query(collection(S.d1.db, 'orgs', S.org, 'routineDone'), where('by', '==', S.d1.uid), orderBy('createdAt', 'desc')))).size, 2);
  // Tomorrow at noon the daily one is due again: the driver is reminded and the manager told, once each.
  const { hourAt } = fnRequire('./lib/routines.js');
  const cr = await appCreator('Quinn Sweeper');
  await fails(S.own.call('routineSweepNow', { orgId: S.org }), 'permission-denied');
  const noon = hourAt(Date.now() + 86400_000, 12);
  const s1 = await cr.call('routineSweepNow', { orgId: S.org, now: noon });
  assert.ok(s1.reminded >= 1 && s1.told >= 1, JSON.stringify(s1));
  const s2 = await cr.call('routineSweepNow', { orgId: S.org, now: noon + 1800_000 });
  assert.deepEqual(s2, { reminded: 0, told: 0 });
  // Not at night.
  assert.deepEqual(await cr.call('routineSweepNow', { orgId: S.org, now: hourAt(Date.now() + 2 * 86400_000, 22) }), { reminded: 0, told: 0 });
  // Removed: nothing due from it any more.
  await R(S.mgr, { action: 'delete', id: oil });
  await cr.call('routineSweepNow', { orgId: S.org, now: Date.now() });
  assert.ok(!(await vanOf(S.d1)).todo.some((x) => x.id === oil));
});

test('service history and the TÜV: owners and the station\'s managers record it with km and cost, kept for good; a reminder a month before the TÜV', async () => {
  // Two vans of their own, so the other tests' vans don't matter: one at each station.
  const mk = async (plate, st) => {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(r, { name: '', plate, cls: 'van', stationId: S[st], createdAt: Date.now(), createdBy: S.own.uid });
    return r.id;
  };
  const vs = await mk('SV-1', 's1'), vx = await mk('SV-2', 's2');
  const add = (p, x) => p.call('service', { orgId: S.org, action: 'add', ...x });
  const det = async (id) => (await getDoc(doc(S.own.db, 'orgs', S.org, 'vehicleDetails', id))).data();
  const rec = async (p, id) => (await getDoc(doc(p.db, 'orgs', S.org, 'services', id))).data();
  const oil = { id: 'svcOil1', vehicleId: vs, kind: 'service', day: '2026-11-02', km: 61200, cost: 389.5, garage: 'Autohaus Ost', note: 'Oil and filters', next: { service: '2027-11-02', serviceKm: 91200 } };
  // Drivers don't record services; managers only for their station's vans.
  await fails(add(S.d1, oil), 'permission-denied');
  await fails(add(S.mgr, { ...oil, id: 'svcOther', vehicleId: vx }), 'permission-denied');
  // The km are needed; Other needs a name; the TÜV needs its result and the new sticker; no days in the future.
  await fails(add(S.mgr, { ...oil, km: null }), 'invalid-argument');
  await fails(add(S.mgr, { ...oil, kind: 'other', name: '' }), 'invalid-argument');
  await fails(add(S.mgr, { ...oil, kind: 'hu', next: null }), 'invalid-argument');
  await fails(add(S.mgr, { ...oil, kind: 'hu', result: 'passed', next: {} }), 'invalid-argument');
  await fails(add(S.mgr, { ...oil, day: '2099-01-01' }), 'invalid-argument');
  await fails(add(S.mgr, { ...oil, next: { serviceKm: 1000 } }), 'invalid-argument');
  // The fleet manager records the service: kept with the plate and the station; the van's record follows.
  const r1 = await add(S.mgr, oil);
  assert.equal(r1.id, 'svcOil1');
  assert.deepEqual(r1.applied.sort(), ['service', 'serviceKm']);
  const o1 = await rec(S.mgr, 'svcOil1');
  assert.equal(o1.vehicleName, 'SV-1');
  assert.equal(o1.stationId, S.s1);
  assert.equal(o1.byName, 'Max Manager');
  assert.equal(o1.cost, 389.5);
  let d = await det(vs);
  assert.equal(d.stationId, S.s1);
  assert.equal(d.odometerKm, 61200);
  assert.equal(d.due.service, '2027-11-02');
  assert.equal(d.due.serviceKm, 91200);
  assert.equal(d.lastService.kind, 'service');
  // Sent again (the phone lost the answer): one record. Someone else can't use that id.
  assert.equal((await add(S.mgr, oil)).again, true);
  await fails(add(S.own, { ...oil, kind: 'tyres', next: null }), 'invalid-argument');
  assert.equal((await getDocs(query(collection(S.own.db, 'orgs', S.org, 'services'), where('vehicleId', '==', vs)))).size, 1);
  // The owner records the TÜV: the new sticker's month becomes the van's TÜV date (its last day).
  const hu = await add(S.own, { id: 'svcHu1', vehicleId: vs, kind: 'hu', day: '2026-11-10', km: 61500, cost: 139, garage: 'TÜV Süd', result: 'passed', next: { hu: '2028-03-01' } });
  assert.deepEqual(hu.applied, ['hu']);
  d = await det(vs);
  assert.equal(d.due.hu, '2028-03-31');
  assert.equal(d.odometerKm, 61500);
  // Typing in old invoices never pulls a later date back or the odometer down, and isn't the last service.
  await add(S.own, { id: 'svcHuOld', vehicleId: vs, kind: 'hu', day: '2024-03-10', km: 20000, cost: 120, result: 'passed', next: { hu: '2026-03-01' } });
  await add(S.mgr, { id: 'svcTyresOld', vehicleId: vs, kind: 'tyres', day: '2025-10-01', km: 40000, cost: 640, next: { tyres: '2026-04-01' } });
  d = await det(vs);
  assert.equal(d.due.hu, '2028-03-31');
  assert.equal(d.odometerKm, 61500);
  assert.equal(d.lastService.id, 'svcOil1');
  // A failed TÜV leaves the date as it is.
  await add(S.mgr, { id: 'svcHuFail', vehicleId: vs, kind: 'hu', day: '2026-11-12', km: 61600, result: 'failed', note: 'Brake lights' });
  assert.equal((await det(vs)).due.hu, '2028-03-31');
  // The newest service decides the next service, also when it's sooner than what was there (blind QA F01: a
  // target of 75,000 km typed in by hand stayed after a service said 60,000 km). Without a next date it clears the
  // old one; an older invoice typed in afterwards changes neither.
  await updateDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', vs), { 'due.serviceKm': 125000 });
  await add(S.mgr, { id: 'svcOil2', vehicleId: vs, kind: 'service', day: '2026-11-15', km: 61700, next: { serviceKm: 91700 } });
  d = await det(vs);
  assert.equal(d.due.serviceKm, 91700);
  assert.equal(d.due.service ?? null, null);
  await add(S.mgr, { id: 'svcOil0', vehicleId: vs, kind: 'service', day: '2025-11-02', km: 31000, next: { service: '2026-11-02', serviceKm: 61000 } });
  d = await det(vs);
  assert.equal(d.due.serviceKm, 91700);
  assert.equal(d.due.service ?? null, null);
  assert.equal(d.lastService.id, 'svcOil2');
  // A new entry far below the km the van already had is a typo (blind QA round 2: 100 km on a van at 46,600): refused.
  // Older entries may have fewer km (svcOil0 above).
  const low = await fails(add(S.mgr, { id: 'svcLow', vehicleId: vs, kind: 'hu', day: '2026-11-16', km: 100, result: 'passed', next: { hu: '2029-03-01' } }), 'invalid-argument');
  assert.match(low.message, /61700/);
  assert.equal((await det(vs)).due.hu, '2028-03-31');
  // A correction keeps what was there before and who changed it. Drivers can't; nothing changed is said.
  await fails(S.d1.call('service', { orgId: S.org, action: 'fix', id: 'svcOil1', ...oil, cost: 1 }), 'permission-denied');
  const fx = await S.mgr.call('service', { orgId: S.org, action: 'fix', ...oil, cost: 412.9 });
  assert.deepEqual(fx.changed, ['cost']);
  const o2 = await rec(S.own, 'svcOil1');
  assert.equal(o2.cost, 412.9);
  assert.equal(o2.edits.length, 1);
  assert.equal(o2.edits[0].was.cost, 389.5);
  assert.equal(o2.edits[0].byName, 'Max Manager');
  assert.equal((await S.mgr.call('service', { orgId: S.org, action: 'fix', ...oil, cost: 412.9 })).unchanged, true);
  // Who reads it: owners and the station's managers (as the van page asks); never drivers. Nobody writes or deletes.
  const mine = await getDocs(query(collection(S.mgr.db, 'orgs', S.org, 'services'), where('vehicleId', '==', vs), where('stationId', 'in', [S.s1]), orderBy('day', 'desc'), limit(300)));
  assert.equal(mine.size, 7);
  await fails(getDocs(query(collection(S.d1.db, 'orgs', S.org, 'services'), where('vehicleId', '==', vs), where('stationId', 'in', [S.s1]))), 'permission-denied');
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'services', 'svcOil1'), { cost: 1 }), 'permission-denied');
  await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'services', 'svcOil1')), 'permission-denied');
  // The history goes with the van to another station: its new managers see it, the old ones don't.
  await S.own.call('moveVan', { orgId: S.org, vehicleId: vs, stationId: S.s2 });
  assert.equal((await rec(S.own, 'svcOil1')).stationId, S.s2);
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'services', 'svcOil1')), 'permission-denied');
  await fails(add(S.mgr, { ...oil, id: 'svcAfterMove' }), 'permission-denied');

  // The TÜV reminder: the station's fleet manager gets one notification a month before it runs out, once per date.
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (x) => ch.push(x));
    req.on('end', () => { got.push(JSON.parse(Buffer.concat(ch).toString() || '{}')); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { status: 'ok', id: 't' } })); });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  try {
    await adminDb().doc(`users/${S.mgr.uid}/push/svc`).set({ expo: 'ExponentPushToken[cccccccccccccccccccccc]', platform: 'ios', createdAt: Date.now(), device: 'test', expoUrl: `http://${HOST}:${srv.address().port}/expo/svc` });
    const vt = await mk('TUV-1', 's1');
    await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', vt), { stationId: S.s1, createdAt: Date.now(), due: { hu: '2027-03-31' } });
    // A retired van isn't reminded about.
    const vr = await mk('TUV-OLD', 's1');
    await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', vr), { stationId: S.s1, createdAt: Date.now(), due: { hu: '2027-03-31' } });
    await adminDb().doc(`orgs/${S.org}/vehicles/${vr}`).update({ retired: true });
    const cr = await appCreator('Tessa Tuv');
    await fails(S.own.call('serviceSweepNow', {}), 'permission-denied');
    const forVan = (id) => got.filter((m) => m.data?.url === `/vehicle/${id}?tab=service`);
    // Five weeks before: nothing yet.
    await cr.call('serviceSweepNow', { now: Date.UTC(2027, 1, 20, 9) });
    assert.equal(forVan(vt).length, 0);
    // Four weeks before: the reminder, with the plate.
    await cr.call('serviceSweepNow', { now: Date.UTC(2027, 2, 1, 9) });
    assert.equal(forVan(vt).length, 1);
    assert.match(forVan(vt)[0].body, /TUV-1/);
    assert.match(forVan(vt)[0].title, /TÜV/);
    // Not again for the same date, and not for the retired van.
    await cr.call('serviceSweepNow', { now: Date.UTC(2027, 2, 2, 9) });
    assert.equal(forVan(vt).length, 1);
    assert.equal(forVan(vr).length, 0);
    assert.equal((await adminDb().doc(`orgs/${S.org}/serviceNags/hu_${vt}_2027-03-31`).get()).exists, true);
    // Nobody in the app reads or writes the reminders sent.
    await fails(getDoc(doc(S.own.db, 'orgs', S.org, 'serviceNags', `hu_${vt}_2027-03-31`)), 'permission-denied');
    // A new date (the van passed) gets its own reminder in its time.
    await updateDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', vt), { 'due.hu': '2029-03-31' });
    await cr.call('serviceSweepNow', { now: Date.UTC(2029, 2, 5, 9) });
    assert.equal(forVan(vt).length, 2);
    // A TÜV is a month: a date kept as a day in the middle of it (the demo's, or one read from a document) counts as the
    // month's end, so it's reminded about a month before that, not before the day (blind QA round 3).
    const vm = await mk('TUV-MID', 's1');
    await setDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicleDetails', vm), { stationId: S.s1, createdAt: Date.now(), due: { hu: '2027-03-10' } });
    await cr.call('serviceSweepNow', { now: Date.UTC(2027, 1, 20, 9) });
    assert.equal(forVan(vm).length, 0);
    await cr.call('serviceSweepNow', { now: Date.UTC(2027, 2, 1, 9) });
    assert.equal(forVan(vm).length, 1);
  } finally {
    await adminDb().doc(`users/${S.mgr.uid}/push/svc`).delete().catch(() => {});
    srv.close();
  }
});

test('service appointments: owners and the station\'s managers book, move and cancel them (kept); a reminder before; filling in the service marks it done', async () => {
  const mk = async (plate, st) => {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(r, { name: '', plate, cls: 'van', stationId: S[st], createdAt: Date.now(), createdBy: S.own.uid });
    return r.id;
  };
  const va = await mk('AP-1', 's1'), vx = await mk('AP-2', 's2');
  const call = (p, x) => p.call('appointment', { orgId: S.org, ...x });
  const appt = async (p, id) => (await getDoc(doc(p.db, 'orgs', S.org, 'serviceAppointments', id))).data();
  // German time: the day the appointment is on, three days from now, at 10:00.
  const berlinDay = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const day = berlinDay(Date.now() + 3 * 86400_000), later = berlinDay(Date.now() + 5 * 86400_000);
  const book = { action: 'book', id: 'apOil', vehicleId: va, kind: 'service', day, time: '10:00', garage: 'Autohaus Ost', note: 'Ask for Jens' };
  // Drivers don't book; managers only for their station's vans. What it's for, a real day and time, a time ahead.
  await fails(call(S.d1, book), 'permission-denied');
  await fails(call(S.mgr, { ...book, id: 'apX', vehicleId: vx }), 'permission-denied');
  await fails(call(S.mgr, { ...book, kind: 'wash' }), 'invalid-argument');
  await fails(call(S.mgr, { ...book, kind: 'other', name: '' }), 'invalid-argument');
  await fails(call(S.mgr, { ...book, time: '25:00' }), 'invalid-argument');
  await fails(call(S.mgr, { ...book, day: '2026-02-30' }), 'invalid-argument');
  await fails(call(S.mgr, { ...book, day: berlinDay(Date.now() - 86400_000) }), 'invalid-argument');
  await fails(call(S.mgr, { ...book, remind: 17 }), 'invalid-argument');
  // The owner books it; reminded a day before unless chosen otherwise. Sent twice: once.
  const r = await call(S.own, book);
  const a1 = await appt(S.mgr, 'apOil');
  assert.equal(a1.status, 'booked');
  assert.equal(a1.remind, 1440);
  assert.equal(a1.stationId, S.s1);
  assert.equal(a1.vehicleName, 'AP-1');
  assert.equal(a1.byName, 'Olga Owner');
  // 10:00 in Berlin is 09:00 or 08:00 UTC (winter or summer time).
  assert.ok([9, 8].includes(new Date(a1.at).getUTCHours()), new Date(a1.at).toISOString());
  assert.equal(a1.remindAt, a1.at - 86400_000);
  assert.equal(r.remindAt, a1.remindAt);
  assert.equal((await call(S.own, book)).again, true);
  await fails(call(S.mgr, { ...book, kind: 'tyres' }), 'invalid-argument');
  // The driver who has the van sees on it that it's booked (unless the appointment says not to): what for, when and
  // the garage, never the notes. They don't read the appointments themselves. (Drivers read only the van they have:
  // blind test, cause 3a. Dana has van 2; she gets this one for the test and van 2 back at the end.)
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: va, driverId: S.d1.uid });
  const visit = async () => (await getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicles', va))).data().garageVisit ?? null;
  assert.deepEqual(await visit(), { id: 'apOil', kind: 'service', name: null, day, time: '10:00', at: a1.at, garage: 'Autohaus Ost' });
  assert.ok(!JSON.stringify(await visit()).includes('Jens'));
  await fails(updateDoc(doc(S.mgr.db, 'orgs', S.org, 'vehicles', va), { garageVisit: null }), 'permission-denied');
  await fails(call(S.mgr, { ...book, id: 'apBad', drivers: 'yes' }), 'invalid-argument');
  // Who reads them: owners and the station's managers, never drivers. Nobody writes or deletes them in the app.
  const mine = await getDocs(query(collection(S.mgr.db, 'orgs', S.org, 'serviceAppointments'), where('stationId', 'in', [S.s1]), orderBy('createdAt', 'desc'), limit(500)));
  assert.ok(mine.docs.some((d) => d.id === 'apOil'));
  await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'serviceAppointments', 'apOil')), 'permission-denied');
  await fails(updateDoc(doc(S.own.db, 'orgs', S.org, 'serviceAppointments', 'apOil'), { status: 'done' }), 'permission-denied');
  await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'serviceAppointments', 'apOil')), 'permission-denied');

  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (x) => ch.push(x));
    req.on('end', () => { got.push(JSON.parse(Buffer.concat(ch).toString() || '{}')); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { status: 'ok', id: 't' } })); });
  });
  await new Promise((ok) => srv.listen(0, HOST, ok));
  try {
    await adminDb().doc(`users/${S.mgr.uid}/push/appt`).set({ expo: 'ExponentPushToken[dddddddddddddddddddddd]', platform: 'ios', createdAt: Date.now(), device: 'test', expoUrl: `http://${HOST}:${srv.address().port}/expo/appt` });
    const cr = await appCreator('Andy Appt');
    await fails(S.own.call('appointmentSweepNow', {}), 'permission-denied');
    const forIt = () => got.filter((m) => m.data?.url === `/vehicle/${va}?tab=service`);
    // A minute before the reminder: nothing. At its time: the station's fleet manager, with the plate and the garage.
    await cr.call('appointmentSweepNow', { now: a1.remindAt - 60_000 });
    assert.equal(forIt().length, 0);
    await cr.call('appointmentSweepNow', { now: a1.remindAt + 60_000 });
    assert.equal(forIt().length, 1);
    assert.match(forIt()[0].title, /AP-1/);
    assert.match(forIt()[0].body, /Autohaus Ost/);
    // Once.
    await cr.call('appointmentSweepNow', { now: a1.remindAt + 120_000 });
    assert.equal(forIt().length, 1);
    const a2 = await appt(S.own, 'apOil');
    assert.equal(a2.remindAt, null);
    assert.ok(a2.remindedAt);
    // The garage moved it: the manager changes it. What it was before is kept with who changed it; a new reminder.
    const mv = await call(S.mgr, { ...book, action: 'move', day: later, time: '14:30', remind: 180 });
    assert.deepEqual(mv.changed.sort(), ['day', 'remind', 'time']);
    const a3 = await appt(S.own, 'apOil');
    assert.equal(a3.day, later);
    assert.equal(a3.changes.length, 1);
    assert.deepEqual(a3.changes[0].was, { day, time: '10:00', remind: 1440 });
    assert.equal(a3.changes[0].byName, 'Max Manager');
    assert.equal(a3.remindAt, a3.at - 3 * 3600_000);
    assert.equal(a3.remindedAt, null);
    assert.equal((await call(S.mgr, { ...book, action: 'move', day: later, time: '14:30', remind: 180 })).unchanged, true);
    // The van follows the move.
    assert.equal((await visit()).day, later);
    assert.equal((await visit()).time, '14:30');
    await fails(call(S.d1, { ...book, action: 'move', day: later }), 'permission-denied');
    await cr.call('appointmentSweepNow', { now: a3.remindAt + 60_000 });
    assert.equal(forIt().length, 2);
  } finally {
    await adminDb().doc(`users/${S.mgr.uid}/push/appt`).delete().catch(() => {});
    srv.close();
  }

  // Done: the service filled in from it is recorded as usual and marks it done, linked both ways. Then it can't be
  // moved or cancelled.
  const svc = await S.mgr.call('service', { orgId: S.org, action: 'add', id: 'svcFromAppt', vehicleId: va, kind: 'service', day: berlinDay(Date.now()), km: 30500, cost: 250, garage: 'Autohaus Ost', appointmentId: 'apOil' });
  assert.equal(svc.appointmentDone, true);
  const a4 = await appt(S.own, 'apOil');
  assert.equal(a4.status, 'done');
  assert.equal(a4.serviceId, 'svcFromAppt');
  assert.equal(a4.doneByName, 'Max Manager');
  assert.equal(a4.remindAt, null);
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'services', 'svcFromAppt'))).data().appointmentId, 'apOil');
  assert.equal(await visit(), null, 'done: the van no longer shows it');
  await fails(call(S.mgr, { ...book, action: 'move', time: '16:00' }), 'failed-precondition');
  await fails(call(S.mgr, { action: 'cancel', id: 'apOil' }), 'failed-precondition');
  // Cancelled: kept, with who and why; no reminder. Cancelling again changes nothing; a cancelled one isn't moved.
  // Booked for managers and owners only: drivers don't see it on the van.
  await call(S.own, { ...book, id: 'apTyres', kind: 'tyres', remind: 60, drivers: false });
  assert.equal(await visit(), null);
  assert.equal((await appt(S.own, 'apTyres')).drivers, false);
  await call(S.mgr, { action: 'cancel', id: 'apTyres', reason: 'The garage cancelled' });
  const c1 = await appt(S.own, 'apTyres');
  assert.equal(c1.status, 'cancelled');
  assert.equal(c1.reason, 'The garage cancelled');
  assert.equal(c1.cancelledByName, 'Max Manager');
  assert.equal(c1.remindAt, null);
  assert.equal((await call(S.mgr, { action: 'cancel', id: 'apTyres' })).unchanged, true);
  await fails(call(S.mgr, { ...book, id: 'apTyres', kind: 'tyres', action: 'move', time: '11:00' }), 'failed-precondition');
  // A service from a cancelled appointment is still recorded; the appointment stays cancelled.
  const svc2 = await S.mgr.call('service', { orgId: S.org, action: 'add', id: 'svcFromCancelled', vehicleId: va, kind: 'tyres', day: berlinDay(Date.now()), km: 30600, appointmentId: 'apTyres' });
  assert.equal(svc2.appointmentDone, false);
  assert.equal((await appt(S.own, 'apTyres')).status, 'cancelled');
  // The appointments go with the van to another station: its new managers see them, the old ones don't.
  // Cancelled: the van no longer shows it.
  await call(S.own, { ...book, id: 'apGone', kind: 'repair' });
  assert.equal((await visit()).id, 'apGone');
  await call(S.own, { action: 'cancel', id: 'apGone', reason: 'garage closed' });
  assert.equal(await visit(), null, 'cancelled: the van no longer shows it');
  await call(S.own, { ...book, id: 'apBrakes', kind: 'brakes' });
  assert.equal((await visit()).id, 'apBrakes');
  // Switched to "Only managers and owners" with a move: drivers stop seeing it; switched back, they see it again.
  await call(S.mgr, { ...book, id: 'apBrakes', kind: 'brakes', action: 'move', drivers: false });
  assert.equal(await visit(), null, 'managers and owners only');
  await call(S.mgr, { ...book, id: 'apBrakes', kind: 'brakes', action: 'move', drivers: true });
  assert.equal((await visit()).id, 'apBrakes');
  await S.own.call('moveVan', { orgId: S.org, vehicleId: va, stationId: S.s2 });
  assert.equal((await appt(S.own, 'apBrakes')).stationId, S.s2);
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'serviceAppointments', 'apBrakes')), 'permission-denied');
  await fails(call(S.mgr, { action: 'cancel', id: 'apBrakes' }), 'permission-denied');
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: S.vans.v2.id, driverId: S.d1.uid });
});

test('the company\'s names: owners and managers read them, each person their own, nobody writes them; a name change follows', async () => {
  const names = async (p) => (await getDocs(collection(p.db, 'orgs', S.org, 'names'))).docs.map((d) => [d.id, d.data().name]);
  // Filled by the server from the people (a trigger), and kept when someone leaves.
  const all = await waitFor(async () => { const n = new Map(await names(S.mgr)); return n.size >= 5 ? n : null; }, 'the names of everyone in the company');
  assert.equal(all.get(S.d1.uid), 'Dana Driver');
  assert.equal(all.get(S.d3.uid), 'Fay Driver', 'managers list the company\'s people anyway (members), so they read every name');
  assert.equal(new Map(await names(S.own)).get(S.mgr.uid), 'Max Manager');
  // A driver: only their own.
  assert.equal((await getDoc(doc(S.d1.db, 'orgs', S.org, 'names', S.d1.uid))).data().name, 'Dana Driver');
  await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'names', S.d2.uid)), 'permission-denied');
  await fails(getDocs(collection(S.d1.db, 'orgs', S.org, 'names')), 'permission-denied');
  await fails(getDoc(doc(S.d3.db, 'orgs', S.org, 'names', S.d1.uid)), 'permission-denied');
  // Written only by the server: not by the owner, not by the person.
  await fails(setDoc(doc(S.own.db, 'orgs', S.org, 'names', S.d1.uid), { name: 'Someone', at: Date.now() }), 'permission-denied');
  await fails(setDoc(doc(S.d1.db, 'orgs', S.org, 'names', S.d1.uid), { name: 'Someone', at: Date.now() }), 'permission-denied');
  await fails(deleteDoc(doc(S.own.db, 'orgs', S.org, 'names', S.d1.uid)), 'permission-denied');
  // A name changed on the person follows (and goes back).
  const m = adminDb().doc(`orgs/${S.org}/members/${S.d3.uid}`);
  await m.update({ name: 'Fay Newname' });
  await waitFor(async () => (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'names', S.d3.uid))).data()?.name === 'Fay Newname', 'the changed name');
  await m.update({ name: 'Fay Driver' });
  await waitFor(async () => (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'names', S.d3.uid))).data()?.name === 'Fay Driver', 'the name back');
});

test('names written before go to the company\'s names and out of what drivers read (Deploy runs this once per company)', async () => {
  const a = adminDb();
  const now = Date.now();
  const van = a.collection(`orgs/${S.org}/vehicles`).doc();
  const chk = a.collection(`orgs/${S.org}/checks`).doc();
  const asg = a.collection(`orgs/${S.org}/assignments`).doc();
  const buyR = a.collection(`orgs/${S.org}/purchases`).doc();
  const tour = a.collection(`orgs/${S.org}/tours`).doc();
  const log = a.collection(`orgs/${S.org}/damageLog`).doc(chk.id);
  // As the server wrote them before 20 Nov 2026, with a name of someone who isn't in the company any more.
  const gone = 'gone' + run;
  await van.set({ name: 'Van old', plate: 'OLD1', cls: 'van', stationId: S.s1, createdAt: now, createdBy: S.own.uid, retired: true,
    assignedTo: { assignmentId: 'old', driverId: S.d2.uid, driverName: 'Erik Driver', since: now - 3600_000 },
    dash: { km: 1000, fuelPct: 50, batteryPct: null, rangeKm: null, warnings: [], at: now, by: S.d2.uid, byName: 'Erik Driver', from: 'tour' },
    routines: { oldOil: { at: now, by: gone, byName: 'Lou Left', ok: true, note: null } } });
  await chk.set({ vehicleId: van.id, vehicleName: 'Van old', stationId: S.s1, createdAt: now, createdBy: S.d2.uid, createdByName: 'Erik Driver', status: 'reviewed', spots: [], photos: 0 });
  await asg.set({ vehicleId: van.id, vehicleName: 'Van old', plate: 'OLD1', driverId: S.d1.uid, driverName: 'Dana Driver', stationId: S.s1, start: now - 7200_000, end: now - 3600_000,
    startedBy: S.mgr.uid, startedByName: 'Max Manager', endedBy: S.d2.uid, endedByName: 'Erik Driver', endReason: 'taken over' });
  await buyR.set({ kind: 'fuel', vehicleId: van.id, vehicleName: 'Van old', plate: 'OLD1', stationId: S.s1, by: S.d1.uid, byName: 'Dana Driver', status: 'done', createdAt: now,
    vanDriverId: S.d2.uid, vanDriverName: 'Erik Driver', notTheirVan: true,
    flags: [{ key: 'van', text: 'Erik Driver has this van, not Dana Driver.', t: '{driver} has this van, not {name}.', v: { driver: 'Erik Driver', name: 'Dana Driver' } }] });
  await tour.set({ driverId: S.d1.uid, driverName: 'Dana Driver', vehicleId: van.id, vehicleName: 'Van old', plate: 'OLD1', stationId: S.s1, startAt: now - 7200_000, createdAt: now, open: false,
    start: { readingId: 'r0', at: now - 7200_000, km: 900, fuelPct: 60, batteryPct: null, by: S.d1.uid, byName: 'Dana Driver' },
    end: { readingId: 'r1', at: now - 3600_000, km: 1000, fuelPct: 50, batteryPct: null, by: S.d2.uid, byName: 'Erik Driver' }, endedHow: 'next' });
  await log.set({ checkId: chk.id, vehicleId: van.id, vehicleName: 'Van old', stationId: S.s1, foundAt: now, from: now - 7200_000, n: 1,
    drivers: [{ id: S.d1.uid, name: 'Dana Driver' }, { id: gone, name: 'Lou Left' }], driverIds: [S.d1.uid, gone], createdAt: now });
  try {
    const split = () => execFileSync(process.execPath, [new URL('../functions/scripts/driver-names.cjs', import.meta.url).pathname],
      { env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || `${HOST}:8080`, PROJECT: cfg.projectId }, encoding: 'utf8' });
    assert.match(split(), /took names out of \d+ record/);
    // Nothing a driver reads says who else: not on the van, the check, Dana's assignment, refuel, tour or damage log line.
    // Erik's van and check Dana doesn't read at all (drivers read only the van they have and their own checks: blind
    // test, cause 3a); the names are out of them all the same.
    await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'vehicles', van.id)), 'permission-denied');
    await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'checks', chk.id)), 'permission-denied');
    const v = (await van.get()).data();
    assert.equal(v.assignedTo.driverId, S.d2.uid);
    assert.equal(v.dash.by, S.d2.uid);
    assert.equal(v.routines.oldOil.by, gone);
    const k = (await chk.get()).data();
    assert.equal(k.createdBy, S.d2.uid);
    const x = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'assignments', asg.id))).data();
    assert.equal(x.endedBy, S.d2.uid);
    assert.equal(x.startedByName, 'Max Manager', 'the managers\' names on a driver\'s own things stay');
    const b = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'purchases', buyR.id))).data();
    assert.deepEqual(b.flags.map((f) => [f.t, f.v]), [['{name} doesn\'t have this van.', { name: 'Dana Driver' }]]);
    const tr = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'tours', tour.id))).data();
    assert.equal(tr.end.by, S.d2.uid);
    const l = (await getDoc(doc(S.d1.db, 'orgs', S.org, 'damageLog', log.id))).data();
    assert.deepEqual(l.drivers, [{ id: S.d1.uid }, { id: gone }]);
    for (const r of [v, k, x, b, tr, l]) assert.ok(!/Erik Driver|Lou Left/.test(JSON.stringify(r)), JSON.stringify(r));
    // Owners and managers keep every name, also of people who left.
    assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'names', gone))).data().name, 'Lou Left');
    assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'names', S.d2.uid))).data().name, 'Erik Driver');
    // Each company once.
    assert.ok((await a.doc(`orgs/${S.org}`).get()).data().namesSplit);
    assert.match(split(), /No companies to change/);
  } finally {
    await Promise.all([van, chk, asg, buyR, tour, log].map((r) => r.delete()));
  }
});

test('drivers read no other driver\'s name anywhere they can read; only their own and their managers\'', async () => {
  const others = ['Erik Driver', 'Fay Driver', 'Lou Left'];
  const me = S.d1;
  const q = (name, ...w) => getDocs(query(collection(me.db, 'orgs', S.org, name), ...w));
  const reads = await Promise.all([
    // The driver's lists (blind test, cause 3a: the van she has, the checks of her photos, the walk-arounds she took).
    q('vehicles', where('assignedTo.driverId', '==', me.uid)), q('checks', where('walkBy', '==', me.uid)), q('walkarounds', where('createdBy', '==', me.uid)),
    q('assignments', where('driverId', '==', me.uid)), q('tours', where('driverId', '==', me.uid)), q('readings', where('driverId', '==', me.uid)),
    q('readings', where('by', '==', me.uid)), q('purchases', where('by', '==', me.uid)), q('routineDone', where('by', '==', me.uid)),
    q('damageLog', where('driverIds', 'array-contains', me.uid)), q('videos', where('by', '==', me.uid)), q('incidents', where('driverId', '==', me.uid)),
    q('stations'), q('routines'),
  ]);
  const docs = reads.flatMap((r) => r.docs.map((d) => [d.ref.path, d.data()]));
  docs.push(['org', (await getDoc(doc(me.db, 'orgs', S.org))).data()]);
  assert.ok(docs.length > 20, `read ${docs.length} records`);
  // The station's lists aren't hers to read any more.
  for (const c of ['vehicles', 'checks', 'walkarounds']) await fails(q(c, where('stationId', 'in', [S.s1])), 'permission-denied');
  // Erik took over a van from her: that ended assignment is among what she reads.
  assert.ok(docs.some(([, d]) => d.createdBy === S.d2.uid || d.assignedTo?.driverId === S.d2.uid || d.endedBy === S.d2.uid), 'something Erik did is in what Dana reads');
  for (const [path, d] of docs) {
    const text = JSON.stringify(d);
    for (const n of others) assert.ok(!text.includes(n), `${path} shows ${n}: ${text.slice(0, 400)}`);
  }
});

test('a call sent twice (the phone lost the answer, or sent it again offline) is done once', async () => {
  const R = (p, x) => p.call('routine', { orgId: S.org, ...x });
  const rid = () => `rid${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const count = async () => (await adminDb().collection(`orgs/${S.org}/routines`).get()).size;
  // The same request twice: one routine, the same answer.
  const before = await count();
  const r1 = rid();
  const a = await R(S.mgr, { action: 'save', key: null, name: 'Mirrors clean', how: 'daily', days: null, vans: 'all', stationId: S.s1, photo: false, rid: r1 });
  const b = await R(S.mgr, { action: 'save', key: null, name: 'Mirrors clean', how: 'daily', days: null, vans: 'all', stationId: S.s1, photo: false, rid: r1 });
  assert.equal(b.id, a.id);
  assert.equal(await count(), before + 1);
  // Twice at once (sent again while the first was still running): one set of invite links, the same for both.
  const r2 = rid();
  const [i1, i2] = await Promise.all([1, 2].map(() => S.own.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1, rid: r2 })));
  assert.deepEqual(i2.invites.map((x) => x.token), i1.invites.map((x) => x.token));
  // Ids are per person: the same id from someone else is their own request.
  const i3 = await S.mgr.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1, rid: r2 });
  assert.notEqual(i3.invites[0].token, i1.invites[0].token);
  // Nobody reads the kept answers from the app, not even their own.
  await fails(getDoc(doc(S.own.db, 'users', S.own.uid, 'requests', r2)), 'permission-denied');
  await fails(setDoc(doc(S.own.db, 'users', S.own.uid, 'requests', 'madeUpAnswer1'), { fn: 'assignVan', state: 'done', at: Date.now(), result: { ok: true } }), 'permission-denied');
  // A refused call keeps nothing: sent again, it's checked again (and refused again).
  const r3 = rid();
  await fails(R(S.mgr, { action: 'save', key: null, name: 'Other station', how: 'daily', days: null, vans: 'all', stationId: S.s2, photo: false, rid: r3 }), 'permission-denied');
  assert.equal((await adminDb().doc(`users/${S.mgr.uid}/requests/${r3}`).get()).exists, false);
  await fails(R(S.mgr, { action: 'save', key: null, name: 'Other station', how: 'daily', days: null, vans: 'all', stationId: S.s2, photo: false, rid: r3 }), 'permission-denied');
  // The same id for another kind of call, or a malformed id, is refused.
  await fails(S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: false, rid: r1 }), 'invalid-argument');
  await fails(R(S.mgr, { action: 'delete', id: a.id, rid: 'x' }), 'invalid-argument');
  // Removing it twice: done once, both answered.
  const r4 = rid();
  await R(S.mgr, { action: 'delete', id: a.id, rid: r4 });
  assert.deepEqual(await R(S.mgr, { action: 'delete', id: a.id, rid: r4 }), { ok: true });
  assert.equal(await count(), before);
  // Giving a van, sent from a phone that was offline: refused if someone changed who has it meanwhile.
  const { v3 } = S.vans;
  const now = (await adminDb().doc(`orgs/${S.org}/vehicles/${v3.id}`).get()).data().assignedTo?.assignmentId ?? null;
  await fails(S.own.call('assignVan', { orgId: S.org, vehicleId: v3.id, driverId: null, expect: now ? null : 'someoneElsesHandover', rid: rid() }), 'failed-precondition');
  // Kept answers are deleted after a week by the daily clean-up.
  const { cleanRequests } = fnRequire('./lib/once.js');
  await adminDb().doc(`users/${S.mgr.uid}/requests/${r1}`).update({ until: Date.now() - 1 });
  assert.ok((await cleanRequests(Date.now(), adminDb())) >= 1);
  assert.equal((await adminDb().doc(`users/${S.mgr.uid}/requests/${r1}`).get()).exists, false);
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

test('the demo company: only the app creator opens one; a driver login with a van, history, and pick-up at the first station', async () => {
  // Customers don't get a demo company (product owner, 2026-11-02), owners included.
  await fails((await person('Xavi Customer')).call('createDemoCompany', {}), 'permission-denied');
  await fails(S.own.call('createDemoCompany', {}), 'permission-denied');
  const me = await appCreator('Demo Tester');
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
  // Refuels with receipts, washes, a parts purchase, one allowed and one refused card, and a driver at the pump now.
  const buys = (await getDocs(collection(me.db, 'orgs', orgId, 'purchases'))).docs.map((d) => d.data());
  assert.ok(buys.filter((b) => b.kind === 'fuel' && b.status === 'done').length >= 10, 'demo refuels');
  assert.ok(buys.some((b) => b.kind === 'wash') && buys.some((b) => b.kind === 'parts'));
  assert.equal(buys.filter((b) => b.status === 'waiting').length, 1);
  assert.ok(buys.some((b) => b.decision?.allow === true) && buys.some((b) => b.decision?.allow === false));
  assert.ok(buys.some((b) => b.flags.some((f) => f.key === 'litres')), 'one refuel with more litres than the tank had room for');
  // Each van shows its km from the latest photo, and each driver's earlier times with a van their km.
  assert.ok(typeof (await getDoc(doc(alex.db, 'orgs', orgId, 'vehicles', open[0].vehicleId))).data().dash?.km === 'number');
  assert.ok(mine.some((a) => a.end != null && a.kmEnd > a.kmStart), 'km from and to on the demo driver\'s history');
  const van = { id: open[0].vehicleId, name: open[0].vehicleName, stationId: open[0].stationId };
  await alex.call('dropOffVan', { orgId, vehicleId: van.id, walkId: await photos(alex, orgId, van) });
  const v = (await getDoc(doc(me.db, 'orgs', orgId, 'vehicles', van.id))).data();
  assert.equal(v.assignedTo, null);
  await fails(getDoc(doc(alex.db, 'orgs', orgId, 'vehicles', van.id)), 'permission-denied');
  await me.call('deleteDemoCompany', { orgId });
  await fails(person(null, login.email, login.password));
});

test('the website request form: stored for the team, spam and bad input refused, a daily limit per connection', async () => {
  const url = `http://${HOST}:5001/${cfg.projectId}/us-central1/websiteSignup`;
  // What the server stored (read past the rules, as the Firebase console does).
  const stored = async () => {
    const r = await fetch(`http://${HOST}:8080/v1/projects/${cfg.projectId}/databases/(default)/documents/siteRequests?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
    return ((await r.json()).documents || []).map((d) => d.fields);
  };
  const send = (body, ip = '203.0.113.7') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  const good = {
    plan: 'pro', aiWaitlist: true, lang: 'ro', company: `Spree Logistik ${run}`, country: 'Germany', stations: 5, vans: 64,
    firstName: 'Ana', lastName: 'Popescu', email: 'ana@spree.de', phone: '+49 151 2345 6789', website: '', elapsed: 25_000,
  };
  const before = (await stored()).length;
  let r = await send(good);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const all = await stored();
  assert.equal(all.length, before + 1);
  const mine = all.find((f) => f.company?.stringValue === good.company);
  assert.ok(mine, 'the request is stored');
  assert.equal(mine.plan.stringValue, 'pro');
  assert.equal(mine.vans.integerValue, '64');
  assert.equal(mine.aiWaitlist.booleanValue, true);
  assert.equal(mine.lang.stringValue, 'ro', 'the website language the form was sent in');
  assert.equal(mine.mailed.booleanValue, false, 'no email without SMTP_URL');
  assert.equal(mine.welcomed.booleanValue, false, 'no welcome email without SMTP_URL');
  assert.ok(!('website' in mine) && !('elapsed' in mine), 'only the request itself is kept');
  // A filled hidden field or a form sent faster than a person types: answered "sent", nothing kept.
  assert.equal((await send({ ...good, website: 'https://spam.example' })).status, 200);
  assert.equal((await send({ ...good, elapsed: 400 })).status, 200);
  assert.equal((await stored()).length, before + 1);
  // Wrong input gets a message the form shows; only POST is answered.
  r = await send({ ...good, email: 'not-an-email' }, '203.0.113.8');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /email/);
  assert.equal((await send({ ...good, plan: 'gold' }, '203.0.113.8')).status, 400);
  assert.equal((await fetch(url)).status, 405);
  // Five a day from one connection; another connection still gets through.
  for (let i = 0; i < 4; i++) assert.equal((await send(good)).status, 200);
  r = await send(good);
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /info@fratius\.com/);
  assert.equal((await send(good, '203.0.113.9')).status, 200);
  // Nobody reads the requests from the app.
  const owner = await person('Website Visitor');
  await fails(getDocs(collection(owner.db, 'siteRequests')));
});

test('people delete their own account: login and profile go, the company keeps its history with their name', async () => {
  // A driver who has a van.
  const { invites } = await S.own.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
  const gus = await person('Gus Gone');
  await gus.call('acceptInvite', { token: invites[0].token, details: { firstName: 'Gus', lastName: 'Gone', phone: '+49 151 9', transporterId: 'G1' } });
  const vr = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
  await setDoc(vr, { name: 'Van G', plate: 'GONE1', cls: 'van', stationId: S.s1, createdAt: Date.now(), createdBy: S.own.uid });
  const { assignmentId } = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: vr.id, driverId: gus.uid });
  // First what would happen; then the account goes.
  const plan = await gus.call('deleteAccount', { check: true });
  assert.deepEqual(plan.companies.map((c) => [c.id, c.outcome, c.role]), [[S.org, 'leave', 'driver']]);
  assert.deepEqual(await gus.call('deleteAccount', {}), { ok: true, closed: [] });
  await fails(person(null, `gus.${run}@test.dev`));
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org, 'members', gus.uid))).exists(), false);
  assert.equal((await adminDb().doc(`users/${gus.uid}`).get()).exists, false);
  // The handover ends ("deleted their account"), the van is free, the history keeps the name.
  const a = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'assignments', assignmentId))).data();
  assert.equal(a.endReason, 'account deleted');
  assert.equal(a.driverName, 'Gus Gone');
  assert.equal((await vanDoc(S.mgr, vr.id)).assignedTo, null);

  // The only fleet owner of a company with other people in it hands it over first. (The app lists a person's
  // companies on their profile, as it does when they create one.)
  await setDoc(doc(S.own.db, 'users', S.own.uid), { orgIds: [S.org], orgId: S.org }, { merge: true });
  const ownPlan = await S.own.call('deleteAccount', { check: true });
  assert.equal(ownPlan.companies.find((c) => c.id === S.org).outcome, 'blocked');
  await fails(S.own.call('deleteAccount', {}), 'failed-precondition');
  assert.equal((await getDoc(doc(S.own.db, 'orgs', S.org))).exists(), true);

  // Sam's own company: blocked while Dora is in it as a driver, fine once she's an owner too; when Dora, the last
  // member, deletes her account, the company goes with it.
  const sam = await person('Sam Solo');
  const org = doc(collection(sam.db, 'orgs'));
  await setDoc(org, { name: 'Solo DSP', createdBy: sam.uid, createdAt: Date.now(), stationsReady: true });
  await setDoc(doc(sam.db, 'orgs', org.id, 'members', sam.uid), { role: 'owner', stationIds: [], email: '', name: 'Sam Solo', joinedAt: Date.now() });
  const st = doc(collection(sam.db, 'orgs', org.id, 'stations'));
  await setDoc(st, { name: 'SOLO1', code: '', createdAt: Date.now() });
  await setDoc(doc(sam.db, 'users', sam.uid), { orgIds: [org.id], orgId: org.id }, { merge: true });
  assert.deepEqual((await sam.call('deleteAccount', { check: true })).companies.map((c) => c.outcome), ['close']);
  const inv = await sam.call('createInvite', { orgId: org.id, role: 'driver', stationId: st.id, count: 1 });
  const dora = await person('Dora Next');
  await dora.call('acceptInvite', { token: inv.invites[0].token, details: { firstName: 'Dora', lastName: 'Next', phone: '+49 151 8', transporterId: 'D1' } });
  assert.deepEqual((await sam.call('deleteAccount', { check: true })).companies.map((c) => c.outcome), ['blocked']);
  await sam.call('changePerson', { orgId: org.id, uid: dora.uid, role: 'owner' });
  assert.deepEqual((await sam.call('deleteAccount', { check: true })).companies.map((c) => c.outcome), ['leave']);
  await sam.call('deleteAccount', {});
  assert.equal((await getDoc(doc(dora.db, 'orgs', org.id))).exists(), true);
  assert.deepEqual(await dora.call('deleteAccount', {}), { ok: true, closed: ['Solo DSP'] });
  // Closed, not deleted, since 26 Nov 2026 (cause 2b, B7: the records stay; tested at the end).
  assert.ok((await adminDb().doc(`orgs/${org.id}`).get()).data().closed.at > 0);

  // A demo company goes with the account of whoever made it, demo logins included.
  // (Made while she was the app creator: only the app creator opens a demo; app creators can't delete their account.)
  const dee = await appCreator('Dee Demo');
  const { orgId: demoId } = await dee.call('createDemoCompany', {});
  await setCreator(dee, false);
  const login = (await getDoc(doc(dee.db, 'orgs', demoId))).data().demoLogins[0];
  assert.deepEqual((await dee.call('deleteAccount', { check: true })).companies.map((c) => [c.outcome, c.demo]), [['close', true]]);
  await dee.call('deleteAccount', {});
  assert.equal((await adminDb().doc(`orgs/${demoId}`).get()).exists, false);
  await fails(person(null, login.email, login.password));

  // The app creator's account isn't deleted from the app.
  const cr = await appCreator('Cy Creator');
  await fails(cr.call('deleteAccount', {}), 'failed-precondition');
});

test('photos and videos: deleted on the 15th for the month before, never while the van is held, damage after 90 days; the records stay', async () => {
  // Vans of their own (earlier tests moved van 1 to station 2).
  const van = async (name, st) => {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(r, { name, plate: name.replace(/\W/g, ''), cls: 'van', stationId: S[st], createdAt: Date.now(), createdBy: S.own.uid });
    return { id: r.id, name, stationId: S[st] };
  };
  const v1 = await van('Van K1', 's1'), v2 = await van('Van K2', 's1'), v3 = await van('Van K3', 's2'), v4 = await van('Van K4', 's1');
  const DAY = 86_400_000;
  const { deleteOn, cutoff } = fnRequire('./lib/media.js');
  const T0 = Date.now();
  // The run that deletes this month's files: the 15th of next month (never before 15 December 2026), at 04:00.
  const run1 = deleteOn(T0) + 4 * 3_600_000;
  const exists = async (path) => { try { await getBytes(ref(S.own.st, path)); return true; } catch { return false; } };
  const walkFile = (id) => `orgs/${S.org}/walkarounds/${id}/01.jpg`;
  // Hal has van K4: nothing of it is deleted while he has it.
  const inv = await S.mgr.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
  const hal = await person('Hal Holder');
  await hal.call('acceptInvite', { token: inv.invites[0].token, details: { firstName: 'Hal', lastName: 'Holder', phone: '+49 151 9', transporterId: 'H1' } });
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v4.id, driverId: hal.uid });
  const held = await photos(hal, S.org, v4);
  const plain = await photos(S.d1, S.org, v1);
  const marked = await photos(S.d1, S.org, v1);
  const other = await photos(S.own, S.org, v3);
  // Only owners and the station's managers mark photos or videos as damage.
  await fails(S.d1.call('markDamage', { orgId: S.org, kind: 'walk', id: marked }), 'permission-denied');
  await fails(S.mgr.call('markDamage', { orgId: S.org, kind: 'walk', id: other }), 'permission-denied');
  const r = await S.mgr.call('markDamage', { orgId: S.org, kind: 'walk', id: marked });
  const mw = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'walkarounds', marked))).data();
  assert.equal(r.keepUntil, mw.createdAt + 90 * DAY);
  assert.equal(mw.keepMark.by, S.mgr.uid);
  // Taking the mark off, and on again.
  assert.equal((await S.mgr.call('markDamage', { orgId: S.org, kind: 'walk', id: marked, on: false })).keepUntil, null);
  await S.own.call('markDamage', { orgId: S.org, kind: 'walk', id: marked });
  // Damage approved in a review keeps the walk-around it was found in and the one before it.
  const before = await photos(S.d1, S.org, v2);
  await new Promise((res) => setTimeout(res, 1500));
  const found = await photos(S.d1, S.org, v2);
  const k = adminDb().collection(`orgs/${S.org}/checks`).doc();
  await k.set({ vehicleId: v2.id, vehicleName: v2.name, stationId: S.s1, walkId: found, createdAt: Date.now(), createdBy: S.d1.uid, status: 'reviewed',
    spots: [{ panel: 'door' }], review: { decisions: { 0: { damage: true, known: null } }, manual: [], at: Date.now() } });
  const closeup = `orgs/${S.org}/checks/${k.id}/spot1_1_x.jpg`;
  await uploadBytes(ref(S.d1.st, closeup), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
  await S.mgr.call('logReview', { orgId: S.org, checkId: k.id });
  for (const id of [before, found]) assert.deepEqual((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'walkarounds', id))).data().keepDamage, [k.id]);
  assert.ok((await k.get()).data().keepUntil > T0 + 80 * DAY);
  // Videos: the original goes once the playback copy is made; one is marked as damage. A phone camera's video
  // (larger than 720p) is converted; the app's own 720p H.264 recording is only repackaged.
  const keepV = await video(S.d1, { size: '1280x960' });
  await S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: keepV });
  await S.d1.call('processVideo', { orgId: S.org, videoId: keepV });
  const kv = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', keepV))).data();
  assert.equal(kv.converted, 'converted');
  assert.equal(kv.originalDeleted, true);
  assert.equal(await exists(kv.path), false);
  assert.equal(await exists(kv.playPath), true);
  await fails(S.d1.call('markDamage', { orgId: S.org, kind: 'video', id: keepV }), 'permission-denied');
  await S.mgr.call('markDamage', { orgId: S.org, kind: 'video', id: keepV });
  const dropV = await video(S.d1);
  await S.d1.call('addVanVideo', { orgId: S.org, vehicleId: v1.id, videoId: dropV });
  await S.d1.call('processVideo', { orgId: S.org, videoId: dropV });
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', dropV))).data().converted, 'repackaged');
  const dash = `orgs/${S.org}/dash/${S.d1.uid}/old.jpg`;
  await uploadBytes(ref(S.d1.st, dash), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
  // Each van's newest walk-around keeps its photos until a newer one is taken (product owner, 2026-11-20: the next
  // walk-around is compared with it). Van K3 gets a newer one, so the one before follows the 15th.
  await new Promise((res) => setTimeout(res, 1100));
  const other2 = await photos(S.own, S.org, v3);

  // Before the 15th nothing of this month goes. Only the app creator runs the clean-up by hand.
  await fails(S.own.call('cleanMediaNow', { orgId: S.org }), 'permission-denied');
  const cr = await appCreator('Kai Keeper');
  const early = await cr.call('cleanMediaNow', { orgId: S.org, now: run1 - DAY });
  assert.ok(early.cutoff === null || early.cutoff <= T0, JSON.stringify(early));
  for (const id of [plain, other, held]) assert.equal(await exists(walkFile(id)), true, `walk-around ${id} waits for the 15th`);
  assert.equal(await exists(dash), true);
  // On the 15th of next month: this month's files go, except damage and everything of the van Hal still has.
  const res = await cr.call('cleanMediaNow', { orgId: S.org, now: run1 });
  assert.ok(res.cutoff > T0 && res.cutoff === cutoff(run1), JSON.stringify(res));
  assert.ok(res.deleted > 0 && res.kept > 0 && res.held > 0, JSON.stringify(res));
  assert.equal(await exists(walkFile(plain)), false);
  assert.equal(await exists(walkFile(other)), false);
  assert.equal(await exists(dash), false);
  assert.equal(await exists(`orgs/${S.org}/videos/${S.d1.uid}/${dropV}/play.mp4`), false);
  for (const id of [marked, before, found, held]) assert.equal(await exists(walkFile(id)), true, `walk-around ${id} is kept`);
  assert.equal(await exists(walkFile(other2)), true, 'van K3\'s newest walk-around is kept');
  assert.equal(await exists(closeup), true);
  assert.equal(await exists(kv.playPath), true);
  // The records stay and say when their files went; a deleted walk-around can't be marked as damage any more.
  const pw = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'walkarounds', plain))).data();
  assert.equal(pw.mediaDeletedAt, run1);
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'videos', dropV))).data().mediaDeletedAt, run1);
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'walkarounds', held))).data().mediaDeletedAt, undefined);
  await fails(S.mgr.call('markDamage', { orgId: S.org, kind: 'walk', id: plain }), 'failed-precondition');
  // Hal gives the van back: from then on its files count from that day, so they go at the run after, once a newer
  // walk-around of the van is there.
  await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v4.id, driverId: null });
  await cr.call('cleanMediaNow', { orgId: S.org, now: run1 });
  assert.equal(await exists(walkFile(held)), true, 'van K4\'s newest walk-around stays');
  const held2 = await photos(S.mgr, S.org, v4);
  await cr.call('cleanMediaNow', { orgId: S.org, now: run1 });
  assert.equal(await exists(walkFile(held)), false);
  assert.equal(await exists(walkFile(held2)), true);
  // 90 days on, at the next 15th, the damage goes too, except the newest walk-around of each van: newer ones of vans
  // K1 and K2 are taken first.
  const plain2 = await photos(S.d1, S.org, v1), found2 = await photos(S.d1, S.org, v2);
  await cr.call('cleanMediaNow', { orgId: S.org, now: deleteOn(T0 + 91 * DAY) + 4 * 3_600_000 });
  for (const p of [walkFile(marked), walkFile(found), walkFile(before), closeup, kv.playPath]) assert.equal(await exists(p), false, p);
  for (const id of [plain2, found2, held2, other2]) assert.equal(await exists(walkFile(id)), true, `walk-around ${id} is its van's newest`);
  assert.ok((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'checks', k.id))).exists());
  // A retired van needs nothing to compare with: its newest walk-around follows the 15th like the rest.
  await S.own.call('retireVan', { orgId: S.org, vehicleId: v3.id });
  await cr.call('cleanMediaNow', { orgId: S.org, now: deleteOn(T0 + 91 * DAY) + 4 * 3_600_000 });
  assert.equal(await exists(walkFile(other2)), false);
});

test('the store app gets notifications through Expo\'s push service; a phone without the app is forgotten', async () => {
  // Expo's push service, on this computer: it keeps what arrives; /gone answers like a phone the app was removed from.
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => {
      got.push({ url: req.url, body: JSON.parse(Buffer.concat(ch).toString() || '{}') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: req.url.endsWith('/gone') ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket-1' } }));
    });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  const port = srv.address().port;
  try {
    const { invites } = await S.own.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
    const nia = await person('Nia Notify');
    await nia.call('acceptInvite', { token: invites[0].token, details: { firstName: 'Nia', lastName: 'Notify', phone: '+49 151 7', transporterId: 'N1' } });
    // The app saves its token (the rules check it); the test points it at the stand-in, past the rules.
    const token = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
    await setDoc(doc(nia.db, 'users', nia.uid, 'push', 'here'), { expo: token, platform: 'ios', createdAt: Date.now(), device: 'iPhone, Fratius app' });
    const col = adminDb().collection(`users/${nia.uid}/push`);
    await col.doc('here').update({ expoUrl: `http://${HOST}:${port}/expo/here` });
    await col.doc('gone').set({ expo: 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]', platform: 'android', createdAt: Date.now(), device: 'old phone', expoUrl: `http://${HOST}:${port}/expo/gone` });
    const vr = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(vr, { name: 'Van N', plate: 'NOTE1', cls: 'van', stationId: S.s1, createdAt: Date.now(), createdBy: S.own.uid });
    const r = await S.mgr.call('assignVan', { orgId: S.org, vehicleId: vr.id, driverId: nia.uid });
    assert.equal(r.notified, 1);
    const m = got.find((g) => g.url === '/expo/here');
    assert.ok(m, 'the notification reached the push service');
    assert.equal(m.body.to, token);
    assert.equal(m.body.data.url, `/vehicle/${vr.id}`);
    assert.match(m.body.body, /NOTE1/); // vans are called by their plate
    assert.equal((await col.doc('gone').get()).exists, false);
    assert.equal((await col.doc('here').get()).exists, true);
  } finally {
    srv.close();
  }
});

test('sign-up: a new company gets 30 days free from the server; the owner can\'t change it; the trial\'s AI has a daily allowance', async () => {
  const o = await person('Nora Neu');
  const input = { company: '  Neu Logistik GmbH ', station: 'DNX1', mainStation: 'Hauptstation', name: 'Nora Neu', source: 'website', plan: 'pro', terms: '2026-11-20' };
  // The terms (AGB) and the data processing agreement (AVV) are accepted with their version.
  await fails(o.call('createCompany', { ...input, terms: null, rid: `rcc${run}0` }), 'failed-precondition');
  const r = await o.call('createCompany', { ...input, rid: `rcc${run}a` });
  // Sent twice (the answer got lost): one company.
  assert.equal((await o.call('createCompany', { ...input, rid: `rcc${run}a` })).orgId, r.orgId);
  const org = (await getDoc(doc(o.db, 'orgs', r.orgId))).data();
  assert.equal(org.name, 'Neu Logistik GmbH');
  assert.equal(org.createdBy, o.uid);
  assert.equal(org.billing.status, 'trialing');
  assert.equal(org.billing.source, 'website');
  assert.equal(org.billing.plan, 'pro');
  assert.equal(org.billing.trialEnd - org.billing.trialStart, 30 * 86400_000);
  assert.equal(r.trialEnd, org.billing.trialEnd);
  const m = (await getDoc(doc(o.db, 'orgs', r.orgId, 'members', o.uid))).data();
  assert.equal(m.role, 'owner');
  assert.equal(m.name, 'Nora Neu');
  const st = (await getDocs(collection(o.db, 'orgs', r.orgId, 'stations'))).docs.map((d) => d.data().name);
  assert.deepEqual(st, ['DNX1']);
  const u = (await getDoc(doc(o.db, 'users', o.uid))).data();
  assert.equal(u.orgId, r.orgId);
  assert.ok(u.orgIds.includes(r.orgId));
  // The trial is the server's.
  await fails(updateDoc(doc(o.db, 'orgs', r.orgId), { billing: { ...org.billing, trialEnd: org.billing.trialEnd + 365 * 86400_000 } }), 'permission-denied');
  await fails(updateDoc(doc(o.db, 'orgs', r.orgId), { 'billing.status': 'active' }), 'permission-denied');
  await updateDoc(doc(o.db, 'orgs', r.orgId), { name: 'Neu Logistik' });
  // Bad input, and a plan that doesn't exist.
  await fails(o.call('createCompany', { ...input, company: '   ', rid: `rcc${run}b` }), 'invalid-argument');
  const r2 = await o.call('createCompany', { ...input, station: '', plan: 'gold', source: 'app', rid: `rcc${run}c` });
  const org2 = (await getDoc(doc(o.db, 'orgs', r2.orgId))).data();
  assert.equal(org2.billing.plan, null);
  assert.equal(org2.billing.source, 'app');
  assert.deepEqual((await getDocs(collection(o.db, 'orgs', r2.orgId, 'stations'))).docs.map((d) => d.data().name), ['Hauptstation']);
  // Three companies per person; more on request.
  await o.call('createCompany', { ...input, rid: `rcc${run}d` });
  const e = await fails(o.call('createCompany', { ...input, rid: `rcc${run}e` }), 'resource-exhausted');
  assert.match(e.message, /up to 3 companies/);

  // The AI allowance: counted per day (German time), refused once today's are used, with the template for the app.
  const van = doc(collection(o.db, 'orgs', r.orgId, 'vehicles'));
  const stationId = (await getDocs(collection(o.db, 'orgs', r.orgId, 'stations'))).docs[0].id;
  await setDoc(van, { name: 'Van N1', plate: 'N1', cls: 'van', stationId, createdAt: Date.now(), createdBy: o.uid });
  const v = { id: van.id, name: 'Van N1', stationId };
  await o.call('findDamage', { orgId: r.orgId, walkId: await photos(o, r.orgId, v, { real: true }), tier: 'default' });
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const counter = adminDb().doc(`orgs/${r.orgId}/aiDaily/${day}`);
  assert.equal((await counter.get()).data().checks, 1);
  await counter.set({ checks: 20 }, { merge: true });
  const walk = await photos(o, r.orgId, v, { real: true });
  const no = await fails(o.call('findDamage', { orgId: r.orgId, walkId: walk, tier: 'default' }), 'resource-exhausted');
  assert.equal(no.details.t, 'This company has used today\'s {n} AI damage checks of the free trial. More from midnight, or write to info@fratius.com for more.');
  assert.equal(no.details.v.n, 20);
  assert.equal((await counter.get()).data().checks, 20, 'a refused check isn\'t counted');
  // The app creator isn't held back, and companies set up by hand (before sign-up existed) have no allowance.
  const cr = await appCreator('Carl Creator');
  assert.ok((await cr.call('findDamage', { orgId: r.orgId, walkId: walk, tier: 'default' })).checkId);
  await adminDb().doc(`orgs/${S.org}`).update({ createdAt: Date.UTC(2026, 9, 1) });
  await adminDb().doc(`orgs/${S.org}/aiDaily/${day}`).set({ checks: 99 });
  assert.ok((await S.own.call('findDamage', { orgId: S.org, walkId: await photos(S.own, S.org, S.vans.v1, { real: true }), tier: 'default' })).checkId);
});

test('drivers sign up with the company\'s link, pick a station, and wait for an owner or that station\'s manager', async () => {
  const details = (first, last, extra = {}) => ({ firstName: first, lastName: last, phone: '+49 151 3', ...extra });
  // Owners and managers get the company's one link (it has it from the start); drivers don't. Who makes a new one
  // (owners and managers since 26 Nov 2026) is in "cause 2b (B1, B2)" at the end.
  await fails(S.d1.call('driverLink', { orgId: S.org }), 'permission-denied');
  const link = await S.mgr.call('driverLink', { orgId: S.org });
  assert.equal((await S.own.call('driverLink', { orgId: S.org })).token, link.token);
  assert.equal((await getDoc(doc(S.mgr.db, 'orgs', S.org, 'links', 'drivers'))).data().token, link.token);

  // Anyone with the link sees the company and its stations.
  const gina = await person('Gina Newdriver');
  const peek = await gina.call('peekInvite', { token: link.token });
  assert.equal(peek.kind, 'company');
  assert.equal(peek.status, 'ok');
  assert.deepEqual(peek.stations.map((x) => x.id).sort(), [S.s1, S.s2].sort());

  // Gina picks station 1. Until someone approves, she isn't a member and sees nothing of the company.
  await fails(gina.call('requestToJoin', { token: link.token, stationId: 'nope', details: details('Gina', 'Newdriver') }), 'not-found');
  await fails(gina.call('requestToJoin', { token: link.token, stationId: S.s1, details: { firstName: 'Gina' } }), 'invalid-argument');
  const r = await gina.call('requestToJoin', { token: link.token, stationId: S.s1, details: details('Gina', 'Newdriver', { transporterId: 'A1' }) });
  assert.equal(r.stationName, 'DXX1');
  assert.equal((await gina.call('peekInvite', { token: link.token })).status, 'pending');
  await fails(getDocs(query(collection(gina.db, 'orgs', S.org, 'vehicles'), where('stationId', 'in', [S.s1]))), 'permission-denied');
  await fails(getDocs(query(collection(gina.db, 'orgs', S.org, 'vehicles'), where('assignedTo.driverId', '==', gina.uid))), 'permission-denied');
  await fails(gina.call('assignVan', { orgId: S.org, vehicleId: S.vans.v1.id, driverId: gina.uid }), 'permission-denied');
  const mine = (await getDoc(doc(gina.db, 'orgs', S.org, 'joinRequests', gina.uid))).data();
  assert.equal(mine.status, 'pending');
  assert.ok(mine.sameTransporterId, 'a driver in the company already has Transporter ID A1: the approver is told');
  assert.equal((await getDoc(doc(gina.db, 'users', gina.uid))).data().pendingJoin.orgId, S.org);

  // Hugo picks station 2: the manager of station 1 can't see or decide it; drivers and Gina herself can't decide anything.
  const hugo = await person('Hugo Otherstation');
  await hugo.call('requestToJoin', { token: link.token, stationId: S.s2, details: details('Hugo', 'Otherstation') });
  await fails(getDoc(doc(S.mgr.db, 'orgs', S.org, 'joinRequests', hugo.uid)), 'permission-denied');
  await fails(S.mgr.call('decideJoinRequest', { orgId: S.org, uid: hugo.uid, approve: true }), 'permission-denied');
  await fails(S.d1.call('decideJoinRequest', { orgId: S.org, uid: gina.uid, approve: true }), 'permission-denied');
  await fails(gina.call('decideJoinRequest', { orgId: S.org, uid: gina.uid, approve: true }), 'permission-denied');

  // The station's manager approves Gina: a driver at station 1, the company on her profile.
  await S.mgr.call('decideJoinRequest', { orgId: S.org, uid: gina.uid, approve: true });
  const m = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'members', gina.uid))).data();
  assert.equal(m.role, 'driver');
  assert.deepEqual(m.stationIds, [S.s1]);
  assert.equal(m.approvedBy, S.mgr.uid);
  assert.equal(m.phone, '+49 151 3');
  const prof = (await getDoc(doc(gina.db, 'users', gina.uid))).data();
  assert.ok(prof.orgIds.includes(S.org));
  assert.equal(prof.pendingJoin, undefined);
  await fails(S.mgr.call('decideJoinRequest', { orgId: S.org, uid: gina.uid, approve: false }), 'failed-precondition');
  assert.equal((await gina.call('peekInvite', { token: link.token })).status, 'member');
  // A member now: she reads the van she has (none yet), never the station's other vans (blind test, cause 3a).
  assert.equal((await getDocs(query(collection(gina.db, 'orgs', S.org, 'vehicles'), where('assignedTo.driverId', '==', gina.uid)))).size, 0);
  await fails(getDocs(query(collection(gina.db, 'orgs', S.org, 'vehicles'), where('stationId', 'in', [S.s1]))), 'permission-denied');

  // The owner rejects Hugo: only his name stays on the request, and he can't ask again the same day.
  await S.own.call('decideJoinRequest', { orgId: S.org, uid: hugo.uid, approve: false });
  const hr = (await getDoc(doc(hugo.db, 'orgs', S.org, 'joinRequests', hugo.uid))).data();
  assert.equal(hr.status, 'rejected');
  assert.equal(hr.phone, '');
  assert.equal(hr.email, '');
  assert.equal((await getDoc(doc(hugo.db, 'orgs', S.org, 'members', hugo.uid))).exists(), false);
  await fails(hugo.call('requestToJoin', { token: link.token, stationId: S.s2, details: details('Hugo', 'Otherstation') }), 'failed-precondition');

  // Ines asked by mistake and takes it back; then nobody can approve it.
  const ines = await person('Ines Wrongcompany');
  // Without a mobile number: it's optional (drivers often have company phones and don't know the number).
  await ines.call('requestToJoin', { token: link.token, stationId: S.s2, details: { firstName: 'Ines', lastName: 'Wrongcompany' } });
  await ines.call('withdrawJoinRequest', { orgId: S.org });
  assert.equal((await getDoc(doc(ines.db, 'orgs', S.org, 'joinRequests', ines.uid))).data().status, 'withdrawn');
  await fails(S.own.call('decideJoinRequest', { orgId: S.org, uid: ines.uid, approve: true }), 'failed-precondition');

  // Older than 14 days: it can't be approved any more.
  const jonas = await person('Jonas Late');
  await jonas.call('requestToJoin', { token: link.token, stationId: S.s1, details: details('Jonas', 'Late') });
  await adminDb().doc(`orgs/${S.org}/joinRequests/${jonas.uid}`).update({ expiresAt: Date.now() - 1000 });
  await fails(S.mgr.call('decideJoinRequest', { orgId: S.org, uid: jonas.uid, approve: true }), 'deadline-exceeded');

  // The owner makes a new link: the old one stops working.
  const fresh = await S.own.call('driverLink', { orgId: S.org, reset: true });
  assert.notEqual(fresh.token, link.token);
  const kira = await person('Kira Oldlink');
  assert.equal((await kira.call('peekInvite', { token: link.token })).status, 'replaced');
  await fails(kira.call('requestToJoin', { token: link.token, stationId: S.s1, details: details('Kira', 'Oldlink') }), 'failed-precondition');
  assert.equal((await kira.call('peekInvite', { token: fresh.token })).status, 'ok');

  // A request still waiting goes with the person's account when they delete it.
  const lena = await person('Lena Leaving');
  await lena.call('requestToJoin', { token: fresh.token, stationId: S.s1, details: details('Lena', 'Leaving') });
  await lena.call('deleteAccount', {});
  assert.equal((await adminDb().doc(`orgs/${S.org}/joinRequests/${lena.uid}`).get()).exists, false);
});

/** Stripe's webhook, as Stripe sends it: the event signed with the endpoint's secret (functions/.secret.local). */
async function stripeEvent(type, object, { id = `evt_${run}${Math.random().toString(36).slice(2, 8)}`, secret } = {}) {
  const key = secret || readFileSync(new URL('../functions/.secret.local', import.meta.url), 'utf8').match(/^STRIPE_WEBHOOK_SECRET=(.+)$/m)[1].trim();
  const body = JSON.stringify({ id, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), api_version: '2026-10-28.endive', data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex');
  const r = await fetch(`http://${HOST}:5001/${cfg.projectId}/us-central1/stripeWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body });
  return { status: r.status, body: await r.json().catch(() => null), id };
}
const eventually = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    try { return await fn(); } catch (e) { if (Date.now() - t0 > ms) throw e; }
    await new Promise((r) => setTimeout(r, 400));
  }
};

test('payments: a card at sign-up (trial, yearly, a custom link), plan changes, the van limit, Stripe\'s webhook', async () => {
  // Payments on, with the tests' fake Stripe (payments.ts). Off again at the end, for the other tests.
  await adminDb().doc('platform/stripe').set({ mode: 'fake', publishableKey: 'pk_test_fake', tax: { mode: 'rate', rateId: 'txr_fake' } });
  const address = { name: 'Pay Logistik GmbH', address: { line1: 'Hauptstr. 1', city: 'Berlin', postal_code: '10115', country: 'DE' } };
  const terms = '2026-11-20';
  // The early-bird price (functions/src/billing.ts): every plan started before 1 April 2027 (German time) is on it.
  // The checks below hold on both sides of that day.
  const early = Date.now() < Date.UTC(2027, 2, 31, 22);
  const k = (key) => (early ? `${key}_early` : key);
  try {
    const cfgNow = await S.own.call('billingConfig', {});
    assert.equal(cfgNow.mode, 'fake');
    assert.deepEqual([cfgNow.prices.basic.month, cfgNow.prices.pro.month, cfgNow.prices.business.month, cfgNow.prices.ultimate.month], [10000, 30000, 80000, 200000]);
    assert.deepEqual([cfgNow.earlyPrices.basic.month, cfgNow.earlyPrices.pro.month, cfgNow.earlyPrices.business.month, cfgNow.earlyPrices.ultimate.month], [4000, 12000, 32000, 80000], '60 % off: EUR 0.80 a van on a full plan');
    assert.deepEqual([cfgNow.planVans.basic, cfgNow.planVans.pro, cfgNow.planVans.business, cfgNow.planVans.ultimate], [50, 150, 400, 1000]);
    assert.equal(cfgNow.earlyBird, early);
    assert.equal(cfgNow.earlyBirdEnd, Date.UTC(2027, 2, 31, 22));
    assert.equal(cfgNow.launchOffer, !early, 'no yearly launch offer on top of the early-bird price');
    assert.equal(cfgNow.yearlyOff, 30);
    assert.equal(cfgNow.yearly, false, 'yearly plans are off until the app creator turns them on');
    assert.equal((await S.own.call('billingConfig', { offer: 'NOPE2345' })).offerError.t, 'This sign-up link doesn\'t exist. Check the link, or write to info@fratius.com.');

    // 1. Monthly: the company starts without a card and can't work until one is added.
    const pia = await person('Pia Pay');
    const { orgId, needsCard } = await pia.call('createCompany', { company: 'Pay Logistik GmbH', station: 'DPY1', name: 'Pia Pay', source: 'website', plan: 'basic', terms, payments: true });
    assert.equal(needsCard, true);
    let org = (await getDoc(doc(pia.db, 'orgs', orgId))).data();
    assert.equal(org.billing.status, 'incomplete');
    assert.equal(org.billing.via, 'stripe');
    assert.equal(org.billing.card, false);
    const e1 = await fails(pia.call('setupStations', { orgId }), 'failed-precondition');
    assert.match(e1.message, /no active plan/);
    // Only the owner pays; the address is needed for the invoices; a VAT ID must look like one.
    await fails(S.mgr.call('billingStart', { orgId: S.org, plan: 'pro', interval: 'month', address }), 'permission-denied');
    await fails(pia.call('billingStart', { orgId, plan: 'basic', interval: 'month' }), 'invalid-argument');
    const badVat = await fails(pia.call('billingStart', { orgId, plan: 'basic', interval: 'month', address, vatId: 'DE12' }), 'invalid-argument');
    assert.match(badVat.message, /VAT ID/);
    const start = await pia.call('billingStart', { orgId, plan: 'basic', interval: 'month', address, vatId: 'de 123 456 789' });
    assert.equal(start.kind, 'setup');
    assert.match(start.clientSecret, /^seti_fake_/);
    assert.equal(start.firstNet, early ? 4000 : 10000, 'the exact terms come back, for the page to check against what it showed');
    // Premium (unlimited vans) isn't sold any more.
    await fails(pia.call('billingStart', { orgId, plan: 'premium', interval: 'month', address }), 'invalid-argument');
    // Asked again with the same terms (another card, a reload): the same subscription.
    assert.equal((await pia.call('billingStart', { orgId, plan: 'basic', interval: 'month', address, vatId: 'DE123456789' })).clientSecret, start.clientSecret);
    assert.ok(Math.abs(start.trialEnd - (Date.now() + 30 * 86400_000)) < 3_700_000, '30 days from adding the card');
    const pd = (await adminDb().doc(`payments/${orgId}`).get()).data();
    const cust = (await adminDb().doc(`fakeStripe/${pd.customerId}`).get()).data();
    assert.equal(cust.name, 'Pay Logistik GmbH');
    assert.equal(cust.taxId.value, 'DE123456789');
    assert.deepEqual(cust.locales, ['de', 'en']);
    org = (await getDoc(doc(pia.db, 'orgs', orgId))).data();
    assert.equal(org.billing.status, 'incomplete', 'no card yet');
    assert.equal(org.billing.vans, 50);
    // Nobody reads the Stripe ids or the fake Stripe from the app.
    await fails(getDoc(doc(pia.db, 'payments', orgId)), 'permission-denied');
    // The browser confirms the card with Stripe.js; then the server makes it the subscription's.
    await adminDb().doc(`fakeStripe/${pd.subscriptionId}`).update({ confirmed: true });
    const conf = await pia.call('billingConfirm', { orgId, setupIntent: start.clientSecret.split('_secret_')[0] });
    assert.equal(conf.billing.status, 'trialing');
    assert.equal(conf.billing.card, true);
    assert.equal(conf.billing.plan, 'basic');
    assert.equal(conf.billing.early, early);
    assert.equal(conf.billing.net, early ? 4000 : 10000, 'what Stripe charges per invoice');
    assert.equal((await pia.call('setupStations', { orgId })).done, false, 'works now');
    await fails(pia.call('billingStart', { orgId, plan: 'pro', interval: 'month', address }), 'failed-precondition');
    assert.ok((await adminDb().doc(`payments/${orgId}`).get()).data().confirmedAt);
    // The owner can't write billing or the van count.
    await fails(updateDoc(doc(pia.db, 'orgs', orgId), { 'billing.vans': 999 }), 'permission-denied');
    await fails(updateDoc(doc(pia.db, 'orgs', orgId), { fleetSize: 5 }), 'permission-denied');

    // 2. The van limit: Basic has 50. The server counts the vans in use (not retired ones).
    const stationId = (await getDocs(collection(pia.db, 'orgs', orgId, 'stations'))).docs[0].id;
    const addVan = (n) => setDoc(doc(collection(pia.db, 'orgs', orgId, 'vehicles')), { name: `Van P${n}`, plate: `P${n}`, cls: 'van', stationId, createdAt: Date.now(), createdBy: pia.uid });
    await addVan(1);
    await eventually(async () => assert.equal((await adminDb().doc(`orgs/${orgId}`).get()).data().fleetSize, 1));
    await adminDb().doc(`orgs/${orgId}`).update({ fleetSize: 50 });
    await fails(addVan(2), 'permission-denied');
    // The add-on makes room (changePlan counts the vans again, so the test sets "full" once more after it).
    const more = await pia.call('changePlan', { orgId, plan: 'basic', addon: true, rid: `rcp${run}a` });
    assert.equal(more.billing.addon, true);
    assert.equal(more.billing.vans, 65);
    await adminDb().doc(`orgs/${orgId}`).update({ fleetSize: 50 });
    await addVan(3);
    let sub = (await adminDb().doc(`fakeStripe/${pd.subscriptionId}`).get()).data();
    assert.deepEqual(sub.items.map((i) => i.key).sort(), ['fratius_addon15_month', k('fratius_basic_month')], 'the add-on has no early-bird price');
    assert.equal(sub.lastChange.charge, false, 'nothing charged in the trial');
    // Up to Pro (the add-on stays, and the plan keeps the early-bird price it started with), then monthly to yearly
    // (with the launch offer once the early bird is over); yearly back to monthly only by email.
    const pro = await pia.call('changePlan', { orgId, plan: 'pro', rid: `rcp${run}b` });
    assert.equal(pro.billing.plan, 'pro');
    assert.equal(pro.billing.vans, 165);
    assert.equal(pro.billing.net, (early ? 12000 : 30000) + 1000);
    // Business has no add-on: 400 vans.
    const biz = await pia.call('changePlan', { orgId, plan: 'business', rid: `rcp${run}b2` });
    assert.equal(biz.billing.vans, 400);
    assert.equal(biz.billing.addon, false);
    assert.equal(biz.billing.net, early ? 32000 : 80000);
    assert.equal((await pia.call('changePlan', { orgId, plan: 'pro', addon: true, rid: `rcp${run}b3` })).billing.vans, 165);
    await fails(pia.call('changePlan', { orgId, interval: 'year', rid: `rcp${run}y` }), 'failed-precondition');
    await adminDb().doc('platform/billing').set({ yearly: true }, { merge: true });
    const yearly = await pia.call('changePlan', { orgId, interval: 'year', rid: `rcp${run}c` });
    assert.equal(yearly.billing.interval, 'year');
    sub = (await adminDb().doc(`fakeStripe/${pd.subscriptionId}`).get()).data();
    assert.deepEqual(sub.items.map((i) => i.key).sort(), ['fratius_addon15_year', k('fratius_pro_year')]);
    assert.deepEqual(sub.coupons, early ? [] : ['fratius_yearly_launch_30_v2']);
    await fails(pia.call('changePlan', { orgId, interval: 'month', rid: `rcp${run}d` }), 'failed-precondition');
    assert.match((await pia.call('billingPortal', { orgId })).url, /^https:\/\/billing\.stripe\.test\//);

    // 3. Stripe's webhook: signed, each event once, the subscription read back.
    const pastDue = await stripeEvent('customer.subscription.updated', { object: 'subscription', id: pd.subscriptionId, status: 'past_due' });
    assert.equal(pastDue.status, 200);
    assert.equal((await adminDb().doc(`orgs/${orgId}`).get()).data().billing.status, 'past_due');
    assert.equal((await pia.call('setupStations', { orgId })).done, false, 'past due still works while Stripe tries the card again');
    assert.equal((await stripeEvent('customer.subscription.updated', { object: 'subscription', id: pd.subscriptionId, status: 'active' }, { id: pastDue.id })).body.duplicate, true);
    assert.equal((await adminDb().doc(`orgs/${orgId}`).get()).data().billing.status, 'past_due', 'a repeated event changes nothing');
    assert.equal((await stripeEvent('customer.subscription.updated', { object: 'subscription', id: pd.subscriptionId, status: 'active' }, { secret: 'whsec_wrong' })).status, 400);
    await stripeEvent('customer.subscription.deleted', { object: 'subscription', id: pd.subscriptionId, status: 'canceled' });
    assert.equal((await adminDb().doc(`orgs/${orgId}`).get()).data().billing.status, 'canceled');
    await fails(pia.call('setupStations', { orgId }), 'failed-precondition');
    // The app creator isn't stopped.
    const cr = await appCreator('Petra Paylinks');
    assert.equal((await cr.call('setupStations', { orgId })).done, false);

    // 4. A sign-up link from the app creator: Pro, 60 days free, 20 % off for 6 months, one use.
    await fails(pia.call('saveOffer', { note: 'x' }), 'permission-denied');
    const off = await cr.call('saveOffer', { note: 'Hart Logistics, 80 vans', plan: 'pro', interval: 'month', trialDays: 60, percentOff: 20, months: 6, maxUses: 1, rid: `rso${run}a` });
    assert.match(off.url, new RegExp(`/start\\?offer=${off.code}$`));
    const peek = await pia.call('billingConfig', { offer: off.code.toLowerCase() });
    assert.equal(peek.offer.trialDays, 60);
    assert.equal(peek.offer.plan, 'pro');
    assert.equal(peek.offer.note, undefined, 'the note is only for the app creator');
    const hart = await person('Hanna Hart');
    const h = await hart.call('createCompany', { company: 'Hart Logistics', station: 'DHL1', name: 'Hanna Hart', source: 'website', plan: 'basic', terms, payments: true });
    const hs = await hart.call('billingStart', { orgId: h.orgId, plan: 'basic', interval: 'year', offer: off.code, address });
    assert.equal(hs.kind, 'setup');
    assert.ok(Math.abs(hs.trialEnd - (Date.now() + 60 * 86400_000)) < 3_700_000);
    // The link's one use is taken when Hart starts: nobody else can start with it meanwhile.
    const ole = await person('Ole Early');
    const oe = await ole.call('createCompany', { company: 'Early GmbH', station: 'DER1', name: 'Ole Early', source: 'website', plan: 'pro', terms, payments: true });
    assert.match((await fails(ole.call('billingStart', { orgId: oe.orgId, offer: off.code, address }), 'failed-precondition')).message, /already been used/);
    assert.equal((await adminDb().doc(`offers/${off.code}`).get()).data().uses, 1);
    // Hart itself can come back to it (another card) and still sees the offer.
    assert.equal((await hart.call('billingConfig', { offer: off.code, orgId: h.orgId })).offer.trialDays, 60);
    const hpd = (await adminDb().doc(`payments/${h.orgId}`).get()).data();
    let hsub = (await adminDb().doc(`fakeStripe/${hpd.subscriptionId}`).get()).data();
    assert.deepEqual(hsub.items.map((i) => i.key), [k('fratius_pro_month')], 'the link\'s plan, not the one picked');
    assert.equal(hsub.coupons.length, 1);
    assert.match(hsub.coupons[0], new RegExp(`^fratius_offer_${off.code.toLowerCase()}_[0-9a-f]{8}$`), 'the coupon is named after the link\'s terms');
    // 20 % for 6 months, counted from the end of the 60 free days (Stripe counts from sign-up).
    assert.equal((await adminDb().doc(`fakeStripe/coupon_${hsub.coupons[0]}`).get()).data().months, 8);
    await adminDb().doc(`fakeStripe/${hpd.subscriptionId}`).update({ confirmed: true });
    const hc = await hart.call('billingConfirm', { orgId: h.orgId, setupIntent: hs.clientSecret.split('_secret_')[0] });
    assert.equal(hc.billing.status, 'trialing');
    assert.equal(hc.billing.offer, off.code);
    assert.equal((await adminDb().doc(`offers/${off.code}`).get()).data().uses, 1);
    assert.equal((await getDocs(collection(cr.db, 'offers'))).docs.some((d) => d.id === off.code), true, 'the app creator lists the links');
    await fails(getDocs(collection(hart.db, 'offers')), 'permission-denied');
    const late = await person('Lars Late');
    const l = await late.call('createCompany', { company: 'Late GmbH', station: 'DLT1', name: 'Lars Late', source: 'website', plan: 'pro', terms, payments: true });
    assert.match((await fails(late.call('billingStart', { orgId: l.orgId, offer: off.code, address }), 'failed-precondition')).message, /already been used/);

    // 5. Yearly, paid at sign-up, no trial: Ultimate at the early-bird price (after the early bird: the regular
    //    price with 30 % off the first year).
    const yan = await person('Yara Yearly');
    const y = await yan.call('createCompany', { company: 'Yearly GmbH', station: 'DYR1', name: 'Yara Yearly', source: 'website', plan: 'ultimate', interval: 'year', terms, payments: true });
    // Only while the app creator offers yearly plans (a sign-up link with a yearly plan works anyway).
    await fails(pia.call('setLaunchOffer', { yearly: false }), 'permission-denied');
    assert.deepEqual(await cr.call('setLaunchOffer', { yearly: false }), { launchOffer: true, yearly: false });
    assert.equal((await yan.call('billingConfig', { orgId: y.orgId })).yearly, false);
    await fails(yan.call('billingStart', { orgId: y.orgId, plan: 'ultimate', interval: 'year', address }), 'failed-precondition');
    assert.deepEqual(await cr.call('setLaunchOffer', { yearly: true }), { launchOffer: true, yearly: true });
    const ys = await yan.call('billingStart', { orgId: y.orgId, plan: 'ultimate', interval: 'year', address });
    assert.equal(ys.kind, 'payment');
    assert.equal(ys.amount, early ? 960000 : 1680000);
    assert.equal(ys.firstNet, early ? 960000 : 1680000);
    assert.equal(ys.trialEnd, null);
    const ypd = (await adminDb().doc(`payments/${y.orgId}`).get()).data();
    await adminDb().doc(`fakeStripe/${ypd.subscriptionId}`).update({ confirmed: true });
    const yc = await yan.call('billingConfirm', { orgId: y.orgId });
    assert.equal(yc.billing.status, 'active');
    assert.equal(yc.billing.vans, 1000);
    // A company still on Premium (sold until 12 November 2026) keeps it: unlimited vans, at its price.
    await stripeEvent('customer.subscription.updated', { object: 'subscription', id: ypd.subscriptionId, status: 'active', items: [{ id: 'si_fake_premium', key: 'fratius_premium_month', price: 'fratius_premium_month', cents: 20000 }] });
    const prem = (await adminDb().doc(`orgs/${y.orgId}`).get()).data().billing;
    assert.equal(prem.plan, 'premium');
    assert.equal(prem.vans, null, 'unlimited');
    assert.equal(prem.net, 20000);

    // 6. With test keys, sign-up without the new page works as before (a trial without a card).
    const old = await person('Otto Oldpage');
    const o = await old.call('createCompany', { company: 'Old Page GmbH', station: 'DOP1', name: 'Otto Oldpage', source: 'app', plan: null, terms });
    assert.equal((await adminDb().doc(`orgs/${o.orgId}`).get()).data().billing.status, 'trialing');
    // Live keys: every new company adds a card, and older apps can't make one by themselves.
    await adminDb().doc('platform/stripe').update({ mode: 'live' });
    const live = await old.call('createCompany', { company: 'Live GmbH', station: 'DLV1', name: 'Otto Oldpage', source: 'app', plan: null, terms });
    assert.equal(live.needsCard, true);
    await fails(setDoc(doc(collection(old.db, 'orgs')), { name: 'Sneaky', createdBy: old.uid, createdAt: Date.now() }), 'permission-denied');
    // A company that signed up with Stripe's test keys starts again with live keys: nothing real was agreed.
    await fails(hart.call('setupStations', { orgId: h.orgId }), 'failed-precondition');
    // An owner deleting their account ends the plan of the company that closes with it.
    await adminDb().doc('platform/stripe').update({ mode: 'fake' });
    await yan.call('deleteAccount', {});
    assert.equal((await adminDb().doc(`fakeStripe/${ypd.subscriptionId}`).get()).data().status, 'canceled');
  } finally {
    await adminDb().doc('platform/stripe').delete();
    await adminDb().doc('platform/billing').delete();
  }
});

test('a sign-up link without a card: free days with no card, reminders, the card later on the link\'s terms, or the company stops', async () => {
  // Product owner, 2026-11-20: "Require credit card" off on a sign-up link. Payments on with the fake Stripe.
  await adminDb().doc('platform/stripe').set({ mode: 'fake', publishableKey: 'pk_test_fake', tax: { mode: 'rate', rateId: 'txr_fake' } });
  const address = { name: 'Kara Kurier GmbH', address: { line1: 'Ringstr. 2', city: 'München', postal_code: '80331', country: 'DE' } };
  const terms = '2026-11-20';
  const early = Date.now() < Date.UTC(2027, 2, 31, 22);
  const pd = async (orgId) => (await adminDb().doc(`payments/${orgId}`).get()).data() || {};
  const billing = async (orgId) => (await adminDb().doc(`orgs/${orgId}`).get()).data().billing;
  try {
    const cr = await appCreator('Nadja Nocard');
    // Only the app creator makes links; a link without a card needs free days; a card unless it's unticked.
    await fails(S.own.call('saveOffer', { note: 'x', trialDays: 14, requireCard: false }), 'permission-denied');
    assert.match((await fails(cr.call('saveOffer', { note: 'x', trialDays: 0, requireCard: false }), 'invalid-argument')).message, /needs free days/);
    const off = await cr.call('saveOffer', { note: 'Kara Kurier, 40 vans', plan: 'pro', interval: 'month', trialDays: 14, percentOff: 20, months: 6, maxUses: 2, requireCard: false, rid: `rnc${run}a` });
    assert.equal((await adminDb().doc(`offers/${off.code}`).get()).data().requireCard, false);
    const withCard = await cr.call('saveOffer', { note: 'with a card', plan: 'basic', trialDays: 30, maxUses: 1, rid: `rnc${run}b` });
    assert.equal((await adminDb().doc(`offers/${withCard.code}`).get()).data().requireCard, true, 'a card at sign-up unless unticked');
    const other = await cr.call('saveOffer', { note: 'another one', trialDays: 30, maxUses: 1, requireCard: false, rid: `rnc${run}c` });
    const kara = await person('Kemal Kurier');
    assert.equal((await kara.call('billingConfig', { offer: off.code })).offer.requireCard, false, 'the sign-up page knows');
    assert.equal((await kara.call('billingConfig', { offer: withCard.code })).offer.requireCard, true);

    // 1. Sign-up: the account and the company, then the free days without a card. Nothing in Stripe yet.
    const k = await kara.call('createCompany', { company: 'Kara Kurier GmbH', station: 'DKK1', name: 'Kara Kurier', source: 'website', plan: 'basic', terms, payments: true });
    assert.equal((await billing(k.orgId)).status, 'incomplete');
    // A link that asks for a card doesn't start without one; only the owner starts.
    assert.match((await fails(kara.call('billingTrial', { orgId: k.orgId, offer: withCard.code, plan: 'basic', interval: 'month' }), 'failed-precondition')).message, /starts with a card/);
    assert.equal((await adminDb().doc(`offers/${withCard.code}`).get()).data().uses, 0);
    await fails(S.mgr.call('billingTrial', { orgId: S.org, offer: off.code, plan: 'basic', interval: 'month' }), 'permission-denied');
    const kt = await kara.call('billingTrial', { orgId: k.orgId, offer: off.code, plan: 'basic', interval: 'month', rid: `rnc${run}k` });
    assert.equal(kt.billing.status, 'trialing');
    assert.equal(kt.billing.cardLater, true);
    assert.equal(kt.billing.card, false);
    assert.equal(kt.billing.plan, 'pro', 'the link\'s plan, not the one picked');
    assert.equal(kt.billing.vans, 150);
    assert.equal(kt.billing.offer, off.code);
    assert.ok(Math.abs(kt.trialEnd - (Date.now() + 14 * 86400_000)) < 3_700_000, 'the link\'s 14 free days');
    assert.equal((await kara.call('setupStations', { orgId: k.orgId })).done, false, 'the company works without a card');
    assert.equal((await adminDb().doc(`offers/${off.code}`).get()).data().uses, 1);
    assert.equal((await pd(k.orgId)).subscriptionId ?? null, null, 'nothing in Stripe');
    // Asked again: the same free days. Another link: no second round of free days.
    assert.equal((await kara.call('billingTrial', { orgId: k.orgId, offer: off.code, plan: 'basic', interval: 'month' })).trialEnd, kt.trialEnd);
    assert.match((await fails(kara.call('billingTrial', { orgId: k.orgId, offer: other.code, plan: 'basic', interval: 'month' }), 'failed-precondition')).message, /started already/);
    assert.equal((await adminDb().doc(`offers/${other.code}`).get()).data().uses, 0);
    // The owner can't write the billing.
    await fails(updateDoc(doc(kara.db, 'orgs', k.orgId), { 'billing.trialEnd': Date.now() + 365 * 86400_000 }), 'permission-denied');

    // 2. Reminders to add a card: 7 days before, the day before, each once (only the app creator runs it by hand).
    await fails(kara.call('cardLaterSweepNow', { now: Date.now() }), 'permission-denied');
    await cr.call('cardLaterSweepNow', { now: kt.trialEnd - 8 * 86400_000 });
    assert.equal((await pd(k.orgId)).cardNotes, undefined, 'nothing yet a week and more before');
    await cr.call('cardLaterSweepNow', { now: kt.trialEnd - 6.5 * 86400_000 });
    const d7 = (await pd(k.orgId)).cardNotes.d7;
    assert.ok(d7);
    await cr.call('cardLaterSweepNow', { now: kt.trialEnd - 6 * 86400_000 });
    assert.equal((await pd(k.orgId)).cardNotes.d7, d7, 'once');
    await cr.call('cardLaterSweepNow', { now: kt.trialEnd - 20 * 3600_000 });
    assert.ok((await pd(k.orgId)).cardNotes.d1);
    assert.equal((await pd(k.orgId)).cardNotes.ended, undefined);

    // 3. Kara adds the card during the free days: for what is left of them (not 14 new ones), on the link's terms.
    const ks = await kara.call('billingStart', { orgId: k.orgId, plan: 'basic', interval: 'month', offer: off.code, address });
    assert.equal(ks.kind, 'setup');
    assert.equal(ks.trialEnd, kt.trialEnd);
    assert.equal(ks.firstNet, early ? 9600 : 24000, 'Pro with 20 % off');
    const kpd = await pd(k.orgId);
    const ksub = (await adminDb().doc(`fakeStripe/${kpd.subscriptionId}`).get()).data();
    assert.equal(ksub.metadata.since, String(kt.billing.trialStart), 'the plan counts from the sign-up, for the early-bird price');
    // Left half-way (or Stripe tells about the subscription without a card): still the free days, still working.
    await stripeEvent('customer.subscription.updated', { object: 'subscription', id: kpd.subscriptionId, status: 'trialing' });
    let kb = await billing(k.orgId);
    assert.equal(kb.status, 'trialing');
    assert.equal(kb.cardLater, true);
    assert.equal((await kara.call('setupStations', { orgId: k.orgId })).done, false);
    await adminDb().doc(`fakeStripe/${kpd.subscriptionId}`).update({ confirmed: true });
    const kc = await kara.call('billingConfirm', { orgId: k.orgId, setupIntent: ks.clientSecret.split('_secret_')[0] });
    assert.equal(kc.billing.status, 'trialing');
    assert.equal(kc.billing.card, true);
    assert.equal(kc.billing.cardLater, undefined, 'a card on file: an ordinary trial now');
    assert.equal(kc.billing.trialEnd, kt.trialEnd);
    assert.equal(kc.billing.offer, off.code);
    assert.ok((await pd(k.orgId)).confirmedAt);

    // 4. Lou signs up with the link's second use and lets the free days run out.
    const lou = await person('Lorin Later');
    const l = await lou.call('createCompany', { company: 'Lou Later GmbH', station: 'DLL1', name: 'Lou Later', source: 'website', plan: 'basic', terms, payments: true });
    const lt = await lou.call('billingTrial', { orgId: l.orgId, offer: off.code, plan: 'basic', interval: 'month' });
    assert.equal(lt.billing.cardLater, true);
    assert.equal((await adminDb().doc(`offers/${off.code}`).get()).data().uses, 2);
    // A third company can't: the link is used up.
    const max = await person('Mats Third');
    const m = await max.call('createCompany', { company: 'Third GmbH', station: 'DTH1', name: 'Max Third', source: 'website', plan: 'basic', terms, payments: true });
    assert.match((await fails(max.call('billingTrial', { orgId: m.orgId, offer: off.code, plan: 'basic', interval: 'month' }), 'failed-precondition')).message, /already been used/);
    // The app creator ends the link: Lou keeps its terms anyway.
    await cr.call('saveOffer', { code: off.code, ended: true });
    await adminDb().doc(`orgs/${l.orgId}`).update({ 'billing.trialEnd': Date.now() - 3600_000 });
    // Over without a card: the company stops (its data stays) and the owner and the app creator are told, once.
    assert.match((await fails(lou.call('setupStations', { orgId: l.orgId }), 'failed-precondition')).message, /no active plan/);
    assert.equal((await adminDb().doc(`orgs/${l.orgId}`).get()).data().name, 'Lou Later GmbH');
    await cr.call('cardLaterSweepNow', { now: Date.now() });
    const ended = (await pd(l.orgId)).cardNotes.ended;
    assert.ok(ended);
    await cr.call('cardLaterSweepNow', { now: Date.now() + 3600_000 });
    assert.equal((await pd(l.orgId)).cardNotes.ended, ended, 'once');
    assert.equal((await pd(k.orgId)).cardNotes.ended, undefined, 'Kara has a card: no end message');
    // Adding the card now pays now (no new free days), with the ended link's 20 % off.
    assert.equal((await lou.call('billingConfig', { offer: off.code, orgId: l.orgId })).offer.percentOff, 20);
    assert.match((await max.call('billingConfig', { offer: off.code })).offerError.t, /ended/, 'for everybody else the link has ended');
    const ls = await lou.call('billingStart', { orgId: l.orgId, plan: 'basic', interval: 'month', offer: off.code, address });
    assert.equal(ls.kind, 'payment');
    assert.equal(ls.trialEnd, null, 'no new free days');
    assert.equal(ls.firstNet, early ? 9600 : 24000);
    // Until the payment is through the company stays stopped, and no "Card added" yet.
    assert.equal((await billing(l.orgId)).cardLater, true);
    await fails(lou.call('setupStations', { orgId: l.orgId }), 'failed-precondition');
    assert.equal((await pd(l.orgId)).confirmedAt ?? null, null);
    const lpd = await pd(l.orgId);
    await adminDb().doc(`fakeStripe/${lpd.subscriptionId}`).update({ confirmed: true });
    const lc = await lou.call('billingConfirm', { orgId: l.orgId });
    assert.equal(lc.billing.status, 'active');
    assert.equal(lc.billing.card, true);
    assert.equal(lc.billing.cardLater, undefined);
    assert.equal((await lou.call('setupStations', { orgId: l.orgId })).done, false, 'works again');
  } finally {
    await adminDb().doc('platform/stripe').delete();
  }
});

test('the app creator tries both sides from one sign-in: given a van as a driver, allows their own refuel as a manager; nobody else can', async () => {
  // A company of its own, so nothing above is counted differently: an owner, one station, a manager, a van with a fuel card.
  const own = await person('Tara Owner');
  const orgRef = doc(collection(own.db, 'orgs'));
  const org = orgRef.id;
  await setDoc(orgRef, { name: 'Try DSP', createdBy: own.uid, createdAt: Date.now(), stationsReady: true });
  await setDoc(doc(own.db, 'orgs', org, 'members', own.uid), { role: 'owner', stationIds: [], email: '', name: 'Tara Owner', joinedAt: Date.now() });
  const stRef = doc(collection(own.db, 'orgs', org, 'stations'));
  await setDoc(stRef, { name: 'DTR1', code: 'DTR1', createdAt: Date.now() });
  const st = stRef.id;
  const { invites } = await own.call('createInvite', { orgId: org, role: 'manager', stationId: st, count: 1 });
  const mgr = await person('Mia Manager');
  await mgr.call('acceptInvite', { token: invites[0].token, details: { firstName: 'Mia', lastName: 'Manager', phone: '+49 151 2', transporterId: '' } });
  const vRef = doc(collection(own.db, 'orgs', org, 'vehicles'));
  const van = { id: vRef.id, name: 'Van T1', stationId: st };
  await setDoc(vRef, { name: van.name, plate: 'T1', cls: 'van', stationId: st, createdAt: Date.now(), createdBy: own.uid });
  await setDoc(doc(own.db, 'orgs', org, 'vehicleDetails', van.id), { stationId: st, createdAt: Date.now(), fuelCard: 'DKV card ending 4471' });
  const shot = async (p) => {
    const path = `orgs/${org}/buys/${p.uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const assignment = async (p, id) => (await getDoc(doc(p.db, 'orgs', org, 'assignments', id))).data();
  const buy = async (p, id) => (await getDoc(doc(p.db, 'orgs', org, 'purchases', id))).data();
  /** A refuel stopped for a manager: started, then no fuel card at the pump. */
  const stopped = async (p) => {
    const b = await p.call('purchase', { orgId: org, action: 'start', kind: 'fuel', vehicleId: van.id, path: await shot(p) });
    assert.equal((await p.call('purchase', { orgId: org, action: 'card', id: b.id, missing: true })).result, 'missing');
    return b.id;
  };

  const cr = await appCreator('Tess Tryout');
  const viewAs = (v) => setDoc(doc(cr.db, 'users', cr.uid), { viewAs: v }, { merge: true });

  // Everybody else, as before: a van goes to someone on the people list, a driver or a manager of its station.
  await fails(mgr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: cr.uid }), 'not-found');
  await fails(own.call('assignVan', { orgId: org, vehicleId: van.id, driverId: own.uid }), 'invalid-argument');
  // And nobody allows their own stopped refuel: the manager's waits for someone else (here the owner refuses it).
  const mine = await stopped(mgr);
  const e = await fails(mgr.call('purchase', { orgId: org, action: 'decide', id: mine, allow: true }), 'failed-precondition');
  assert.match(e.message, /Someone else has to allow your own/);
  await own.call('purchase', { orgId: org, action: 'decide', id: mine, allow: false });
  await mgr.call('purchase', { orgId: org, action: 'cancel', id: mine });

  // The app creator, viewing the company as a fleet manager of the station, gives the van to themselves. It's
  // recorded like a van given by someone else: the pick-up photos or video are asked for.
  await viewAs({ org, role: 'manager', st });
  const r = await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: cr.uid });
  const a = await assignment(own, r.assignmentId);
  assert.equal(a.driverId, cr.uid);
  assert.equal(a.driverName, 'Tess Tryout');
  assert.equal(a.startedBy, cr.uid);
  assert.equal(a.stationId, st);
  assert.equal(a.pickupRequested, true);
  // They still aren't on the people list.
  assert.equal((await getDoc(doc(own.db, 'orgs', org, 'members', cr.uid))).exists(), false);

  // As a driver of that station they have the van: they read their own handover and add the pick-up photos, which
  // count as the pick-up, not as added later.
  await viewAs({ org, role: 'driver', st });
  assert.equal((await getDoc(doc(cr.db, 'orgs', org, 'vehicles', van.id))).data().assignedTo.driverId, cr.uid);
  assert.equal((await assignment(cr, r.assignmentId)).vehicleId, van.id);
  await fails(cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: null }), 'permission-denied');
  const pick = await photos(cr, org, van);
  await cr.call('addHandoverPhotos', { orgId: org, assignmentId: r.assignmentId, kind: 'pickup', walkId: pick });
  assert.deepEqual((await getDoc(doc(cr.db, 'orgs', org, 'walkarounds', pick))).data().handover, { kind: 'pickup', assignmentId: r.assignmentId, late: false });
  // Their refuel is stopped (no fuel card). As a driver they can't allow it.
  const theirs = await stopped(cr);
  assert.equal((await buy(cr, theirs)).status, 'waiting');
  await fails(cr.call('purchase', { orgId: org, action: 'decide', id: theirs, allow: true }), 'permission-denied');

  // As the station's fleet manager they allow their own: the one sign-in that may.
  await viewAs({ org, role: 'manager', st });
  await cr.call('purchase', { orgId: org, action: 'decide', id: theirs, allow: true, note: 'Trying it out.' });
  const b = await buy(own, theirs);
  assert.equal(b.status, 'open');
  assert.equal(b.by, cr.uid);
  assert.equal(b.decision.by, cr.uid);
  assert.equal(b.decision.allow, true);
  await cr.call('purchase', { orgId: org, action: 'cancel', id: theirs, reason: 'Only a try' });

  // One van per driver holds for them too: as an owner they end it, the history keeps it, and the van is free.
  await viewAs({ org, role: 'owner', st: null });
  await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: null });
  assert.equal((await getDoc(doc(own.db, 'orgs', org, 'vehicles', van.id))).data().assignedTo, null);
  const ended = await assignment(own, r.assignmentId);
  assert.ok(ended.end > 0);
  assert.equal(ended.endedBy, cr.uid);
  // The same from the owner's view, and as themselves.
  const r2 = await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: cr.uid });
  assert.equal((await assignment(own, r2.assignmentId)).pickupRequested, true);
  await viewAs(null);
  await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: null });
  const r3 = await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: cr.uid });
  assert.notEqual(r3.assignmentId, r2.assignmentId);
  await cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: null });

  // It hangs on the sign-in claim: without it the same account gets nothing.
  await setCreator(cr, false);
  await fails(cr.call('assignVan', { orgId: org, vehicleId: van.id, driverId: cr.uid }), 'permission-denied');
});

test('the AI compares every walk-around with the van\'s earlier photos; new damage goes to the station\'s managers to review', async () => {
  // Product owner, 2026-11-20. The stand-in for the AI (functions/src/claude.ts) marks a spot on the first photo ("Frame 1")
  // and calls it new damage, unless the van's plate says QUIET. Earlier tests made this company one set up by hand
  // (no trial allowance).
  const cr = await appCreator('Zora Compare');
  const mkVan = async (name, plate) => {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(r, { name, plate, cls: 'van', stationId: S.s1, createdAt: Date.now(), createdBy: S.own.uid });
    return { id: r.id, name, stationId: S.s1 };
  };
  const v = await mkVan('Van C1', 'CMP 1'), q = await mkVan('Van C2', 'QUIET 2');
  const walkDoc = async (p, id) => (await getDoc(doc(p.db, 'orgs', S.org, 'walkarounds', id))).data();
  const cmpOf = (id, ...states) => waitFor(async () => {
    const c = (await walkDoc(S.mgr, id))?.cmp;
    return c && states.includes(c.status) ? c : null;
  }, `the comparison of ${id}`, 90_000);
  // A driver of station 1 who has van C1 for a while (the damage log names who had the van).
  const inv = await S.mgr.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
  const kim = await person('Kim Compare');
  await kim.call('acceptInvite', { token: inv.invites[0].token, details: { firstName: 'Kim', lastName: 'Compare', phone: '+49 151 7', transporterId: 'K7' } });
  // The manager's phone gets notifications (a push service on this computer, as in the tests above).
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => { got.push({ url: req.url, body: Buffer.concat(ch) }); res.statusCode = 201; res.end(); });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const pushCol = adminDb().collection(`users/${S.mgr.uid}/push`);
  const before = await pushCol.get();
  await Promise.all(before.docs.map((d) => d.ref.delete()));
  await pushCol.doc('cmp').set({ endpoint: `http://${HOST}:${srv.address().port}/push/cmp`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth }, createdAt: Date.now(), device: 'manager phone' });
  const opened = () => got.filter((g) => g.url === '/push/cmp').map((g) => JSON.parse(fnRequire('http_ece').decrypt(g.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString()));
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  try {
    // The van's first walk-around: nothing to compare with. No AI, no check.
    const w1 = await photos(S.d1, S.org, v, { real: true });
    const c1 = await cmpOf(w1, 'first');
    assert.equal(c1.compared, 0);
    assert.deepEqual(c1.notCompared.map((g) => g.why), ['first', 'first', 'first']);
    assert.equal((await getDoc(doc(cr.db, 'orgs', S.org, 'compares', w1))).data().status, 'first');

    // Kim has the van; her drop-off photos are compared frame by frame with the ones before.
    await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v.id, driverId: kim.uid });
    const w2 = await photos(kim, S.org, v, { real: true });
    const c2 = await cmpOf(w2, 'done', 'failed');
    assert.equal(c2.status, 'done', JSON.stringify(c2));
    assert.equal(c2.compared, 3);
    assert.deepEqual(c2.notCompared, []);
    assert.equal(c2.found, 1);
    assert.equal(c2.unsure, 0);
    assert.equal(c2.checkId, `cmp-${w2}`);
    await S.mgr.call('assignVan', { orgId: S.org, vehicleId: v.id, driverId: null });

    // The damage check for the manager: made by nobody, the photos Kim's (by account id: drivers read checks).
    const kref = doc(S.mgr.db, 'orgs', S.org, 'checks', c2.checkId);
    const k = (await getDoc(kref)).data();
    assert.equal(k.auto, 'compare');
    assert.equal(k.status, 'submitted');
    assert.equal(k.createdBy, null);
    assert.equal(k.walkBy, kim.uid);
    assert.deepEqual(k.refWalkIds, [w1]);
    assert.equal(k.spots.length, 1);
    const sp = k.spots[0];
    assert.equal(sp.photoLabel, 'Frame 1');
    assert.equal(sp.verdict.verdict, 'damage');
    assert.equal(sp.beforeWalkId, w1);
    assert.ok(sp.beforeAt <= k.createdAt && k.refAt === sp.beforeAt);
    // The same part of both photos, cut from the full-size photos, for the manager to compare.
    for (const path of [sp.refPath, sp.beforePath]) assert.ok((await getBytes(ref(S.mgr.st, path))).byteLength > 1000, path);
    // Another driver of the station doesn't read the check (blind test, cause 3a: their own and their van's only).
    await fails(getDoc(doc(S.d1.db, 'orgs', S.org, 'checks', c2.checkId)), 'permission-denied');
    // The station's manager got a notification that opens the review; not Kim, who took the photos.
    const note = await waitFor(async () => opened().find((m) => m.url === `/check/${c2.checkId}`), 'the notification');
    assert.equal(note.title, 'Possible new damage: CMP 1');
    assert.match(note.body, /1 possible new damage/);
    // Time and cost: the app creator's only. The first look at all 3 frames, the second at the one it marked.
    for (const p of [S.mgr, S.own, kim]) {
      await fails(getDoc(doc(p.db, 'orgs', S.org, 'compares', w2)), 'permission-denied');
      await fails(getDoc(doc(p.db, 'orgs', S.org, 'checkUsage', c2.checkId)), 'permission-denied');
    }
    const u = (await getDoc(doc(cr.db, 'orgs', S.org, 'checkUsage', c2.checkId))).data();
    assert.equal(u.pass1.calls, 3);
    assert.equal(u.pass1.images, 6);
    assert.equal(u.pass2.calls, 1);
    assert.equal(u.pass2.images, 4, 'both whole frames and a crop of each');
    const log = (await getDoc(doc(cr.db, 'orgs', S.org, 'compares', w2))).data();
    assert.equal(log.status, 'done');
    assert.equal(log.frames.length, 3);
    assert.equal(log.frames.filter((f) => f.opus).length, 1);
    assert.ok(log.cost > 0 && log.haiku.cost > 0 && log.opus.cost > 0);

    // It runs once per walk-around; staff run it again only when it failed, drivers never.
    await fails(S.mgr.call('compareWalk', { orgId: S.org, walkId: w2 }), 'failed-precondition');
    await fails(kim.call('compareWalk', { orgId: S.org, walkId: w2 }), 'permission-denied');

    // The manager approves it: on the van's record, and the damage log names who had the van since the photos before.
    await updateDoc(kref, { review: { decisions: { 0: { damage: true, note: '', by: S.mgr.uid, byName: 'Max Manager', at: Date.now(), known: null } }, manual: [], by: S.mgr.uid, byName: 'Max Manager', at: Date.now() },
      status: 'reviewed', reviewedAt: Date.now() });
    await S.mgr.call('logReview', { orgId: S.org, checkId: c2.checkId });
    const dl = (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'damageLog', c2.checkId))).data();
    assert.equal(dl.n, 1);
    assert.equal(dl.from, k.refAt);
    assert.deepEqual(dl.driverIds, [kim.uid]);
    // Approved damage keeps both walk-arounds' photos 90 days.
    for (const id of [w1, w2]) assert.deepEqual((await walkDoc(S.mgr, id)).keepDamage, [c2.checkId]);

    // A van where nothing changed: compared, no check, no notification.
    await photos(S.d1, S.org, q, { real: true });
    const w4 = await photos(S.d1, S.org, q, { real: true });
    const c4 = await cmpOf(w4, 'done', 'failed');
    assert.equal(c4.found + c4.unsure, 0, JSON.stringify(c4));
    assert.equal(c4.checkId, null);
    // (Read as the app creator: the rules refuse a manager a check that isn't there, as for any record of a station.)
    assert.equal((await getDoc(doc(cr.db, 'orgs', S.org, 'checks', `cmp-${w4}`))).exists(), false);

    // Photos from the library aren't compared (they may be old).
    const lib = await photos(S.d1, S.org, v, { real: true, source: 'library' });

    // The switch: only the app creator turns it off; then nothing is compared, and it can't be asked for.
    await fails(updateDoc(doc(S.own.db, 'orgs', S.org), { aiCompare: false }), 'permission-denied');
    await updateDoc(doc(cr.db, 'orgs', S.org), { aiCompare: false });
    const off = await photos(S.d1, S.org, v, { real: true });
    await new Promise((r) => setTimeout(r, 6000));
    for (const id of [off, lib]) {
      assert.equal((await walkDoc(S.mgr, id)).cmp, undefined, `${id} wasn't compared`);
      assert.equal((await getDoc(doc(cr.db, 'orgs', S.org, 'compares', id))).exists(), false);
    }
    await fails(S.mgr.call('compareWalk', { orgId: S.org, walkId: off }), 'failed-precondition');
    // On again: a walk-around taken while it was off can be compared by staff.
    await updateDoc(doc(cr.db, 'orgs', S.org), { aiCompare: true });
    const again = await S.mgr.call('compareWalk', { orgId: S.org, walkId: off });
    assert.equal(again.cmp.status, 'done');
    assert.equal(again.cmp.found, 1);

    // During the free trial each van gets 2 comparisons a day; then the walk-around says so.
    const orgRef = adminDb().doc(`orgs/${S.org}`);
    const created = (await orgRef.get()).data().createdAt;
    await orgRef.update({ createdAt: Date.now() });
    try {
      await adminDb().doc(`orgs/${S.org}/aiDaily/${day}`).set({ compare: { [v.id]: 2 } }, { merge: true });
      const lim = await photos(S.d1, S.org, v, { real: true });
      const cl = await cmpOf(lim, 'limit', 'done', 'failed');
      assert.equal(cl.status, 'limit');
      assert.equal((await getDoc(doc(cr.db, 'orgs', S.org, 'checks', `cmp-${lim}`))).exists(), false);
    } finally {
      await orgRef.update({ createdAt: created });
    }
  } finally {
    srv.close();
    await pushCol.doc('cmp').delete();
  }
});

// ---------- Drivers hear the AI comparison of their pick-ups and drop-offs and take close-ups (product owner, 2026-11-22) ----------
// The stand-in for the AI (functions/src/claude.ts): the comparison marks a spot on the first photo unless the van's
// plate says QUIET; the close-ups show damage unless the van's name says SPOTLESS.
const CU = {};
/** A person's phone for notifications: a push service on this computer, as in the tests above. */
async function phoneOf(p, id) {
  const got = [];
  const srv = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => { got.push({ url: req.url, body: Buffer.concat(ch) }); res.statusCode = 201; res.end(); });
  });
  await new Promise((r) => srv.listen(0, HOST, r));
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const col = adminDb().collection(`users/${p.uid}/push`);
  await Promise.all((await col.get()).docs.map((d) => d.ref.delete()));
  await col.doc(id).set({ endpoint: `http://${HOST}:${srv.address().port}/push/${id}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth }, createdAt: Date.now(), device: `${id} phone` });
  return {
    notes: () => got.filter((g) => g.url === `/push/${id}`).map((g) => JSON.parse(fnRequire('http_ece').decrypt(g.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString())),
    close: async () => { srv.close(); await col.doc(id).delete(); },
  };
}
const cuWalk = async (id) => (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'walkarounds', id))).data();
const cuCmp = (id, ...states) => waitFor(async () => {
  const c = (await cuWalk(id))?.cmp;
  return c && states.includes(c.status) ? c : null;
}, `the comparison of ${id}`, 120_000);
const cuCheck = async (id) => (await getDoc(doc(S.mgr.db, 'orgs', S.org, 'checks', id))).data();
const cuNote = (ph, test, what) => waitFor(async () => ph.notes().find(test), what, 60_000);
/** Picks up or drops off a van with every photo, as the app does: the photos say a handover follows. */
async function handover(p, van, kind) {
  const walkId = await photos(p, S.org, van, { real: true, forHandover: kind });
  const plate = (await adminDb().doc(`orgs/${S.org}/vehicles/${van.id}`).get()).data().plate;
  await p.call(kind === 'pickup' ? 'pickUpVan' : 'dropOffVan', { orgId: S.org, vehicleId: van.id, walkId, ...(kind === 'pickup' ? { plate } : {}) });
  return walkId;
}
/** A close-up of a spot, uploaded and checked as the check page does it. */
async function closeUp(p, checkId, spot = 0) {
  const path = `orgs/${S.org}/checks/${checkId}/spot${spot + 1}_1_${Math.random().toString(36).slice(2, 8)}.jpg`;
  await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
  return p.call('checkSpot', { orgId: S.org, checkId, spot, closeups: [path], tier: 'quick' });
}

test('close-ups: two drivers at station 1, three vans, everyone\'s phone', async () => {
  CU.cr = await appCreator('Wim Sweeper');
  const join = async (name) => {
    const { invites } = await S.mgr.call('createInvite', { orgId: S.org, role: 'driver', stationId: S.s1, count: 1 });
    const p = await person(name);
    const [firstName, lastName] = name.split(' ');
    await p.call('acceptInvite', { token: invites[0].token, details: { firstName, lastName, phone: '+49 151 8', transporterId: firstName.toUpperCase() } });
    return p;
  };
  CU.ronja = await join('Ronja Closeup');
  CU.vito = await join('Vito Otherdriver');
  const mkVan = async (name, plate) => {
    const r = doc(collection(S.own.db, 'orgs', S.org, 'vehicles'));
    await setDoc(r, { name, plate, cls: 'van', stationId: S.s1, createdAt: Date.now(), createdBy: S.own.uid });
    return { id: r.id, name, stationId: S.s1 };
  };
  CU.r1 = await mkVan('Van CU1', 'CLS 1');
  CU.r2 = await mkVan('Van CU2', 'QUIET 3');
  CU.r3 = await mkVan('Van SPOTLESS', 'CLS 3');
  await S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: true });
  CU.ph = { ronja: await phoneOf(CU.ronja, 'ronja'), vito: await phoneOf(CU.vito, 'vito'), mgr: await phoneOf(S.mgr, 'mgr') };
});

test('A3: the van\'s first photos: the driver is told they\'re the starting point for the next comparisons', async () => {
  const w = await handover(CU.ronja, CU.r1, 'pickup');
  const c = await cuCmp(w, 'first', 'done', 'failed');
  assert.equal(c.status, 'first');
  assert.equal(c.checkId, null);
  const n = await cuNote(CU.ph.ronja, (m) => m.url === `/walk/${w}`, 'the starting point note');
  assert.equal(n.title, 'Starting point: CLS 1');
  assert.match(n.body, /first photos of this van: the next pick-ups and drop-offs are compared with them/);
});

test('A4: possible new damage: the driver is asked to take close-ups of each spot, with its before and after', async () => {
  const w = await handover(CU.ronja, CU.r1, 'dropoff');
  const c = await cuCmp(w, 'done', 'failed');
  assert.equal(c.status, 'done', JSON.stringify(c));
  assert.equal(c.checkId, `cmp-${w}`);
  CU.k1 = c.checkId;
  const k = await cuCheck(CU.k1);
  // Waiting for the driver's close-ups, for 30 minutes; no spot has an answer from close-ups yet.
  assert.equal(k.status, 'checking');
  assert.equal(k.walkBy, CU.ronja.uid);
  assert.equal(k.walkKind, 'dropoff');
  assert.ok(Math.abs(k.closeupBy - k.createdAt - 30 * 60_000) < 1000, `${k.closeupBy - k.createdAt}`);
  assert.equal(k.spots.length, 1);
  assert.equal(k.spots[0].verdict, null);
  assert.equal(k.spots[0].cmp.verdict, 'damage');
  // The before and after of that part of the van, for the driver to find it.
  for (const path of [k.spots[0].beforePath, k.spots[0].refPath]) assert.ok((await getBytes(ref(CU.ronja.st, path))).byteLength > 1000, path);
  const n = await cuNote(CU.ph.ronja, (m) => m.url === `/check/${CU.k1}`, 'the close-ups note');
  assert.equal(n.title, 'Take close-ups: CLS 1');
  assert.match(n.body, /1 spot on your drop-off photos that may be new damage\. Take close-ups of it now/);
  // The manager hears about it only when the check reaches them.
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(CU.ph.mgr.notes().filter((m) => m.url === `/check/${CU.k1}`).length, 0);
});

test('A8: only the driver who took the photos (and the station\'s staff) adds close-ups; a driver never approves damage', async () => {
  // Another driver of the station sees the check but can't take its close-ups or send it.
  await fails(closeUp(CU.vito, CU.k1), 'permission-denied');
  await fails(CU.vito.call('submitCheck', { orgId: S.org, checkId: CU.k1 }), 'permission-denied');
  // The driver who took the photos can't approve or reject anything, or mark the check reviewed.
  const kref = doc(CU.ronja.db, 'orgs', S.org, 'checks', CU.k1);
  await fails(updateDoc(kref, { review: { decisions: { 0: { damage: false, note: '', by: CU.ronja.uid, byName: 'x', at: Date.now(), known: null } }, manual: [], by: null, byName: null, at: null } }), 'permission-denied');
  await fails(updateDoc(kref, { status: 'reviewed', reviewedAt: Date.now() }), 'permission-denied');
  assert.equal((await cuCheck(CU.k1)).status, 'checking');
});

test('A5: close-ups show damage: the driver is told the fleet manager is reviewing it; the managers get the check and a notification', async () => {
  const r = await closeUp(CU.ronja, CU.k1);
  assert.equal(r.verdict.verdict, 'damage');
  const k = await waitFor(async () => { const x = await cuCheck(CU.k1); return x.status === 'submitted' ? x : null; }, 'the check sent on');
  assert.equal(k.submittedBy, CU.ronja.uid);
  assert.equal(k.spots[0].verdict.verdict, 'damage');
  assert.equal(k.spots[0].cmp.verdict, 'damage', 'the comparison\'s answer stays for the manager');
  assert.equal(k.spots[0].closeups.length, 1);
  assert.ok(!k.sentLate);
  const n = await cuNote(CU.ph.mgr, (m) => m.url === `/check/${CU.k1}`, 'the manager\'s note');
  assert.equal(n.title, 'Possible new damage: CLS 1');
  assert.match(n.body, /drop-off photos show 1 possible new damage/);
  // The clock is stopped.
  assert.equal((await adminDb().doc(`closeupDue/${S.org}__${CU.k1}`).get()).exists, false);
});

test('A1: after a pick-up or drop-off with photos, the driver who took them gets the AI result as a notification; nobody else', async () => {
  const before = { vito: CU.ph.vito.notes().length, mgr: CU.ph.mgr.notes().length };
  const pick = await handover(CU.ronja, CU.r2, 'pickup');
  await cuNote(CU.ph.ronja, (m) => m.url === `/walk/${pick}`, 'the pick-up result');
  const drop = await handover(CU.ronja, CU.r2, 'dropoff');
  await cuNote(CU.ph.ronja, (m) => m.url === `/walk/${drop}`, 'the drop-off result');
  await new Promise((r) => setTimeout(r, 2000));
  const about = (m) => [`/walk/${pick}`, `/walk/${drop}`].includes(m.url);
  assert.equal(CU.ph.vito.notes().slice(before.vito).filter(about).length, 0);
  assert.equal(CU.ph.mgr.notes().slice(before.mgr).filter(about).length, 0);
  CU.drop2 = drop;
});

test('A2: nothing new found: the driver is told "No new damage on your drop-off (or pick-up) photos"', async () => {
  const c = await cuCmp(CU.drop2, 'done', 'failed');
  assert.equal(c.status, 'done');
  assert.equal(c.checkId, null);
  const n = CU.ph.ronja.notes().find((m) => m.url === `/walk/${CU.drop2}`);
  assert.equal(n.title, 'No new damage: QUIET 3');
  assert.match(n.body, /compared your drop-off photos with the van's earlier photos and found no new damage/);
  // And a pick-up of the same van by another driver.
  const pick = await handover(CU.vito, CU.r2, 'pickup');
  const p = await cuNote(CU.ph.vito, (m) => m.url === `/walk/${pick}`, 'the pick-up result');
  assert.equal(p.title, 'No new damage: QUIET 3');
  assert.match(p.body, /compared your pick-up photos/);
  await handover(CU.vito, CU.r2, 'dropoff');
});

test('A6: close-ups show no damage: the check goes to Review without a notification, for the manager to confirm', async () => {
  await handover(CU.ronja, CU.r3, 'pickup');
  const w = await handover(CU.ronja, CU.r3, 'dropoff');
  const c = await cuCmp(w, 'done', 'failed');
  assert.equal(c.checkId, `cmp-${w}`);
  assert.equal((await cuCheck(c.checkId)).status, 'checking');
  await cuNote(CU.ph.ronja, (m) => m.url === `/check/${c.checkId}`, 'the close-ups note');
  const r = await closeUp(CU.ronja, c.checkId);
  assert.equal(r.verdict.verdict, 'no_damage');
  const k = await waitFor(async () => { const x = await cuCheck(c.checkId); return x.status === 'submitted' ? x : null; }, 'the check sent on');
  assert.equal(k.review, null, 'the manager still decides');
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(CU.ph.mgr.notes().filter((m) => m.url === `/check/${c.checkId}`).length, 0);
  // The station's staff can take the close-ups too (A8): the manager, for the next pick-up of this van.
  const w2 = await handover(CU.vito, CU.r3, 'pickup');
  const c2 = await cuCmp(w2, 'done', 'failed');
  assert.equal((await cuCheck(c2.checkId)).status, 'checking');
  assert.equal((await closeUp(S.mgr, c2.checkId)).verdict.verdict, 'no_damage');
  const k2 = await waitFor(async () => { const x = await cuCheck(c2.checkId); return x.status === 'submitted' ? x : null; }, 'the manager\'s close-ups sent on');
  assert.equal(k2.submittedBy, S.mgr.uid);
  CU.vitoHasR3 = true;
});

test('A7: no close-ups within 30 minutes: the check goes to the manager without them, marked as such, and the driver is told', async () => {
  const w = await handover(CU.ronja, CU.r1, 'pickup');
  const c = await cuCmp(w, 'done', 'failed');
  const id = c.checkId;
  assert.equal((await cuCheck(id)).status, 'checking');
  // Only the app creator runs the sweep by hand; before the 30 minutes are up it leaves the check alone.
  await fails(S.own.call('closeupSweepNow', { orgId: S.org }), 'permission-denied');
  await CU.cr.call('closeupSweepNow', { orgId: S.org, now: Date.now() + 60_000 });
  assert.equal((await cuCheck(id)).status, 'checking');
  const r = await CU.cr.call('closeupSweepNow', { orgId: S.org, now: Date.now() + 31 * 60_000 });
  assert.ok(r.sent >= 1, JSON.stringify(r));
  const k = await cuCheck(id);
  assert.equal(k.status, 'submitted');
  assert.equal(k.sentLate, true);
  assert.equal(k.noCloseups, true);
  assert.equal(k.submittedBy, null);
  assert.equal(k.spots[0].verdict.verdict, 'skipped');
  assert.equal(k.spots[0].cmp.verdict, 'damage');
  const d = await cuNote(CU.ph.ronja, (m) => m.url === `/check/${id}` && /Sent to your fleet manager/.test(m.title), 'the driver\'s note');
  assert.equal(d.title, 'Sent to your fleet manager: CLS 1');
  assert.match(d.body, /Nobody took close-ups within 30 minutes/);
  // New damage the AI found without close-ups still reaches the managers.
  await cuNote(CU.ph.mgr, (m) => m.url === `/check/${id}`, 'the manager\'s note');
  assert.equal((await adminDb().doc(`closeupDue/${S.org}__${id}`).get()).exists, false);
  // Sent once: a second sweep finds nothing more for it.
  const again = await CU.cr.call('closeupSweepNow', { orgId: S.org, now: Date.now() + 31 * 60_000 });
  assert.equal(again.sent, 0, JSON.stringify(again));
});

test('A9: unchanged: other walk-arounds go straight to the manager, library photos aren\'t compared, drivers see no other driver\'s name', async () => {
  // A walk-around that isn't a pick-up or drop-off: straight to the manager, no close-ups asked, no driver note.
  const before = CU.ph.vito.notes().length;
  const w = await photos(CU.vito, S.org, CU.r1, { real: true });
  const c = await cuCmp(w, 'done', 'failed');
  const k = await cuCheck(c.checkId);
  assert.equal(k.status, 'submitted');
  assert.equal(k.walkKind, 'walkaround');
  assert.equal(k.closeupBy, null);
  assert.equal(k.spots[0].verdict.verdict, 'damage');
  await cuNote(CU.ph.mgr, (m) => m.url === `/check/${c.checkId}`, 'the manager\'s note');
  assert.equal(CU.ph.vito.notes().slice(before).filter((m) => m.url === `/walk/${w}` || m.url === `/check/${c.checkId}`).length, 0);
  // Library photos aren't compared.
  const lib = await photos(CU.vito, S.org, CU.r1, { real: true, source: 'library' });
  await new Promise((r) => setTimeout(r, 5000));
  assert.equal((await cuWalk(lib)).cmp, undefined);
  // Another driver doesn't read Ronja's checks (blind test, cause 3a: their own and their van's only).
  for (const id of [CU.k1, c.checkId]) await fails(getDoc(doc(CU.vito.db, 'orgs', S.org, 'checks', id)), 'permission-denied');
});

test('close-ups: put things back (pick-ups off at station 1, the phones)', async () => {
  await S.mgr.call('setSelfAssign', { orgId: S.org, stationId: S.s1, on: false });
  for (const ph of Object.values(CU.ph || {})) await ph.close();
});

/* ---------- Driver sign-up made simple (product owner, 2026-11-24; criteria A1–A8 in the pull request) ---------- */

test('A2, A6, A7: a driver signs up with name, email and password only, gets one welcome per request, and sees nothing until approved', async () => {
  const link = await S.mgr.call('driverLink', { orgId: S.org });
  const mara = await person('Mara Șerban', `mara.serban.${run}@test.dev`);
  // Only first and last name (Romanian letters kept), no phone, no Transporter ID; the page's language goes along.
  const r = await mara.call('requestToJoin', { token: link.token, stationId: S.s1, details: { firstName: 'Mara', lastName: 'Șerban-Ţăranu' }, lang: 'ro' });
  assert.equal(r.again, false);
  const jr = (await getDoc(doc(mara.db, 'orgs', S.org, 'joinRequests', mara.uid))).data();
  assert.equal(jr.name, 'Mara Șerban-Ţăranu');
  assert.equal(jr.phone, '');
  assert.equal(jr.transporterId, '');
  assert.equal(jr.sameTransporterId, null);
  // A6: the welcome was tried once for this request (the emulators have no mail server, so it isn't sent).
  assert.equal(typeof jr.welcomeAt, 'number');
  assert.equal(jr.welcomed, false, 'no email without SMTP_URL');
  // Pressing "Send request" again (a second tap, another tab): the same request, no second welcome.
  const again = await mara.call('requestToJoin', { token: link.token, stationId: S.s1, details: { firstName: 'Mara', lastName: 'Șerban-Ţăranu' }, lang: 'ro' });
  assert.equal(again.again, true);
  const jr2 = (await getDoc(doc(mara.db, 'orgs', S.org, 'joinRequests', mara.uid))).data();
  assert.equal(jr2.welcomeAt, jr.welcomeAt, 'one welcome per request');
  const waiting = await getDocs(query(collection(S.own.db, 'orgs', S.org, 'joinRequests'), where('uid', '==', mara.uid)));
  assert.equal(waiting.size, 1, 'one request, not two');
  // A7: still nothing of the company until someone approves.
  await fails(getDocs(query(collection(mara.db, 'orgs', S.org, 'vehicles'), where('stationId', 'in', [S.s1]))), 'permission-denied');
  await fails(getDoc(doc(mara.db, 'orgs', S.org)), 'permission-denied');
  await S.mgr.call('decideJoinRequest', { orgId: S.org, uid: mara.uid, approve: false });
});

test('A1: an account from the driver link is marked as a driver by the server (the app offers it no "Create a company"), also after a rejection', async () => {
  const link = await S.mgr.call('driverLink', { orgId: S.org });
  const nico = await person('Nico Noco');
  await nico.call('requestToJoin', { token: link.token, stationId: S.s1, details: { firstName: 'Nico', lastName: 'Noco' } });
  assert.equal((await getDoc(doc(nico.db, 'users', nico.uid))).data().signedUpAs, 'driver');
  await S.mgr.call('decideJoinRequest', { orgId: S.org, uid: nico.uid, approve: false });
  const p = (await getDoc(doc(nico.db, 'users', nico.uid))).data();
  assert.equal(p.signedUpAs, 'driver', 'the mark stays after a rejection');
  assert.equal(p.pendingJoin, undefined);
  // The person can't take the mark off from the app.
  await fails(updateDoc(doc(nico.db, 'users', nico.uid), { signedUpAs: null }), 'permission-denied');
  // Owners who signed up themselves carry no mark.
  assert.equal((await getDoc(doc(S.own.db, 'users', S.own.uid))).data()?.signedUpAs, undefined);
});

test('A6: the driver\'s welcome email: the company, the station, waiting for approval, where to get the app, in their language', async () => {
  const { joinMail } = fnRequire('./lib/joinmail.js');
  const o = { name: 'Mara', company: 'DSP One', station: 'DXX1', email: 'mara@test.dev', appUrl: 'https://app.fratius.com' };
  const en = joinMail({ ...o, lang: 'en' });
  assert.match(en.subject, /DSP One/);
  for (const x of ['DSP One', 'DXX1', 'mara@test.dev', 'https://apps.apple.com/app/id', 'https://fratius.com/android', 'https://app.fratius.com', 'approves you']) {
    assert.ok(en.text.includes(x), `the email says ${x}`);
    assert.ok(en.html.includes(x.replace(/&/g, '&amp;')), `the html says ${x}`);
  }
  // In the driver's language (here Romanian), not English.
  const ro = joinMail({ ...o, lang: 'ro' });
  assert.notEqual(ro.subject, en.subject);
  assert.match(ro.subject, /DSP One/);
  assert.ok(ro.text.includes('https://apps.apple.com/app/id'));
  // Arabic reads right to left.
  assert.match(joinMail({ ...o, lang: 'ar' }).html, /dir="rtl"/);
});

test('A6: the driver gets a notification when a fleet manager approves them', async () => {
  const link = await S.mgr.call('driverLink', { orgId: S.org });
  const pia = await person('Pia Approved', `pia.approved.${run}@test.dev`);
  await pia.call('requestToJoin', { token: link.token, stationId: S.s1, details: { firstName: 'Pia', lastName: 'Approved' } });
  const ph = await phoneOf(pia, 'pia');
  try {
    await S.mgr.call('decideJoinRequest', { orgId: S.org, uid: pia.uid, approve: true });
    const n = await waitFor(async () => ph.notes().find((m) => /DXX1/.test(m.body || '')), 'the approval notification', 30_000);
    assert.match(n.body, /approved you/);
    assert.equal((await getDoc(doc(pia.db, 'users', pia.uid))).data().orgIds.includes(S.org), true);
  } finally { await ph.close(); }
});

// ---------- Blind test, 26 Nov 2026, cause 2: the server checks who may do what (ROLES.md, tests/permissions.mjs) ----------
// A company of its own, so nothing above changes: an owner, two stations with a fleet manager each, two drivers at
// station 1 (Dora has van 1) and one at station 2, someone outside the company, Dora's walk-around and a damage check
// of it.
const P = {};
test('cause 2: a company for who may do what: owner, two stations with a manager each, three drivers, a van, a walk-around and its check', async () => {
  P.own = await person('Paula Owner', `perm.own.${run}@test.dev`);
  const org = doc(collection(P.own.db, 'orgs'));
  P.org = org.id;
  await setDoc(org, { name: 'Permission DSP', createdBy: P.own.uid, createdAt: Date.now(), stationsReady: true });
  await setDoc(doc(P.own.db, 'orgs', P.org, 'members', P.own.uid), { role: 'owner', stationIds: [], email: '', name: 'Paula Owner', joinedAt: Date.now() });
  for (const [k, name] of [['s1', 'DPM1'], ['s2', 'DPM2']]) {
    const r = doc(collection(P.own.db, 'orgs', P.org, 'stations'));
    await setDoc(r, { name, code: name, createdAt: Date.now() });
    P[k] = r.id;
  }
  const join = async (key, name, role, station) => {
    const { invites } = await P.own.call('createInvite', { orgId: P.org, role, stationId: P[station], count: 1 });
    const p = await person(name, `perm.${key}.${run}@test.dev`);
    const [firstName, lastName] = name.split(' ');
    await p.call('acceptInvite', { token: invites[0].token, details: { firstName, lastName, phone: '+49 151 9', transporterId: '' } });
    return p;
  };
  P.mgr = await join('mgr', 'Mark Manager', 'manager', 's1');
  P.mgr2 = await join('mgr2', 'Nina Manager', 'manager', 's2');
  P.d1 = await join('d1', 'Dora Driver', 'driver', 's1');
  P.d2 = await join('d2', 'Emil Driver', 'driver', 's1');
  P.d3 = await join('d3', 'Fritz Driver', 'driver', 's2');
  P.out = await person('Otto Outsider', `perm.out.${run}@test.dev`);
  // Someone who asked to join station 1 with the driver link (only an owner or station 1's manager decides).
  const link = await P.own.call('driverLink', { orgId: P.org });
  const asker = await person('Anna Asker', `perm.asker.${run}@test.dev`);
  await asker.call('requestToJoin', { token: link.token, stationId: P.s1, details: { firstName: 'Anna', lastName: 'Asker' } });
  P.asker = asker.uid;
  const vr = doc(collection(P.own.db, 'orgs', P.org, 'vehicles'));
  P.van = { id: vr.id, name: 'QUIET P1', stationId: P.s1 };
  await setDoc(vr, { name: '', plate: 'QUIET P1', cls: 'van', stationId: P.s1, createdAt: Date.now(), createdBy: P.own.uid });
  await setDoc(doc(P.own.db, 'orgs', P.org, 'vehicleDetails', vr.id), { stationId: P.s1, createdAt: Date.now(), fuelCard: 'DKV card ending 4471' });
  P.assign1 = (await P.mgr.call('assignVan', { orgId: P.org, vehicleId: vr.id, driverId: P.d1.uid })).assignmentId;
  P.walk1 = await photos(P.d1, P.org, P.van);
  P.check1 = 'permCheck1';
  await adminDb().doc(`orgs/${P.org}/checks/${P.check1}`).set({
    vehicleId: vr.id, vehicleName: 'QUIET P1', cls: 'van', walkId: P.walk1, createdAt: Date.now(), createdBy: P.d1.uid, walkBy: P.d1.uid,
    stationId: P.s1, status: 'checking', submittedAt: null, review: null, tier: 'quick', model: 'test', photos: 3, notVisible: [], missedNote: '',
    spots: [{ photo: 0, photoLabel: 'Frame 1', box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, conf: 0.8, mightBe: null,
      closeup: '', refPath: `orgs/${P.org}/checks/${P.check1}/ref1.jpg`, closeups: [], verdict: null, feedback: null, markPath: null }],
  });
});

test('cause 2 (A5): the permission table: every server action refuses everyone ROLES.md says may not do it', async () => {
  // Who must be refused, by the action's level: those below it. With a probe (a real target at station 1): also a
  // manager and (member actions) a driver of station 2; with "own": another driver of station 1 (Emil).
  const below = { creator: ['own', 'mgr', 'd1', 'out'], owner: ['mgr', 'd1', 'out'], staff: ['d1', 'out'], member: ['out'] };
  const w = { org: P.org, s1: P.s1, s2: P.s2, van1: P.van.id, walk1: P.walk1, check1: P.check1, assign1: P.assign1, d1: P.d1.uid, d2: P.d2.uid, asker: P.asker };
  const wrong = [];
  let tried = 0;
  for (const [name, a] of Object.entries(ACTIONS)) {
    if (a.level === 'self') continue;
    const tries = below[a.level].map((k) => [k, 'role']);
    if (a.probe) {
      tries.push(['mgr2', 'other station']);
      if (a.level === 'member') tries.push(['d3', 'other station']);
      if (a.own) tries.push(['d2', 'not theirs']);
    }
    for (const [k, why] of tries) {
      const p = P[k];
      tried++;
      try {
        await p.call(name, { orgId: P.org, ...(a.probe ? a.probe(w, p.uid) : {}) });
        wrong.push(`${name} as ${k} (${why}): allowed`);
      } catch (e) {
        const code = String(e.code || '').replace(/^functions\//, '');
        if (code !== 'permission-denied') wrong.push(`${name} as ${k} (${why}): ${code}: ${e.message}`);
      }
    }
  }
  assert.ok(tried >= 130, `only ${tried} calls tried`);
  assert.deepEqual(wrong, []);
});

test('cause 2 (A1, A2): only the driver who took the photos, or the station\'s staff, checks them for damage, adds close-ups and sends the check', async () => {
  const walk = await photos(P.d1, P.org, P.van, { real: true });
  const close = async (checkId) => {
    const path = `orgs/${P.org}/checks/${checkId}/c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    await uploadBytes(ref(P.d1.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const check = async (id) => (await adminDb().doc(`orgs/${P.org}/checks/${id}`).get()).data();
  // Emil (the same station) can't start a check on Dora's photos.
  await fails(P.d2.call('findDamage', { orgId: P.org, walkId: walk, tier: 'quick' }), 'permission-denied');
  // Dora's own check: Emil can't add close-ups or send it; Dora can, and so can their manager.
  const own = await P.d1.call('findDamage', { orgId: P.org, walkId: walk, tier: 'quick' });
  assert.equal(own.spots.length, 1);
  assert.equal((await check(own.checkId)).walkBy, P.d1.uid);
  await fails(P.d2.call('checkSpot', { orgId: P.org, checkId: own.checkId, spot: 0, closeups: [await close(own.checkId)] }), 'permission-denied');
  await fails(P.d2.call('submitCheck', { orgId: P.org, checkId: own.checkId }), 'permission-denied');
  assert.equal((await P.d1.call('checkSpot', { orgId: P.org, checkId: own.checkId, spot: 0, closeups: [await close(own.checkId)] })).verdict.verdict, 'damage');
  await P.mgr.call('submitCheck', { orgId: P.org, checkId: own.checkId });
  // A2: the manager runs the check on Dora's photos: it is the manager's run, but the photos (and so the damage) are
  // Dora's, and Dora takes the close-ups.
  const m = await P.mgr.call('findDamage', { orgId: P.org, walkId: walk, tier: 'quick' });
  const mk = await check(m.checkId);
  assert.equal(mk.createdBy, P.mgr.uid);
  assert.equal(mk.walkBy, P.d1.uid);
  await fails(P.d2.call('checkSpot', { orgId: P.org, checkId: m.checkId, spot: 0, closeups: [await close(m.checkId)] }), 'permission-denied');
  await P.d1.call('checkSpot', { orgId: P.org, checkId: m.checkId, spot: 0, closeups: [await close(m.checkId)] });
  await fails(P.d2.call('submitCheck', { orgId: P.org, checkId: m.checkId }), 'permission-denied');
  await P.d1.call('submitCheck', { orgId: P.org, checkId: m.checkId });
  assert.equal((await check(m.checkId)).status, 'submitted');
  // A driver of the other station: not at all.
  await fails(P.d3.call('findDamage', { orgId: P.org, walkId: walk, tier: 'quick' }), 'permission-denied');
});

test('cause 2 (A4): a driver without a van can\'t start a refuel or wash; nobody starts a second one while one waits for the manager', async () => {
  const shot = async (p) => {
    const path = `orgs/${P.org}/buys/${p.uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const buy = async (id) => (await adminDb().doc(`orgs/${P.org}/purchases/${id}`).get()).data();
  // Emil has no van.
  for (const kind of ['fuel', 'wash']) {
    const e = await fails(P.d2.call('purchase', { orgId: P.org, action: 'start', kind, vehicleId: P.van.id, path: await shot(P.d2) }), 'permission-denied');
    assert.match(e.message, /You don't have a van/);
  }
  // Dora has van 1. Her refuel stops at the pump (no fuel card) and waits for the manager.
  const b = await P.d1.call('purchase', { orgId: P.org, action: 'start', kind: 'fuel', vehicleId: P.van.id, path: await shot(P.d1) });
  assert.equal((await P.d1.call('purchase', { orgId: P.org, action: 'card', id: b.id, missing: true })).result, 'missing');
  assert.equal((await buy(b.id)).status, 'waiting');
  // A second one now is refused, and the first keeps waiting for the answer.
  const e2 = await fails(P.d1.call('purchase', { orgId: P.org, action: 'start', kind: 'wash', vehicleId: P.van.id, path: await shot(P.d1) }), 'failed-precondition');
  assert.match(e2.message, /hasn't answered/);
  assert.equal((await buy(b.id)).status, 'waiting');
  // Once the manager has answered, the next one starts (the refused one is closed, and stays in the history).
  await P.mgr.call('purchase', { orgId: P.org, action: 'decide', id: b.id, allow: false });
  const n = await P.d1.call('purchase', { orgId: P.org, action: 'start', kind: 'wash', vehicleId: P.van.id, path: await shot(P.d1) });
  assert.equal((await buy(b.id)).status, 'cancelled');
  await P.d1.call('purchase', { orgId: P.org, action: 'cancel', id: n.id });
  // Fleet managers refuel their station's vans without having one.
  const mb = await P.mgr.call('purchase', { orgId: P.org, action: 'start', kind: 'fuel', vehicleId: P.van.id, path: await shot(P.mgr) });
  await P.mgr.call('purchase', { orgId: P.org, action: 'cancel', id: mb.id });
});

// ---------- Blind test, 26 Nov 2026, cause 2b: the driver link, the km, numbers that can't be right, closing a company ----------
test('cause 2b (B1, B2): every company has its driver link from the start; owners and managers make a new one, and the others are told', async () => {
  // A company made by the server has it when it's made.
  const o = await person('Lina Linkowner', `b1.own.${run}@test.dev`);
  const r = await o.call('createCompany', { company: 'Link DSP', station: 'DLK1', name: 'Lina Linkowner', terms: '2026-11-20', rid: `b1cc${run}` });
  const made = (await getDoc(doc(o.db, 'orgs', r.orgId, 'links', 'drivers'))).data();
  assert.ok(made?.token);
  assert.equal(made.createdBy, o.uid);
  assert.equal((await o.call('driverLink', { orgId: r.orgId })).token, made.token);
  // A company made another way (here straight in the database, as the tests do) gets it too, by itself.
  const pl = await waitFor(async () => (await adminDb().doc(`orgs/${P.org}/links/drivers`).get()).data(), 'the driver link of a new company');
  assert.ok(pl.token);
  // A fleet manager makes a new link: the old one stops, and the owner and the other station's manager are told who.
  const ownPhone = await phoneOf(P.own, 'b2own');
  const mgr2Phone = await phoneOf(P.mgr2, 'b2mgr2');
  try {
    const now = await P.mgr.call('driverLink', { orgId: P.org });
    const fresh = await P.mgr.call('driverLink', { orgId: P.org, reset: true });
    assert.notEqual(fresh.token, now.token);
    assert.equal(fresh.createdByName, 'Mark Manager');
    const late = await person('Lou Late', `b2.late.${run}@test.dev`);
    assert.equal((await late.call('peekInvite', { token: now.token })).status, 'replaced');
    assert.equal((await late.call('peekInvite', { token: fresh.token })).status, 'ok');
    for (const ph of [ownPhone, mgr2Phone]) {
      const n = await waitFor(async () => ph.notes().find((m) => /New driver link/.test(m.title || '')), 'the new link notification');
      assert.match(n.title, /Permission DSP/);
      assert.match(n.body, /Mark Manager/);
    }
    // The owner too; drivers never.
    assert.notEqual((await P.own.call('driverLink', { orgId: P.org, reset: true })).token, fresh.token);
    await fails(P.d1.call('driverLink', { orgId: P.org, reset: true }), 'permission-denied');
  } finally { await ownPhone.close(); await mgr2Phone.close(); }
});

test('cause 2b (B3, B4): 0 km is refused; a lower km is asked again, then kept apart with the van keeping its km and the manager told', async () => {
  await updateDoc(doc(P.own.db, 'orgs', P.org), { dashScans: true, dashScansBy: 'Paula Owner', dashScansAt: Date.now() });
  // The van has 50,000 km in its record (the stand-in for the AI reads 48,213 from every dashboard photo).
  await setDoc(doc(P.mgr.db, 'orgs', P.org, 'vehicleDetails', P.van.id), { odometerKm: 50000, odometerAt: '2026-11-26' }, { merge: true });
  const shot = async (p, folder) => {
    const path = `orgs/${P.org}/${folder}/${p.uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
    await uploadBytes(ref(p.st, path), jpeg(), { contentType: 'image/jpeg' });
    return path;
  };
  const det = async () => (await adminDb().doc(`orgs/${P.org}/vehicleDetails/${P.van.id}`).get()).data();
  const ph = await phoneOf(P.mgr, 'b4mgr');
  try {
    const r = await P.d1.call('readDashboard', { orgId: P.org, vehicleId: P.van.id, path: await shot(P.d1, 'dash') });
    assert.equal(r.values.odometerKm, 48213);
    assert.equal(r.vanKm, 50000);
    await fails(P.d1.call('saveReading', { orgId: P.org, readId: r.readId, values: { odometerKm: 0 }, refuel: null, typed: true }), 'invalid-argument');
    await fails(P.d1.call('saveReading', { orgId: P.org, readId: r.readId, values: { odometerKm: -5 }, refuel: null, typed: true }), 'invalid-argument');
    // As the AI read it: asked to type it.
    const e = await fails(P.d1.call('saveReading', { orgId: P.org, readId: r.readId, values: { odometerKm: 48213 }, refuel: null }), 'failed-precondition');
    assert.match(e.message, /less than the van's/);
    // Typed, and still lower: saved as typed, the van keeps its 50,000 km, the manager is told both numbers.
    const s1 = await P.d1.call('saveReading', { orgId: P.org, readId: r.readId, values: { odometerKm: 48200 }, refuel: null, typed: true });
    assert.equal(s1.kmKept, 50000);
    const reading = (await adminDb().doc(`orgs/${P.org}/readings/${s1.readingId}`).get()).data();
    assert.equal(reading.odometerKm, 48200);
    assert.deepEqual(reading.kmLower, { typed: 48200, kept: 50000 });
    assert.equal((await det()).odometerKm, 50000);
    assert.equal((await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().dash.km, 50000);
    // The flag the managers see in Review (blind tester, round 2 on #54): on the van, both numbers, who by account id.
    const flag = (await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().kmLower;
    assert.deepEqual([flag.typed, flag.kept, flag.by], [48200, 50000, P.d1.uid]);
    await fails(updateDoc(doc(P.mgr.db, 'orgs', P.org, 'vehicles', P.van.id), { kmLower: null }), 'permission-denied');
    const n = await waitFor(async () => ph.notes().find((m) => /Odometer lower/.test(m.title || '')), 'the lower km notification');
    assert.match(n.body, /48200/);
    assert.match(n.body, /50000/);
    // A refuel the same: 0 refused, lower asked again, then typed: done, flagged, the van keeps its km.
    const b = await P.d1.call('purchase', { orgId: P.org, action: 'start', kind: 'fuel', vehicleId: P.van.id, path: await shot(P.d1, 'buys') });
    await P.d1.call('purchase', { orgId: P.org, action: 'card', id: b.id, missing: true });
    await P.mgr.call('purchase', { orgId: P.org, action: 'decide', id: b.id, allow: true });
    await P.d1.call('purchase', { orgId: P.org, action: 'receipt', id: b.id, path: await shot(P.d1, 'buys') });
    const values = (km) => ({ odometerKm: km, fuelPct: 25, litres: 45.2, total: 79.1 });
    await fails(P.d1.call('purchase', { orgId: P.org, action: 'finish', id: b.id, values: values(0), typed: true }), 'invalid-argument');
    await fails(P.d1.call('purchase', { orgId: P.org, action: 'finish', id: b.id, values: values(40000) }), 'failed-precondition');
    const f = await P.d1.call('purchase', { orgId: P.org, action: 'finish', id: b.id, values: values(40000), typed: true });
    assert.ok(f.flags.some((x) => x.key === 'odometer'));
    assert.deepEqual((({ typed, kept }) => [typed, kept])((await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().kmLower), [40000, 50000]);
    assert.equal((await det()).odometerKm, 50000);
    assert.equal((await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().dash.km, 50000);
    // Higher is saved as usual.
    const r2 = await P.d1.call('readDashboard', { orgId: P.org, vehicleId: P.van.id, path: await shot(P.d1, 'dash') });
    await P.d1.call('saveReading', { orgId: P.org, readId: r2.readId, values: { odometerKm: 50120 }, refuel: null, typed: true });
    assert.equal((await det()).odometerKm, 50120);
    // From the app: the record's odometer can't go down or be 0 (the rules), only up.
    await fails(setDoc(doc(P.mgr.db, 'orgs', P.org, 'vehicleDetails', P.van.id), { odometerKm: 49000 }, { merge: true }), 'permission-denied');
    await fails(setDoc(doc(P.mgr.db, 'orgs', P.org, 'vehicleDetails', P.van.id), { odometerKm: 0 }, { merge: true }), 'permission-denied');
    await setDoc(doc(P.mgr.db, 'orgs', P.org, 'vehicleDetails', P.van.id), { odometerKm: 50200 }, { merge: true });
  } finally { await ph.close(); }
});

test('cause 2b (B5): an owner or the station\'s manager corrects km that are too high, with a reason; the van\'s history keeps old, new, who and why', async () => {
  const det = async () => (await adminDb().doc(`orgs/${P.org}/vehicleDetails/${P.van.id}`).get()).data();
  const before = (await det()).odometerKm;
  await fails(P.mgr.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: 48300, reason: '' }), 'invalid-argument');
  await fails(P.mgr.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: 0, reason: 'Misread photo' }), 'invalid-argument');
  await fails(P.mgr.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: before + 100, reason: 'Misread photo' }), 'failed-precondition');
  await fails(P.d1.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: 48300, reason: 'Misread photo' }), 'permission-denied');
  const c = await P.mgr.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: 48300, reason: 'Misread photo' });
  assert.deepEqual([c.from, c.to], [before, 48300]);
  assert.equal((await det()).odometerKm, 48300);
  assert.equal((await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().dash.km, 48300);
  // Corrected: the managers' flag of a lower km goes.
  assert.equal((await adminDb().doc(`orgs/${P.org}/vehicles/${P.van.id}`).get()).data().kmLower, undefined);
  // The history: the station's manager and the owner read it (as the app asks); drivers and other stations don't.
  const q = (p, st) => getDocs(query(collection(p.db, 'orgs', P.org, 'kmCorrections'), where('vehicleId', '==', P.van.id), ...(st ? [where('stationId', 'in', st)] : [])));
  const rows = (await q(P.mgr, [P.s1])).docs.map((d) => d.data());
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].from, rows[0].to, rows[0].by, rows[0].byName, rows[0].reason], [before, 48300, P.mgr.uid, 'Mark Manager', 'Misread photo']);
  assert.equal((await q(P.own)).size, 1);
  await fails(q(P.d1, [P.s1]), 'permission-denied');
  await fails(q(P.mgr2, [P.s1]), 'permission-denied');
  assert.equal((await q(P.mgr2, [P.s2])).size, 0);
  await fails(setDoc(doc(P.own.db, 'orgs', P.org, 'kmCorrections', 'fake'), { vehicleId: P.van.id, stationId: P.s1, from: 1, to: 1 }), 'permission-denied');
  // The owner too.
  await P.own.call('correctKm', { orgId: P.org, vehicleId: P.van.id, km: 48250, reason: 'Typo in the service invoice' });
  assert.equal((await det()).odometerKm, 48250);
});

test('cause 2b (B6): impossible numbers are refused on the server too: a service at 0 km', async () => {
  const svc = (id, km) => ({ orgId: P.org, action: 'add', id, vehicleId: P.van.id, kind: 'service', day: '2026-11-20', km, cost: 10, garage: 'Garage', note: '' });
  const e = await fails(P.mgr.call('service', svc('b6svc0', 0)), 'invalid-argument');
  assert.match(e.message, /more than 0/);
  await fails(P.mgr.call('service', svc('b6svc1', -40)), 'invalid-argument');
  await P.mgr.call('service', svc('b6svc2', 48300));
});

test('cause 2b (B7): the only member deleting their account closes the company: records kept, read-only, reopened only by the app creator with a one-time owner link', async () => {
  const solo = await person('Sol Single', `b7.solo.${run}@test.dev`);
  const r = await solo.call('createCompany', { company: 'Single DSP', station: 'DSG1', name: 'Sol Single', terms: '2026-11-20', rid: `b7cc${run}` });
  const st = (await getDocs(collection(solo.db, 'orgs', r.orgId, 'stations'))).docs[0].id;
  const vr = doc(collection(solo.db, 'orgs', r.orgId, 'vehicles'));
  await setDoc(vr, { name: '', plate: 'SG 1', cls: 'van', stationId: st, createdAt: Date.now(), createdBy: solo.uid });
  const link = (await getDoc(doc(solo.db, 'orgs', r.orgId, 'links', 'drivers'))).data().token;
  assert.deepEqual((await solo.call('deleteAccount', { check: true })).companies.map((c) => c.outcome), ['close']);
  assert.deepEqual(await solo.call('deleteAccount', {}), { ok: true, closed: ['Single DSP'] });
  const org = (await adminDb().doc(`orgs/${r.orgId}`).get()).data();
  assert.ok(org.closed.at > 0);
  assert.equal(org.closed.byName, 'Sol Single');
  // The records stay; the person is gone from it; the driver link stops.
  assert.equal((await adminDb().doc(`orgs/${r.orgId}/vehicles/${vr.id}`).get()).exists, true);
  assert.equal((await adminDb().doc(`orgs/${r.orgId}/members/${solo.uid}`).get()).exists, false);
  const nobody = await person('Nia Nobody', `b7.nobody.${run}@test.dev`);
  assert.equal((await nobody.call('peekInvite', { token: link })).status, 'replaced');
  // Read-only for the app creator too: no server action, no write, no owner link while closed; they still read it.
  const cr = await appCreator('Rae Reopen');
  assert.equal((await getDoc(doc(cr.db, 'orgs', r.orgId))).data().closed.byName, 'Sol Single');
  const e = await fails(cr.call('retireVan', { orgId: r.orgId, vehicleId: vr.id }), 'failed-precondition');
  assert.match(e.message, /closed/);
  await fails(updateDoc(doc(cr.db, 'orgs', r.orgId, 'vehicles', vr.id), { color: 'white' }), 'permission-denied');
  await fails(cr.call('ownerLink', { orgId: r.orgId }), 'failed-precondition');
  // Nobody else reopens it.
  await fails(nobody.call('reopenCompany', { orgId: r.orgId }), 'permission-denied');
  // The app creator reopens it and makes a one-time owner link; its next owner joins with it.
  await cr.call('reopenCompany', { orgId: r.orgId });
  const again = (await adminDb().doc(`orgs/${r.orgId}`).get()).data();
  assert.equal(again.closed, undefined);
  assert.equal(again.reopens.length, 1);
  await fails(cr.call('reopenCompany', { orgId: r.orgId }), 'failed-precondition');
  const { invite } = await cr.call('ownerLink', { orgId: r.orgId });
  const next = await person('Nell Nextowner', `b7.next.${run}@test.dev`);
  await next.call('acceptInvite', { token: invite.token, details: { firstName: 'Nell', lastName: 'Nextowner' } });
  const m = (await getDoc(doc(next.db, 'orgs', r.orgId, 'members', next.uid))).data();
  assert.equal(m.role, 'owner');
  assert.deepEqual(m.stationIds, []);
  await fails(nobody.call('acceptInvite', { token: invite.token, details: { firstName: 'Nia', lastName: 'Nobody' } }), 'failed-precondition');
  await updateDoc(doc(next.db, 'orgs', r.orgId, 'vehicles', vr.id), { color: 'white' });
});

// ---------- Blind test, 26 Nov 2026, cause 3a: drivers see only their own van and pick one up by its plate ----------
// In the company of cause 2 (Dora has QUIET P1 at station 1, Emil at station 1 has none). The stand-in for the AI reads
// the van's own plate on pick-up photos, B-SW 9999 when the plate says SWAP and nothing when it says DIRTY
// (functions/src/claude.ts). Vans written as the server would, so the plan's van count doesn't matter.
async function plateVan(plate, st = 's1') {
  const r = adminDb().collection(`orgs/${P.org}/vehicles`).doc();
  await r.set({ name: plate ? '' : 'Spare van', ...(plate ? { plate } : {}), cls: 'van', stationId: P[st], createdAt: Date.now(), createdBy: P.own.uid });
  return { id: r.id, name: plate || 'Spare van', stationId: P[st], plate };
}
const pVan = async (id) => (await adminDb().doc(`orgs/${P.org}/vehicles/${id}`).get()).data();

test('cause 3a (1a): a driver reads only the van they have, its walk-arounds and checks, and their own; never the station\'s other vans, also by link', async () => {
  const mgrWalk = await photos(P.mgr, P.org, P.van);
  const q = (p, c, f) => getDocs(query(collection(p.db, 'orgs', P.org, c), where(f, '==', p.uid)));
  // Dora has the van: she reads it, its walk-arounds (the manager's too) and its check.
  assert.equal((await getDoc(doc(P.d1.db, 'orgs', P.org, 'vehicles', P.van.id))).data().plate, 'QUIET P1');
  for (const w of [P.walk1, mgrWalk]) assert.ok((await getDoc(doc(P.d1.db, 'orgs', P.org, 'walkarounds', w))).exists(), w);
  assert.ok((await getDoc(doc(P.d1.db, 'orgs', P.org, 'checks', P.check1))).exists());
  // The app's lists for a driver (src/lib/store.ts): the van they have, the walk-arounds they took, the checks of their photos.
  assert.deepEqual((await q(P.d1, 'vehicles', 'assignedTo.driverId')).docs.map((d) => d.id), [P.van.id]);
  assert.ok((await q(P.d1, 'walkarounds', 'createdBy')).docs.some((d) => d.id === P.walk1));
  assert.ok((await q(P.d1, 'checks', 'walkBy')).docs.some((d) => d.id === P.check1));
  // Emil, at the same station without a van: nothing of Dora's, not by link, not by the station's lists.
  for (const [c, id] of [['vehicles', P.van.id], ['walkarounds', P.walk1], ['walkarounds', mgrWalk], ['checks', P.check1]]) {
    await fails(getDoc(doc(P.d2.db, 'orgs', P.org, c, id)), 'permission-denied');
  }
  for (const c of ['vehicles', 'walkarounds', 'checks']) {
    await fails(getDocs(query(collection(P.d2.db, 'orgs', P.org, c), where('stationId', 'in', [P.s1]))), 'permission-denied');
  }
  assert.equal((await q(P.d2, 'vehicles', 'assignedTo.driverId')).size, 0);
  // The station's manager and the owner read all of it; the other station's manager nothing.
  for (const p of [P.mgr, P.own]) {
    assert.ok((await getDocs(query(collection(p.db, 'orgs', P.org, 'vehicles'), where('stationId', 'in', [P.s1])))).docs.some((d) => d.id === P.van.id));
    for (const [c, id] of [['walkarounds', P.walk1], ['walkarounds', mgrWalk], ['checks', P.check1]]) assert.ok((await getDoc(doc(p.db, 'orgs', P.org, c, id))).exists());
  }
  await fails(getDoc(doc(P.mgr2.db, 'orgs', P.org, 'vehicles', P.van.id)), 'permission-denied');
});

test('cause 3a (1b): drivers pick up a van by its number plate, at their station; a van without a plate only the manager gives out', async () => {
  await P.mgr.call('setSelfAssign', { orgId: P.org, stationId: P.s1, on: true });
  P.p2 = await plateVan('QUIET P2');
  const noPlate = await plateVan(null), other = await plateVan('QUIET S2', 's2');
  // Typed in any case and spacing: the van, free.
  const f = await P.d2.call('vanByPlate', { orgId: P.org, plate: ' quiet  p2 ' });
  assert.deepEqual([f.id, f.plate, f.mine, f.taken, f.expect], [P.p2.id, 'QUIET P2', false, false, null]);
  // Not in the company, at another station, nothing typed: refused.
  const nf = await fails(P.d2.call('vanByPlate', { orgId: P.org, plate: 'QUIET P9' }), 'not-found');
  assert.match(nf.message, /QUIET P9/);
  await fails(P.d2.call('vanByPlate', { orgId: P.org, plate: 'QUIET S2' }), 'permission-denied');
  await fails(P.d2.call('vanByPlate', { orgId: P.org, plate: '' }), 'invalid-argument');
  // Dora's van: taken, with the handover the screen sends back, and never her name.
  const t = await P.d2.call('vanByPlate', { orgId: P.org, plate: 'QUIET P1' });
  assert.deepEqual([t.taken, t.mine, t.expect], [true, false, P.assign1]);
  assert.ok(!/Dora/.test(JSON.stringify(t)), JSON.stringify(t));
  // The pick-up: the van's plate exactly. None given, or another van's: refused, nothing changes.
  const walk = await photos(P.d2, P.org, P.p2, { real: true });
  await fails(P.d2.call('pickUpVan', { orgId: P.org, vehicleId: P.p2.id, walkId: walk }), 'failed-precondition');
  const e = await fails(P.d2.call('pickUpVan', { orgId: P.org, vehicleId: P.p2.id, plate: 'QUIET P1', walkId: walk }), 'failed-precondition');
  assert.match(e.message, /isn't the plate of this van/);
  // No plate on the van: no pick-up by a driver (the manager gives it out). Another station's van: refused as such.
  const np = await fails(P.d2.call('pickUpVan', { orgId: P.org, vehicleId: noPlate.id, plate: '', walkId: await photos(P.d2, P.org, noPlate) }), 'failed-precondition');
  assert.match(np.message, /no number plate/);
  await fails(P.d2.call('pickUpVan', { orgId: P.org, vehicleId: other.id, plate: 'QUIET S2', walkId: walk }), 'permission-denied');
  assert.equal((await pVan(P.p2.id)).assignedTo ?? null, null);
  // With its plate (any spacing): picked up; the photos showed it, so nothing is flagged.
  const r = await P.d2.call('pickUpVan', { orgId: P.org, vehicleId: P.p2.id, plate: 'quiet-p2', walkId: walk });
  assert.equal((await pVan(P.p2.id)).assignedTo.driverId, P.d2.uid);
  assert.equal((await adminDb().doc(`orgs/${P.org}/assignments/${r.assignmentId}`).get()).data().plateUnread, undefined);
  assert.equal((await P.d2.call('vanByPlate', { orgId: P.org, plate: 'QUIET P2' })).mine, true);
  assert.equal((await getDoc(doc(P.d2.db, 'orgs', P.org, 'vehicles', P.p2.id))).data().plate, 'QUIET P2');
  // Dropped off: no longer his to read.
  await P.d2.call('dropOffVan', { orgId: P.org, vehicleId: P.p2.id, walkId: await photos(P.d2, P.org, P.p2) });
  await fails(getDoc(doc(P.d2.db, 'orgs', P.org, 'vehicles', P.p2.id)), 'permission-denied');
});

test('cause 3a (1c): the pick-up photos must show the van\'s plate: another plate is refused naming both; unreadable goes through and the manager is told', async () => {
  const swap = await plateVan('QUIET SWAP3'), dirty = await plateVan('QUIET DIRTY4');
  const mgrPhone = await phoneOf(P.mgr, 'c3a1c');
  try {
    const e = await fails(P.d2.call('pickUpVan', { orgId: P.org, vehicleId: swap.id, plate: 'QUIET SWAP3', walkId: await photos(P.d2, P.org, swap, { real: true }) }), 'failed-precondition');
    assert.equal(e.message, 'These photos show B-SW 9999, not QUIET SWAP3. Take the photos at QUIET SWAP3.');
    assert.equal((await pVan(swap.id)).assignedTo ?? null, null);
    const r = await P.d2.call('pickUpVan', { orgId: P.org, vehicleId: dirty.id, plate: 'QUIET DIRTY4', walkId: await photos(P.d2, P.org, dirty, { real: true }) });
    assert.equal((await pVan(dirty.id)).assignedTo.driverId, P.d2.uid);
    assert.equal((await adminDb().doc(`orgs/${P.org}/assignments/${r.assignmentId}`).get()).data().plateUnread, true);
    const n = await waitFor(async () => mgrPhone.notes().find((m) => m.title === 'Plate not read: QUIET DIRTY4'), 'the manager\'s notification');
    assert.equal(n.body, 'The plate couldn\'t be read on Emil Driver\'s pick-up photos. Check it\'s the right van.');
    await P.d2.call('dropOffVan', { orgId: P.org, vehicleId: dirty.id, walkId: await photos(P.d2, P.org, dirty) });
  } finally { await mgrPhone.close(); }
});

test('cause 3a (1d): a van another driver has now is taken over only once the driver says so; that driver and the manager hear about it', async () => {
  const doraPhone = await phoneOf(P.d1, 'c3a1d'), mgrPhone = await phoneOf(P.mgr, 'c3a1dm');
  try {
    const walk = await photos(P.d2, P.org, P.van, { real: true });
    const pick = { orgId: P.org, vehicleId: P.van.id, plate: 'QUIET P1', walkId: walk };
    // Asked first; the refusal carries the handover it saw. Nothing changes.
    const e = await fails(P.d2.call('pickUpVan', pick), 'already-exists');
    assert.equal(e.message, 'Another driver has this van now. Take it over?');
    assert.equal(e.details?.v?.expect, P.assign1);
    assert.equal((await pVan(P.van.id)).assignedTo.driverId, P.d1.uid);
    // "Take it over" from a screen that showed another handover than the one now: refused too.
    await fails(P.d2.call('pickUpVan', { ...pick, takeOver: true, expect: 'anotherHandover' }), 'failed-precondition');
    const r = await P.d2.call('pickUpVan', { ...pick, takeOver: true, expect: P.assign1 });
    assert.equal(r.tookOver, true);
    P.assign2 = r.assignmentId;
    const prev = (await adminDb().doc(`orgs/${P.org}/assignments/${P.assign1}`).get()).data();
    assert.deepEqual([prev.endReason, prev.endedBy, prev.endWalkId], ['taken over', P.d2.uid, walk]);
    // Dora hears it (without Emil's name); the manager hears who took it from whom.
    const dn = await waitFor(async () => doraPhone.notes().find((m) => m.title === 'QUIET P1 was taken over'), 'Dora\'s notification');
    assert.ok(!/Emil/.test(JSON.stringify(dn)), JSON.stringify(dn));
    const mn = await waitFor(async () => mgrPhone.notes().find((m) => m.title === 'QUIET P1 taken over'), 'the manager\'s notification');
    assert.equal(mn.body, 'Emil Driver took it over from Dora Driver.');
    // Dora no longer reads the van, Emil does.
    await fails(getDoc(doc(P.d1.db, 'orgs', P.org, 'vehicles', P.van.id)), 'permission-denied');
    assert.equal((await getDoc(doc(P.d2.db, 'orgs', P.org, 'vehicles', P.van.id))).data().assignedTo.driverId, P.d2.uid);
  } finally { await doraPhone.close(); await mgrPhone.close(); }
});

test('cause 3a (7): every action that gives out, takes over or ends a handover is refused when who has the van changed since the screen showed it', async () => {
  const stale = P.assign1;
  const tries = [
    ['assignVan', P.mgr, { vehicleId: P.van.id, driverId: P.d1.uid, expect: stale }],
    ['assignVan', P.mgr, { vehicleId: P.van.id, driverId: null, expect: null }],
    ['retireVan', P.mgr, { vehicleId: P.van.id, expect: stale }],
    ['moveVan', P.own, { vehicleId: P.van.id, stationId: P.s2, expect: stale }],
    ['changePerson', P.own, { uid: P.d2.uid, stationId: P.s2, expect: stale }],
    ['removePerson', P.mgr, { uid: P.d2.uid, expect: stale }],
    ['pickUpVan', P.d1, { vehicleId: P.van.id, plate: 'QUIET P1', walkId: await photos(P.d1, P.org, P.van, { real: true }), takeOver: true, expect: stale }],
  ];
  const wrong = [];
  for (const [fn, p, data] of tries) {
    try { await p.call(fn, { orgId: P.org, ...data }); wrong.push(`${fn}: done`); } catch (e) {
      const code = String(e.code || '').replace(/^functions\//, '');
      if (code !== 'failed-precondition' || !/changed/.test(e.message)) wrong.push(`${fn}: ${code}: ${e.message}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.equal((await pVan(P.van.id)).assignedTo.assignmentId, P.assign2, 'Emil still has the van');
  assert.equal((await adminDb().doc(`orgs/${P.org}/members/${P.d2.uid}`).get()).data().stationIds[0], P.s1);
  // With what the screen shows now: done (the manager ends Emil's handover, then retires the free van and brings it back).
  await P.mgr.call('assignVan', { orgId: P.org, vehicleId: P.van.id, driverId: null, expect: P.assign2 });
  assert.equal((await pVan(P.van.id)).assignedTo, null);
  await P.mgr.call('retireVan', { orgId: P.org, vehicleId: P.van.id, expect: null });
  await P.mgr.call('retireVan', { orgId: P.org, vehicleId: P.van.id, restore: true, expect: null });
  assert.ok(!(await pVan(P.van.id)).retired);
});
