// Van assignments and their permanent history, end to end: real sign-in, Firestore rules, Cloud Functions and
// Storage on the Firebase emulators. These are the rules that must not change (ROLES.md, "Vans, drivers and
// history"): a van has one driver at a time and a driver one van; history is written by the server only and
// never edited or deleted; drivers pick up and drop off vans themselves only where the station allows it, and
// only with a full set of photos.
//
// Run: npx firebase-tools emulators:exec --only auth,firestore,functions,storage --project demo-fleet-check "npm --prefix tests run history"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage';

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

/** A walk-around with every photo uploaded, as the app's scanner saves it. */
async function photos(p, orgId, van, { frames = 3, source = 'camera', skipped = 0 } = {}) {
  const id = doc(collection(p.db, 'orgs', orgId, 'walkarounds')).id;
  const ps = [];
  for (let n = 1; n <= frames; n++) {
    const path = `orgs/${orgId}/walkarounds/${id}/0${n}.jpg`;
    await uploadBytes(ref(p.st, path), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
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
const FFMPEG = createRequire(new URL('../functions/package.json', import.meta.url))('ffmpeg-static');
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
  await fails(S.mgr.call('moveVan', { orgId: S.org, vehicleId: v1.id, stationId: S.s2 }), 'permission-denied');
  await S.own.call('moveVan', { orgId: S.org, vehicleId: v1.id, stationId: S.s2 });
  const v1d = await vanDoc(S.own, v1.id);
  assert.equal(v1d.stationId, S.s2);
  assert.equal(v1d.assignedTo, null);
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
  const van = { id: open[0].vehicleId, name: open[0].vehicleName, stationId: open[0].stationId };
  await alex.call('dropOffVan', { orgId, vehicleId: van.id, walkId: await photos(alex, orgId, van) });
  const v = (await getDoc(doc(alex.db, 'orgs', orgId, 'vehicles', van.id))).data();
  assert.equal(v.assignedTo, null);
  await me.call('deleteDemoCompany', { orgId });
  await fails(person(null, login.email, login.password));
});
