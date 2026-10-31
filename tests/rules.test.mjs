// Firestore rules for the roles: app creator, owner, manager, driver. Runs against the Firestore emulator:
//   npx firebase-tools emulators:exec --only firestore --project demo-fleet "npm --prefix tests test"
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

let env;
const O = 'org1', O2 = 'org2', S1 = 'st1', S2 = 'st2';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-fleet',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    await put(`orgs/${O}`, { name: 'DSP One', createdBy: 'own', createdAt: 1, stationsReady: true });
    await put(`orgs/${O2}`, { name: 'DSP Two', createdBy: 'own2', createdAt: 1, stationsReady: true });
    await put(`orgs/${O}/stations/${S1}`, { name: 'DXX1', code: 'DXX1', createdAt: 1 });
    await put(`orgs/${O}/stations/${S2}`, { name: 'DXX2', code: 'DXX2', createdAt: 2 });
    await put(`orgs/${O}/members/own`, { role: 'owner', stationIds: [], name: 'Owner', email: 'o@x' });
    await put(`orgs/${O}/members/legacy`, { role: 'admin', name: 'Old admin', email: 'a@x' });
    await put(`orgs/${O}/members/mgr1`, { role: 'manager', stationIds: [S1], name: 'Manager 1', email: 'm@x' });
    await put(`orgs/${O}/members/drv1`, { role: 'driver', stationIds: [S1], name: 'Driver 1', email: 'd1@x' });
    await put(`orgs/${O}/members/drv2`, { role: 'driver', stationIds: [S2], name: 'Driver 2', email: 'd2@x' });
    await put(`orgs/${O2}/members/own2`, { role: 'owner', stationIds: [], name: 'Owner 2', email: 'o2@x' });
    await put(`orgs/${O}/vehicles/v1`, { name: 'Van 1', stationId: S1, createdAt: 1 });
    await put(`orgs/${O}/vehicles/v2`, { name: 'Van 2', stationId: S2, createdAt: 2 });
    await put(`orgs/${O2}/vehicles/x1`, { name: 'Other', stationId: 'z', createdAt: 1 });
    await put(`orgs/${O}/walkarounds/w1`, { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 1 });
    await put(`orgs/${O}/checks/c1`, { vehicleId: 'v1', stationId: S1, status: 'submitted', spots: [], review: null, createdAt: 1 });
    await put(`orgs/${O}/checks/c2`, { vehicleId: 'v2', stationId: S2, status: 'submitted', spots: [], review: null, createdAt: 2 });
    await put(`orgs/${O}/scans/sc1`, { predicted: 'suv', verdict: null, actual: null, createdAt: 1 });
    await put(`orgs/${O}/assignments/a1`, { vehicleId: 'v1', driverId: 'drv1', driverName: 'Driver 1', stationId: S1, start: 1, end: null, createdAt: 1 });
    await put(`orgs/${O}/assignments/a2`, { vehicleId: 'v2', driverId: 'drv2', driverName: 'Driver 2', stationId: S2, start: 1, end: 5, createdAt: 1 });
    await put(`orgs/${O}/videos/vd1`, { vehicleId: 'v1', stationId: S1, by: 'drv1', kind: 'pickup', createdAt: 1 });
    await put(`orgs/${O}/videos/vd2`, { vehicleId: 'v1', stationId: S1, by: 'mgr1', kind: 'dropoff', createdAt: 1 });
    // The app creator viewing company O as a driver, a manager and an owner (three creator accounts, to test each
    // at once); a creator being themselves; and a driver who wrote a viewAs on their profile (means nothing).
    await put('users/vdrv', { orgId: O, viewAs: { org: O, role: 'driver', st: S1 } });
    await put('users/vmgr', { orgId: O, viewAs: { org: O, role: 'manager', st: S1 } });
    await put('users/vown', { orgId: O, viewAs: { org: O, role: 'owner', st: null } });
    await put('users/boss2', { orgId: O, viewAs: null });
    await put('users/drv2', { orgId: O, viewAs: { org: O, role: 'owner', st: null } });
    await put('config/push', { vapidPublicKey: 'BPUBLIC', updatedAt: 1 });
    await put('siteRequests/q1', { company: 'Some DSP', email: 'boss@dsp.de', phone: '+49 1', plan: 'basic', createdAt: 1 });
    await put('siteLimits/day-2026-10-26', { n: 3, day: '2026-10-26', at: 1 });
    await put(`orgs/${O}/vehicleDetails/v1`, { stationId: S1, createdAt: 1, ownership: 'leased', due: { hu: '2027-03-31' } });
    await put(`orgs/${O}/vehicleCosts/v1`, { createdAt: 1, monthly: 700, excessPerKm: 0.08 });
    await put(`orgs/${O}/members/mgr2`, { role: 'manager', stationIds: [S2], name: 'Manager 2', email: 'm2@x' });
    await put(`orgs/${O}/driverRecords/drv1`, { stationId: S1, createdAt: 1, licenceClasses: ['B'], licenceValid: '2031-05-31', checks: [{ day: '2026-09-01', at: 1, by: 'mgr1', byName: 'Manager 1', ok: true, note: '' }] });
    await put(`orgs/${O}/driverRecords/drv2`, { stationId: S2, createdAt: 2, emergencyName: 'Ana', emergencyPhone: '+40 1' });
    await put(`orgs/${O}/incidents/i1`, { driverId: 'drv1', driverName: 'Driver 1', vehicleId: 'v1', vehicleName: 'Van 1', stationId: S1, day: '2026-10-01', time: '10:20', kind: 'fine', fineType: 'speeding', atFault: null, note: '', by: 'mgr1', byName: 'Manager 1', createdAt: 1 });
    await put(`orgs/${O}/incidents/i2`, { driverId: 'drv2', driverName: 'Driver 2', vehicleId: 'v2', vehicleName: 'Van 2', stationId: S2, day: '2026-10-02', time: null, kind: 'accident', fineType: null, atFault: 'no', note: '', by: 'own', byName: 'Owner', createdAt: 2 });
    await put(`orgs/${O}/tours/t1`, { driverId: 'drv1', vehicleId: 'v1', stationId: S1, km: 120, createdAt: 1, startAt: 1 });
    await put(`orgs/${O}/tours/t2`, { driverId: 'drv2', vehicleId: 'v2', stationId: S2, km: 90, createdAt: 2, startAt: 2 });
    await put(`orgs/${O}/readings/r1`, { driverId: 'drv1', by: 'drv1', vehicleId: 'v1', stationId: S1, odometerKm: 48000, createdAt: 1, at: 1 });
    await put(`orgs/${O}/routines/r1`, { key: 'Oil level', name: 'Oil level', how: 'weekly', days: null, vans: 'all', stationId: S1, photo: false, createdAt: 1 });
    await put(`orgs/${O}/routineDone/rd1`, { routineId: 'r1', vehicleId: 'v1', stationId: S1, by: 'drv1', byName: 'Driver 1', ok: true, at: 1, createdAt: 1 });
    await put(`orgs/${O}/purchases/b1`, { kind: 'fuel', status: 'waiting', vehicleId: 'v1', stationId: S1, by: 'drv1', byName: 'Driver 1', createdAt: 1, card: { needed: true, expected: '4471', result: 'mismatch' } });
    await put(`orgs/${O}/purchases/b2`, { kind: 'wash', status: 'done', vehicleId: 'v2', stationId: S2, by: 'drv2', byName: 'Driver 2', createdAt: 2, total: 12.9 });
    await put(`orgs/${O}/buyReads/br1`, { purchaseId: 'b1', step: 'card', by: 'drv1', createdAt: 1 });
    await put(`orgs/${O}/dashReads/d1`, { by: 'drv1', vehicleId: 'v1', createdAt: 1 });
    await put(`orgs/${O}/docReads/k1`, { by: 'mgr1', target: 'van', kind: 'registration certificate', found: 9, createdAt: 1 });
    await put(`orgs/${O}/damageLog/c1`, { checkId: 'c1', vehicleId: 'v1', stationId: S1, n: 1, drivers: [{ id: 'drv1', name: 'Driver 1' }], driverIds: ['drv1'], foundAt: 1, createdAt: 1 });
    await put(`orgs/${O}/vehicleDetails/v2`, { stationId: S2, createdAt: 2, ownership: 'owned' });
    await put(`orgs/${O}/checkUsage/c1`, { checkId: 'c1', stationId: S1, createdAt: 1, pass1: { ms: 9000, cost: 0.2 }, pass2: null });
    await put('users/drv1/push/p1', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' }, createdAt: 1, device: 'Android phone' });
    const inv = (role, stationId) => ({ orgId: O, orgName: 'DSP One', role, stationId, stationName: 'x', createdBy: 'own', createdAt: 1, expiresAt: Date.now() + 86400000, usedBy: null });
    await put(`invites/DRVLINK1xxxxxxxxxxxxxxxx`, { token: 'DRVLINK1xxxxxxxxxxxxxxxx', ...inv('driver', S1) });
    await put(`invites/DRVLINK2xxxxxxxxxxxxxxxx`, { token: 'DRVLINK2xxxxxxxxxxxxxxxx', ...inv('driver', S2) });
    await put(`invites/MGRLINK1xxxxxxxxxxxxxxxx`, { token: 'MGRLINK1xxxxxxxxxxxxxxxx', ...inv('manager', S2) });
  });
});

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const vehiclesAt = (db, ids) => query(collection(db, `orgs/${O}/vehicles`), where('stationId', 'in', ids));
const review = { review: { decisions: { 0: { damage: true, note: '', by: 'x', byName: 'x', at: 1 } }, manual: [], by: 'x', byName: 'x', at: 1 }, status: 'reviewed', reviewedAt: 1 };

describe('reading vans', () => {
  test('owner reads every van', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/vehicles`))));
  test('old "admin" role counts as owner', () => assertSucceeds(getDocs(collection(as('legacy'), `orgs/${O}/vehicles`))));
  test('manager reads vans of their station', () => assertSucceeds(getDocs(vehiclesAt(as('mgr1'), [S1]))));
  test('manager cannot list every van', () => assertFails(getDocs(collection(as('mgr1'), `orgs/${O}/vehicles`))));
  test('manager cannot read a van of another station', () => assertFails(getDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v2`))));
  test('driver reads vans of their station', () => assertSucceeds(getDocs(vehiclesAt(as('drv1'), [S1]))));
  test('driver cannot query another station', () => assertFails(getDocs(vehiclesAt(as('drv1'), [S2]))));
  test('owner of another company sees nothing here', () => assertFails(getDoc(doc(as('own2'), `orgs/${O}/vehicles/v1`))));
  test('app creator reads every company', () => assertSucceeds(getDocs(collection(as('boss', { creator: true }), `orgs/${O}/vehicles`))));
  test('app creator lists companies', () => assertSucceeds(getDocs(collection(as('boss', { creator: true }), 'orgs'))));
  test('nobody deletes a company from the app', () => assertFails(deleteDoc(doc(as('boss', { creator: true }), `orgs/${O}`))));
  test('others cannot list companies', () => assertFails(getDocs(collection(as('own'), 'orgs'))));
  test('stranger cannot read a company', () => assertFails(getDoc(doc(as('nobody'), `orgs/${O}`))));
});

describe('changing vans', () => {
  test('manager adds a van to their station', () => assertSucceeds(setDoc(doc(as('mgr1'), `orgs/${O}/vehicles/n1`), { name: 'New', stationId: S1, createdAt: 3 })));
  test('manager cannot add a van to another station', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/vehicles/n2`), { name: 'New', stationId: S2, createdAt: 3 })));
  test('manager cannot move a van to another station', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { stationId: S2 })));
  test('vans move between stations only through the server', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { stationId: S2 })));
  test('manager edits a van of their station', () => assertSucceeds(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { name: 'Van 1b', plate: 'B X 1' })));
  test('nobody sets the driver of a van from the app', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { assignedTo: { driverId: 'drv1' } })));
  test('nobody retires a van from the app', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { retired: true })));
  test('nobody writes the van\'s km or warning lights from the app', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { dash: { km: 1, warnings: [] } })));
  test('not even the owner', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { dash: { km: 1, warnings: [] } })));
  test('a new van cannot come with km from a dashboard', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/vehicles/n8`), { name: 'New', stationId: S1, createdAt: 3, dash: { km: 1 } })));
  test('a new van cannot come with a driver', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/vehicles/n9`), { name: 'New', stationId: S1, createdAt: 3, assignedTo: { driverId: 'drv1' } })));
  test('driver cannot add a van', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/vehicles/n3`), { name: 'New', stationId: S1, createdAt: 3 })));
  test('driver cannot remove a van', () => assertFails(deleteDoc(doc(as('drv1'), `orgs/${O}/vehicles/v1`))));
  test('manager cannot delete a van (history stays)', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`))));
  test('owner cannot delete a van (history stays)', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/vehicles/v1`))));
  test('app creator cannot delete a van either', () => assertFails(deleteDoc(doc(as('boss', { creator: true }), `orgs/${O}/vehicles/v1`))));
});

describe('van history', () => {
  const hist = (db, f, v) => getDocs(query(collection(db, `orgs/${O}/assignments`), where(f, '==', v)));
  test('owner reads all history', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/assignments`))));
  test('manager reads the history of their station', () => assertSucceeds(getDocs(query(collection(as('mgr1'), `orgs/${O}/assignments`), where('stationId', 'in', [S1])))));
  test('manager cannot read another station\'s history', () => assertFails(getDoc(doc(as('mgr1'), `orgs/${O}/assignments/a2`))));
  test('driver reads their own history', () => assertSucceeds(hist(as('drv1'), 'driverId', 'drv1')));
  test('driver cannot read other drivers\' history', () => assertFails(hist(as('drv1'), 'driverId', 'drv2')));
  test('driver cannot read the whole station history', () => assertFails(getDocs(query(collection(as('drv1'), `orgs/${O}/assignments`), where('stationId', 'in', [S1])))));
  test('nobody writes history from the app', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/assignments/a9`), { vehicleId: 'v1', driverId: 'drv1', stationId: S1, start: 2, end: null })));
  test('nobody edits history', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/assignments/a1`), { end: 9 })));
  test('nobody deletes a walk-around', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/walkarounds/w1`))));
  test('nobody deletes a damage check', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/checks/c1`))));
  test('nobody deletes history, owner included', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/assignments/a2`))));
  test('the app creator cannot delete history either', () => assertFails(deleteDoc(doc(as('boss', { creator: true }), `orgs/${O}/assignments/a2`))));
});

describe('walk-arounds and checks', () => {
  test('driver saves a walk-around at their station', () => assertSucceeds(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w2`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 2 })));
  test('driver cannot save one for another station', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w3`), { vehicleId: 'v2', stationId: S2, createdBy: 'drv1', createdAt: 2 })));
  test('nobody writes a video record from the app, not even the owner', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/videos/x1`), { vehicleId: 'v1', stationId: S1, by: 'own', kind: 'pickup' })));
  test('a driver cannot write their own video record (the server checks the video first)', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/videos/x2`), { vehicleId: 'v1', stationId: S1, by: 'drv1', kind: 'pickup' })));
  test('manager watches videos of their station', () => assertSucceeds(getDoc(doc(as('mgr1'), `orgs/${O}/videos/vd1`))));
  test('a driver sees their own videos', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/videos/vd1`))));
  test('a driver does not see other people\'s videos', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/videos/vd2`))));
  test('a driver of another station does not see them', () => assertFails(getDoc(doc(as('drv2'), `orgs/${O}/videos/vd1`))));
  test('nobody changes a video record', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/videos/vd1`), { kind: 'dropoff' })));
  test('nobody deletes a video record', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/videos/vd1`))));
  const note = (by, extra = {}) => ({ vehicleId: 'v1', stationId: S1, damageKey: 'c1:0', text: 'Driver says it was there before', by, byName: by, createdAt: Date.now(), ...extra });
  test('manager comments on a damage at their station', () => assertSucceeds(setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n1`), note('mgr1'))));
  test('owner comments on any damage', () => assertSucceeds(setDoc(doc(as('own'), `orgs/${O}/damageNotes/n2`), note('own'))));
  test('drivers cannot comment on damage', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/damageNotes/n3`), note('drv1'))));
  test('nobody comments in someone else\'s name', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n4`), note('own'))));
  test('a comment must match the van\'s station', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/damageNotes/n5`), note('own', { stationId: S2 }))));
  test('a manager cannot comment on damage at another station', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n6`), note('mgr1', { vehicleId: 'v2', stationId: S2 }))));
  test('comments carry the real time', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n7`), note('mgr1', { createdAt: 1 }))));
  test('comments are kept: no edits', async () => {
    await setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n8`), note('mgr1'));
    await assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n8`), { text: 'changed' }));
  });
  test('comments are kept: no deletes, not even by the owner', async () => {
    await setDoc(doc(as('own'), `orgs/${O}/damageNotes/n9`), note('own'));
    await assertFails(deleteDoc(doc(as('own'), `orgs/${O}/damageNotes/n9`)));
  });
  test('drivers do not read damage comments', async () => {
    await setDoc(doc(as('mgr1'), `orgs/${O}/damageNotes/n10`), note('mgr1'));
    await assertFails(getDoc(doc(as('drv1'), `orgs/${O}/damageNotes/n10`)));
  });
  test('nobody marks their own photos as a pick-up or drop-off (only the server does)', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w5`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 2, handover: { kind: 'pickup', assignmentId: 'a1' } })));
  test('nobody edits a walk-around', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w1`), { taken: 14 })));
  test('nobody keeps their own photos longer (only the server marks damage)', async () => {
    await assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w6`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 2, keepUntil: 9e12 }));
    await assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/walkarounds/w7`), { vehicleId: 'v1', stationId: S1, createdBy: 'mgr1', createdAt: 2, keepMark: { by: 'mgr1' } }));
    await assertFails(updateDoc(doc(as('own'), `orgs/${O}/walkarounds/w1`), { keepUntil: 9e12 }));
    await assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w8`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 2, mediaDeletedAt: 3 }));
    await assertFails(updateDoc(doc(as('own'), `orgs/${O}/walkarounds/w1`), { mediaDeletedAt: 3 }));
  });
  test('nobody writes how long a check\'s photos are kept, not even its manager', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/checks/c1`), { keepUntil: 9e12 })));
  test('nobody marks a check\'s photos as deleted, not even its manager', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/checks/c1`), { mediaDeletedAt: 3 })));
  test('driver cannot save one in someone else\'s name', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w4`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv9', createdAt: 2 })));
  test('driver cannot create a check (only the server does)', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/checks/c9`), { stationId: S1, createdAt: 2 })));
  test('driver cannot approve damage', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/checks/c1`), review)));
  test('manager approves damage at their station', () => assertSucceeds(updateDoc(doc(as('mgr1'), `orgs/${O}/checks/c1`), review)));
  test('manager cannot change the AI result', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/checks/c1`), { spots: [{ x: 1 }] })));
  test('manager cannot review another station', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/checks/c2`), review)));
  test('owner reviews any station', () => assertSucceeds(updateDoc(doc(as('own'), `orgs/${O}/checks/c2`), review)));
  test('driver cannot read type scans', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/scans/sc1`))));
  test('manager marks a type scan right or wrong', () => assertSucceeds(updateDoc(doc(as('mgr1'), `orgs/${O}/scans/sc1`), { verdict: 'correct', actual: 'suv' })));
});

describe('people and invites', () => {
  test('nobody adds themselves to a company from the app (only invite links on the server)', () => assertFails(setDoc(doc(as('new1'), `orgs/${O}/members/new1`), { role: 'driver', stationIds: [S1], name: 'N', email: 'n@x' })));
  test('invite links cannot be made from the app', () => assertFails(setDoc(doc(as('own'), 'invites/NEWLINKxxxxxxxxxxxxxxxxx'), { orgId: O, role: 'driver', stationId: S1, createdBy: 'own', createdAt: 2, expiresAt: Date.now() + 1e9, usedBy: null })));
  test('invite links cannot be marked used from the app', () => assertFails(updateDoc(doc(as('new1'), 'invites/DRVLINK1xxxxxxxxxxxxxxxx'), { usedBy: 'new1' })));
  test('anyone signed in can look up a link they were sent', () => assertSucceeds(getDoc(doc(as('new1'), 'invites/DRVLINK1xxxxxxxxxxxxxxxx'))));
  test('owner sees the links of the company', () => assertSucceeds(getDocs(query(collection(as('own'), 'invites'), where('orgId', '==', O)))));
  test('manager sees the links of the company', () => assertSucceeds(getDocs(query(collection(as('mgr1'), 'invites'), where('orgId', '==', O)))));
  test('driver cannot list links', () => assertFails(getDocs(query(collection(as('drv1'), 'invites'), where('orgId', '==', O)))));
  test('owner of another company cannot list links', () => assertFails(getDocs(query(collection(as('own2'), 'invites'), where('orgId', '==', O)))));
  test('manager cancels a driver link of their station', () => assertSucceeds(deleteDoc(doc(as('mgr1'), 'invites/DRVLINK1xxxxxxxxxxxxxxxx'))));
  test('manager cannot cancel a link of another station', () => assertFails(deleteDoc(doc(as('mgr1'), 'invites/DRVLINK2xxxxxxxxxxxxxxxx'))));
  test('manager cannot cancel a manager link', () => assertFails(deleteDoc(doc(as('mgr1'), 'invites/MGRLINK1xxxxxxxxxxxxxxxx'))));
  test('owner cancels any link', () => assertSucceeds(deleteDoc(doc(as('own'), 'invites/MGRLINK1xxxxxxxxxxxxxxxx'))));
  test('people update their own phone number', () => assertSucceeds(updateDoc(doc(as('drv1'), `orgs/${O}/members/drv1`), { phone: '+49 170 1', transporterId: 'A1' })));
  test('people cannot change their own station', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/members/drv1`), { stationIds: [S2] })));
  test('people cannot change someone else\'s details', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/members/drv2`), { phone: '1' })));
  test('driver cannot list people', () => assertFails(getDocs(collection(as('drv1'), `orgs/${O}/members`))));
  test('driver reads their own membership', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/members/drv1`))));
  test('manager lists people', () => assertSucceeds(getDocs(collection(as('mgr1'), `orgs/${O}/members`))));
  test('removing people goes through the server, even for the owner', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/members/drv1`))));
  test('manager cannot remove a driver from the app (removePerson ends their van)', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/drv1`))));
  test('manager cannot remove a driver of another station', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/drv2`))));
  test('manager cannot remove the owner', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/own`))));
  test('station changes go through the server, even for the owner (changePerson)', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/members/mgr1`), { stationIds: [S2] })));
  test('role changes go through the server, even for the owner', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/members/drv1`), { role: 'manager' })));
  test('manager cannot move drivers', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/members/drv1`), { stationIds: [S2] })));
  test('nobody changes their own role', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/members/mgr1`), { role: 'owner' })));
  test('a driver cannot delete their own membership from the app (their van and history stay right)', () => assertFails(deleteDoc(doc(as('drv1'), `orgs/${O}/members/drv1`))));
  test('the owner cannot leave their own company', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/members/own`))));
  test('owner adds a station', () => assertSucceeds(setDoc(doc(as('own'), `orgs/${O}/stations/st3`), { name: 'DXX3', code: 'DXX3', createdAt: 3 })));
  test('manager cannot add a station', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/stations/st4`), { name: 'DXX4', code: 'DXX4', createdAt: 3 })));
  test('owner renames a station', () => assertSucceeds(updateDoc(doc(as('own'), `orgs/${O}/stations/${S1}`), { name: 'DXX1 Berlin' })));
  test('driver self pick-up is switched on only through the server, even by the owner', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/stations/${S1}`), { selfAssign: true })));
  test('a new station cannot start with driver self pick-up on', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/stations/st5`), { name: 'DXX5', code: '', createdAt: 3, selfAssign: true })));
  test('manager cannot switch driver self pick-up from the app', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/stations/${S1}`), { selfAssign: true })));
  test('driver cannot switch driver self pick-up', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/stations/${S1}`), { selfAssign: true })));
  test('driver reads station names', () => assertSucceeds(getDocs(collection(as('drv1'), `orgs/${O}/stations`))));
});

describe('new companies', () => {
  test('anyone signed in creates a company and becomes its owner', async () => {
    const db = as('fresh');
    await assertSucceeds(setDoc(doc(db, 'orgs/neworg'), { name: 'DSP New', createdBy: 'fresh', createdAt: 5, stationsReady: true }));
    await assertSucceeds(setDoc(doc(db, 'orgs/neworg/members/fresh'), { role: 'owner', stationIds: [], name: 'F', email: 'f@x', joinedAt: 5 }));
    await assertSucceeds(setDoc(doc(db, 'orgs/neworg/stations/s1'), { name: 'DXX9', code: 'DXX9', createdAt: 5 }));
  });
  test('cannot become owner of someone else\'s company', () => assertFails(setDoc(doc(as('fresh'), `orgs/${O}/members/fresh`), { role: 'owner', stationIds: [], name: 'F', email: 'f@x' })));
});

describe('the app creator viewing the app as someone else', () => {
  const C = { creator: true };
  const asDrv = () => as('vdrv', C), asMgr = () => as('vmgr', C), asOwn = () => as('vown', C);
  // As a driver of station 1.
  test('as a driver: reads the vans of their station', () => assertSucceeds(getDocs(vehiclesAt(asDrv(), [S1]))));
  test('as a driver: not another station', () => assertFails(getDocs(vehiclesAt(asDrv(), [S2]))));
  test('as a driver: not every van', () => assertFails(getDocs(collection(asDrv(), `orgs/${O}/vehicles`))));
  test('as a driver: not another company', () => assertFails(getDoc(doc(asDrv(), `orgs/${O2}/vehicles/x1`))));
  test('as a driver: cannot list companies', () => assertFails(getDocs(collection(asDrv(), 'orgs'))));
  test('as a driver: reads the company it views', () => assertSucceeds(getDoc(doc(asDrv(), `orgs/${O}`))));
  test('as a driver: cannot change a van', () => assertFails(updateDoc(doc(asDrv(), `orgs/${O}/vehicles/v1`), { name: 'X' })));
  test('as a driver: not other drivers\' history', () => assertFails(getDoc(doc(asDrv(), `orgs/${O}/assignments/a1`))));
  test('as a driver: their own history', () => assertSucceeds(getDocs(query(collection(asDrv(), `orgs/${O}/assignments`), where('driverId', '==', 'vdrv')))));
  test('as a driver: not other people\'s videos', () => assertFails(getDoc(doc(asDrv(), `orgs/${O}/videos/vd1`))));
  test('as a driver: not the people list', () => assertFails(getDocs(collection(asDrv(), `orgs/${O}/members`))));
  test('as a driver: not the reviews', () => assertFails(updateDoc(doc(asDrv(), `orgs/${O}/checks/c1`), review)));
  test('as a driver: saves a walk-around at their station', () => assertSucceeds(setDoc(doc(asDrv(), `orgs/${O}/walkarounds/vw1`), { vehicleId: 'v1', stationId: S1, createdBy: 'vdrv', createdAt: 5 })));
  test('as a driver: not at another station', () => assertFails(setDoc(doc(asDrv(), `orgs/${O}/walkarounds/vw2`), { vehicleId: 'v2', stationId: S2, createdBy: 'vdrv', createdAt: 5 })));
  test('as a driver: not in someone else\'s name (creators can, drivers can\'t)', () => assertFails(setDoc(doc(asDrv(), `orgs/${O}/walkarounds/vw3`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 5 })));
  test('as a driver: not the creator\'s list of creators', () => assertFails(getDoc(doc(asDrv(), 'platform/creators'))));
  // As a fleet manager of station 1.
  test('as a manager: the station\'s history', () => assertSucceeds(getDoc(doc(asMgr(), `orgs/${O}/assignments/a1`))));
  test('as a manager: not another station\'s history', () => assertFails(getDoc(doc(asMgr(), `orgs/${O}/assignments/a2`))));
  test('as a manager: reviews damage at the station', () => assertSucceeds(updateDoc(doc(asMgr(), `orgs/${O}/checks/c1`), review)));
  test('as a manager: not at another station', () => assertFails(updateDoc(doc(asMgr(), `orgs/${O}/checks/c2`), review)));
  test('as a manager: lists people', () => assertSucceeds(getDocs(collection(asMgr(), `orgs/${O}/members`))));
  test('as a manager: cannot add a station', () => assertFails(setDoc(doc(asMgr(), `orgs/${O}/stations/st9`), { name: 'DXX9', code: '', createdAt: 9 })));
  test('as a manager: watches the station\'s videos', () => assertSucceeds(getDoc(doc(asMgr(), `orgs/${O}/videos/vd1`))));
  // As an owner of company O.
  test('as an owner: every station\'s history', () => assertSucceeds(getDoc(doc(asOwn(), `orgs/${O}/assignments/a2`))));
  test('as an owner: adds a station', () => assertSucceeds(setDoc(doc(asOwn(), `orgs/${O}/stations/st9`), { name: 'DXX9', code: '', createdAt: 9 })));
  test('as an owner: not another company', () => assertFails(getDoc(doc(asOwn(), `orgs/${O2}/vehicles/x1`))));
  test('as an owner: cannot list companies', () => assertFails(getDocs(collection(asOwn(), 'orgs'))));
  // Switching.
  test('switches back to themselves', () => assertSucceeds(updateDoc(doc(asDrv(), 'users/vdrv'), { viewAs: null })));
  test('switches to another role', () => assertSucceeds(updateDoc(doc(asDrv(), 'users/vdrv'), { viewAs: { org: O, role: 'manager', st: S2 } })));
  test('a manager or driver view needs a station', () => assertFails(updateDoc(doc(asDrv(), 'users/vdrv'), { viewAs: { org: O, role: 'driver', st: null } })));
  test('no made-up roles', () => assertFails(updateDoc(doc(asDrv(), 'users/vdrv'), { viewAs: { org: O, role: 'creator', st: null } })));
  test('a creator being themselves still reads every company', () => assertSucceeds(getDocs(collection(as('boss2', C), `orgs/${O2}/vehicles`))));
  // Anyone else: the switch doesn't exist.
  test('nobody else can set it', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1'), { viewAs: { org: O, role: 'owner', st: null } })));
  test('nobody else gets anything from it', () => assertFails(getDoc(doc(as('drv2'), `orgs/${O}/vehicles/v1`))));
  test('someone else\'s profile with it stays theirs', () => assertSucceeds(getDocs(vehiclesAt(as('drv2'), [S2]))));
});

describe('checks for drivers', () => {
  test('drivers see which checks there are', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/routines/r1`))));
  test('nobody outside the company does', () => assertFails(getDoc(doc(as('drv9'), `orgs/${O}/routines/r1`))));
  test('managers set them only through the server', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/routines/r2`), { name: 'Oil', how: 'daily', vans: 'all', stationId: S1 })));
  test('not even the owner writes them directly', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/routines/r1`), { name: 'Changed' })));
  test('a driver reads the checks they did', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/routineDone/rd1`))));
  test('another driver doesn\'t', () => assertFails(getDoc(doc(as('drv2'), `orgs/${O}/routineDone/rd1`))));
  test('the station\'s manager does', () => assertSucceeds(getDoc(doc(as('mgr1'), `orgs/${O}/routineDone/rd1`))));
  test('nobody writes a check as done from the app', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/routineDone/rd2`), { by: 'drv1', stationId: S1, ok: true, at: 1 })));
  test('nobody clears what\'s due on a van from the app', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { todo: [] })));
  test('or marks a check done on the van', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { routines: { r1: { at: 1, ok: true } } })));
});

describe('language', () => {
  test('a person picks their language', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1'), { lang: 'pl', appLang: 'pl' }, { merge: true })));
  test('or follows the phone again', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1'), { lang: null, appLang: 'de' }, { merge: true })));
  test('only a language code', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1'), { lang: '../../etc' }, { merge: true })));
  test('nobody sets it for someone else', () => assertFails(setDoc(doc(as('mgr1'), 'users/drv1'), { lang: 'ro' }, { merge: true })));
});

describe('phone notifications', () => {
  const sub = (endpoint) => ({ endpoint, keys: { p256dh: 'BKEY', auth: 'AUTH' }, createdAt: 5, device: 'iPhone' });
  test('a driver turns them on for their phone', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1/push/p2'), sub('https://web.push.apple.com/QGx'))));
  test('Android (Chrome) push service too', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1/push/p3'), sub('https://fcm.googleapis.com/fcm/send/xyz'))));
  test('only real push services, never another address', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1/push/p4'), sub('https://evil.example.com/collect'))));
  test('no plain http', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1/push/p5'), sub('http://fcm.googleapis.com/fcm/send/xyz'))));
  test('nothing extra in the record', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1/push/p6'), { ...sub('https://fcm.googleapis.com/fcm/send/1'), role: 'owner' })));
  const app = (expo, extra = {}) => ({ expo, platform: 'ios', createdAt: 1, device: 'iPhone, Fratius app', ...extra });
  test('the store app saves its Expo push token', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1/push/a1'), app('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'))));
  test('Android too', () => assertSucceeds(setDoc(doc(as('drv1'), 'users/drv1/push/a2'), app('ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]', { platform: 'android' }))));
  test('only an Expo push token, never an address', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1/push/a3'), app('https://evil.example.com/collect'))));
  test('no address next to a token', () => assertFails(setDoc(doc(as('drv1'), 'users/drv1/push/a4'), app('ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]', { endpoint: 'https://evil.example.com/x' }))));
  test('nobody adds a store-app phone for someone else', () => assertFails(setDoc(doc(as('mgr1'), 'users/drv1/push/a5'), app('ExponentPushToken[wwwwwwwwwwwwwwwwwwwwww]'))));
  test('they see and remove their own', () => assertSucceeds(deleteDoc(doc(as('drv1'), 'users/drv1/push/p1'))));
  test('nobody else sees them, not even the owner', () => assertFails(getDoc(doc(as('own'), 'users/drv1/push/p1'))));
  test('nobody adds a phone for someone else', () => assertFails(setDoc(doc(as('mgr1'), 'users/drv1/push/p7'), sub('https://fcm.googleapis.com/fcm/send/m'))));
  test('everyone signed in reads the public key', () => assertSucceeds(getDoc(doc(as('drv2'), 'config/push'))));
  test('nobody changes it from the app', () => assertFails(setDoc(doc(as('boss', { creator: true }), 'config/push'), { vapidPublicKey: 'X' })));
  test('signed out: no key', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/push'))));
});

describe('AI speed and cost: only the app creator', () => {
  test('the app creator reads the speed and cost of a check', () => assertSucceeds(getDoc(doc(as('boss', { creator: true }), `orgs/${O}/checkUsage/c1`))));
  test('the app creator lists them for the test log', () => assertSucceeds(getDocs(collection(as('boss', { creator: true }), `orgs/${O}/checkUsage`))));
  test('not the fleet owner', () => assertFails(getDoc(doc(as('own'), `orgs/${O}/checkUsage/c1`))));
  test('not the station\'s manager', () => assertFails(getDoc(doc(as('mgr1'), `orgs/${O}/checkUsage/c1`))));
  test('not the driver', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/checkUsage/c1`))));
  test('not the app creator viewing the app as an owner', () => assertFails(getDoc(doc(as('vown', { creator: true }), `orgs/${O}/checkUsage/c1`))));
  test('nobody writes them from the app, not even the app creator', () => assertFails(setDoc(doc(as('boss', { creator: true }), `orgs/${O}/checkUsage/c9`), { pass1: null })));
  test('type scans (they carry cost): the app creator reads them', () => assertSucceeds(getDocs(collection(as('boss', { creator: true }), `orgs/${O}/scans`))));
  test('type scans: not the fleet owner', () => assertFails(getDoc(doc(as('own'), `orgs/${O}/scans/sc1`))));
  test('type scans: not the manager', () => assertFails(getDocs(collection(as('mgr1'), `orgs/${O}/scans`))));
  test('the check itself stays readable at the station', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/checks/c1`))));
});

describe('van records: facts for the station, contract and deadlines for owners and managers', () => {
  const det = (db, id) => doc(db, `orgs/${O}/vehicleDetails/${id}`);
  const atS1 = (db) => query(collection(db, `orgs/${O}/vehicleDetails`), where('stationId', 'in', [S1]));
  test('the owner reads every van\'s contract and deadlines', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/vehicleDetails`))));
  test('a manager reads their station\'s', () => assertSucceeds(getDocs(atS1(as('mgr1')))));
  test('not another station\'s', () => assertFails(getDoc(det(as('mgr1'), 'v2'))));
  test('a driver never reads them', () => assertFails(getDoc(det(as('drv1'), 'v1'))));
  test('a driver can\'t query them either', () => assertFails(getDocs(atS1(as('drv1')))));
  test('a manager fills them in for a van of their station', () => assertSucceeds(setDoc(det(as('mgr1'), 'v1'), { stationId: S1, createdAt: 1, kmPerYear: 40000, notes: 'New lease' })));
  test('…but never what it costs (that is owners only)', () => assertFails(setDoc(det(as('mgr1'), 'v1'), { stationId: S1, createdAt: 1, monthly: 720 })));
  test('the owner can\'t put costs in there either', () => assertFails(updateDoc(det(as('own'), 'v1'), { premium: 1200 })));
  test('…only with the van\'s station', () => assertFails(setDoc(det(as('mgr1'), 'v1'), { stationId: S2, createdAt: 1 })));
  test('not for another station\'s van', () => assertFails(setDoc(det(as('mgr1'), 'v2'), { stationId: S2, createdAt: 2 })));
  test('a driver can\'t write them', () => assertFails(setDoc(det(as('drv1'), 'v1'), { stationId: S1, createdAt: 1 })));
  test('the owner fills them in', () => assertSucceeds(setDoc(det(as('own'), 'v2'), { stationId: S2, createdAt: 2, ownership: 'financed' })));
  test('nobody deletes them', () => assertFails(deleteDoc(det(as('own'), 'v1'))));
  test('the app creator viewing as a driver can\'t read them', () => assertFails(getDoc(det(as('vdrv', { creator: true }), 'v1'))));
  test('…viewing as a manager can', () => assertSucceeds(getDoc(det(as('vmgr', { creator: true }), 'v1'))));
  test('a manager writes the van\'s facts (VIN, size, breakdown number)', () => assertSucceeds(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { vin: 'W1V9070001P431208', heightM: 2.72, breakdownPhone: '+49 800 1' })));
  test('a driver reads them', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/vehicles/v1`))));
  test('a driver can\'t change them', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/vehicles/v1`), { vin: 'X' })));
});

describe('what a van costs: owners only', () => {
  const cost = (db, id) => doc(db, `orgs/${O}/vehicleCosts/${id}`);
  test('the owner reads the costs', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/vehicleCosts`))));
  test('a manager can\'t, not even for their own station\'s van', () => assertFails(getDoc(cost(as('mgr1'), 'v1'))));
  test('a manager can\'t list them', () => assertFails(getDocs(collection(as('mgr1'), `orgs/${O}/vehicleCosts`))));
  test('a driver can\'t', () => assertFails(getDoc(cost(as('drv1'), 'v1'))));
  test('the owner enters them', () => assertSucceeds(setDoc(cost(as('own'), 'v2'), { createdAt: 2, purchasePrice: 61000, premium: 1400 })));
  test('…only the money fields', () => assertFails(setDoc(cost(as('own'), 'v2'), { createdAt: 2, purchasePrice: 61000, stationId: S2 })));
  test('…only for a van that exists', () => assertFails(setDoc(cost(as('own'), 'nope'), { createdAt: 2, monthly: 1 })));
  test('a manager can\'t write them', () => assertFails(setDoc(cost(as('mgr1'), 'v1'), { createdAt: 1, monthly: 1 })));
  test('the app creator viewing as a manager can\'t read them', () => assertFails(getDoc(cost(as('vmgr', { creator: true }), 'v1'))));
  test('…viewing as an owner can', () => assertSucceeds(getDoc(cost(as('vown', { creator: true }), 'v1'))));
  test('the app creator as themselves can', () => assertSucceeds(getDoc(cost(as('boss', { creator: true }), 'v1'))));
  test('nobody deletes them', () => assertFails(deleteDoc(cost(as('own'), 'v1'))));
});

describe('driver records: owners and the station\'s managers keep them, drivers read their own', () => {
  const rec = (db, id) => doc(db, `orgs/${O}/driverRecords/${id}`);
  const atS1 = (db) => query(collection(db, `orgs/${O}/driverRecords`), where('stationId', 'in', [S1]));
  test('the owner reads every record', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/driverRecords`))));
  test('a manager reads their station\'s', () => assertSucceeds(getDocs(atS1(as('mgr1')))));
  test('not another station\'s', () => assertFails(getDoc(rec(as('mgr1'), 'drv2'))));
  test('a driver reads their own', () => assertSucceeds(getDoc(rec(as('drv1'), 'drv1'))));
  test('not someone else\'s', () => assertFails(getDoc(rec(as('drv1'), 'drv2'))));
  test('a driver can\'t query the station\'s', () => assertFails(getDocs(atS1(as('drv1')))));
  test('a driver can\'t change their own', () => assertFails(updateDoc(rec(as('drv1'), 'drv1'), { licenceValid: '2040-01-01' })));
  test('a manager starts a record for a driver of their station', () => assertSucceeds(setDoc(rec(as('mgr1'), 'mgr1'), { stationId: S1, createdAt: 3, licenceClasses: ['B'] })));
  test('…with the driver\'s own station', () => assertFails(setDoc(rec(as('own'), 'drv2'), { stationId: S1, createdAt: 3 })));
  test('a manager can\'t start one for another station\'s driver', () => assertFails(setDoc(rec(as('mgr1'), 'drv2'), { stationId: S2, createdAt: 3 })));
  test('a manager updates the licence and briefings', () => assertSucceeds(updateDoc(rec(as('mgr1'), 'drv1'), { licenceValid: '2032-01-31', safetyBriefing: '2026-10-01' })));
  test('licence checks are added only by the server', () => assertFails(updateDoc(rec(as('mgr1'), 'drv1'), { checks: [] })));
  test('…not on a new record either', () => assertFails(setDoc(rec(as('own'), 'mgr2'), { stationId: S2, createdAt: 3, checks: [{ day: '2026-10-01', ok: true }] })));
  test('the station moves only with the driver (on the server)', () => assertFails(updateDoc(rec(as('own'), 'drv1'), { stationId: S2 })));
  test('nobody deletes a record', () => assertFails(deleteDoc(rec(as('own'), 'drv1'))));
  test('the app creator viewing as a driver can\'t read another\'s', () => assertFails(getDoc(rec(as('vdrv', { creator: true }), 'drv1'))));
});

describe('incidents: accidents, fines, complaints', () => {
  const inc = (db, id) => doc(db, `orgs/${O}/incidents/${id}`);
  const mine = (db, uid) => query(collection(db, `orgs/${O}/incidents`), where('driverId', '==', uid));
  const fine = (by, stationId = S1) => ({ driverId: 'drv1', driverName: 'Driver 1', vehicleId: 'v1', vehicleName: 'Van 1', stationId, day: '2026-10-20', time: '08:15', kind: 'fine', fineType: 'parking', atFault: null, note: 'Ticket', by, byName: 'x', createdAt: Date.now() });
  test('the owner reads them all', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/incidents`))));
  test('a manager reads their station\'s', () => assertSucceeds(getDocs(query(collection(as('mgr1'), `orgs/${O}/incidents`), where('stationId', 'in', [S1])))));
  test('not another station\'s', () => assertFails(getDoc(inc(as('mgr1'), 'i2'))));
  test('a driver reads their own', () => assertSucceeds(getDocs(mine(as('drv1'), 'drv1'))));
  test('not someone else\'s', () => assertFails(getDocs(mine(as('drv1'), 'drv2'))));
  test('a manager adds one at their station', () => assertSucceeds(setDoc(inc(as('mgr1'), 'n1'), fine('mgr1'))));
  test('…signed with their own name', () => assertFails(setDoc(inc(as('mgr1'), 'n2'), fine('own'))));
  test('…not at another station', () => assertFails(setDoc(inc(as('mgr1'), 'n3'), fine('mgr1', S2))));
  test('a driver can\'t add one', () => assertFails(setDoc(inc(as('drv1'), 'n4'), fine('drv1'))));
  test('a manager corrects one', () => assertSucceeds(updateDoc(inc(as('mgr1'), 'i1'), { note: 'Paid by the driver', updatedAt: 5, updatedByName: 'Manager 1' })));
  test('…but not who added it or when', () => assertFails(updateDoc(inc(as('mgr1'), 'i1'), { by: 'mgr1', createdAt: 9 })));
  test('…or its station', () => assertFails(updateDoc(inc(as('own'), 'i1'), { stationId: S2 })));
  test('nobody deletes one', () => assertFails(deleteDoc(inc(as('own'), 'i1'))));
});

describe('tours, dashboard readings and the damage log: written by the server', () => {
  const tours = (db, f, v) => getDocs(query(collection(db, `orgs/${O}/tours`), where(f, f === 'stationId' ? 'in' : '==', v)));
  test('the owner reads every tour', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/tours`))));
  test('a manager reads their station\'s', () => assertSucceeds(tours(as('mgr1'), 'stationId', [S1])));
  test('not another station\'s', () => assertFails(tours(as('mgr1'), 'stationId', [S2])));
  test('a driver reads their own tours', () => assertSucceeds(tours(as('drv1'), 'driverId', 'drv1')));
  test('not other drivers\'', () => assertFails(tours(as('drv1'), 'driverId', 'drv2')));
  test('nobody writes a tour from the app', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/tours/t9`), { driverId: 'drv1', stationId: S1, km: 5, createdAt: 3 })));
  test('nobody edits a tour', () => assertFails(updateDoc(doc(as('own'), `orgs/${O}/tours/t1`), { km: 5 })));
  test('a driver reads their own dashboard readings', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/readings/r1`))));
  test('another driver can\'t', () => assertFails(getDoc(doc(as('drv2'), `orgs/${O}/readings/r1`))));
  test('nobody writes a reading from the app', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/readings/r9`), { vehicleId: 'v1', stationId: S1, odometerKm: 1 })));
  test('what the AI read first: the app creator only', () => assertSucceeds(getDoc(doc(as('boss', { creator: true }), `orgs/${O}/dashReads/d1`))));
  test('…not the driver who took it', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/dashReads/d1`))));
  test('…not the owner', () => assertFails(getDoc(doc(as('own'), `orgs/${O}/dashReads/d1`))));
  test('documents read from a photo: the app creator only', () => assertSucceeds(getDoc(doc(as('boss', { creator: true }), `orgs/${O}/docReads/k1`))));
  test('…not the manager who read it', () => assertFails(getDoc(doc(as('mgr1'), `orgs/${O}/docReads/k1`))));
  test('…and nobody writes them from the app', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/docReads/k9`), { by: 'own', createdAt: 1 })));
  test('the damage log: a manager reads their station\'s', () => assertSucceeds(getDocs(query(collection(as('mgr1'), `orgs/${O}/damageLog`), where('stationId', 'in', [S1])))));
  test('…a driver the ones they\'re in', () => assertSucceeds(getDocs(query(collection(as('drv1'), `orgs/${O}/damageLog`), where('driverIds', 'array-contains', 'drv1')))));
  test('…not others\'', () => assertFails(getDoc(doc(as('drv2'), `orgs/${O}/damageLog/c1`))));
  test('nobody writes the damage log from the app', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/damageLog/c9`), { stationId: S1, n: 0, driverIds: [] })));
});

describe('company settings: dashboard photos and licence checks', () => {
  test('the owner turns dashboard photos on', () => assertSucceeds(updateDoc(doc(as('own'), `orgs/${O}`), { dashScans: true, dashScansBy: 'Owner', dashScansAt: 1, licenceCheckMonths: 3 })));
  test('a manager can\'t', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}`), { dashScans: true })));
  test('a driver can\'t', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}`), { dashScans: false })));
});

describe('refuels, washes and parts: every attempt kept, written by the server', () => {
  const buys = (db, f, v) => getDocs(query(collection(db, `orgs/${O}/purchases`), where(f, f === 'stationId' ? 'in' : '==', v)));
  test('the owner reads every one', () => assertSucceeds(getDocs(collection(as('own'), `orgs/${O}/purchases`))));
  test('a manager reads their station\'s (to allow or refuse a wrong card)', () => assertSucceeds(buys(as('mgr1'), 'stationId', [S1])));
  test('not another station\'s', () => assertFails(buys(as('mgr1'), 'stationId', [S2])));
  test('a driver reads their own', () => assertSucceeds(buys(as('drv1'), 'by', 'drv1')));
  test('not other drivers\'', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/purchases/b2`))));
  test('not the whole station\'s', () => assertFails(buys(as('drv1'), 'stationId', [S1])));
  test('nobody writes one from the app, not even the owner', () => assertFails(setDoc(doc(as('own'), `orgs/${O}/purchases/b9`), { kind: 'fuel', status: 'done', vehicleId: 'v1', stationId: S1, by: 'own', createdAt: 3 })));
  test('a manager can\'t allow a wrong card from the app (only through the server)', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/purchases/b1`), { status: 'open', decision: { allow: true } })));
  test('a driver can\'t mark their own card as right', () => assertFails(updateDoc(doc(as('drv1'), `orgs/${O}/purchases/b1`), { 'card.result': 'match' })));
  test('nobody deletes one', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/purchases/b2`))));
  test('what the AI read and its cost: the app creator only', () => assertSucceeds(getDoc(doc(as('boss', { creator: true }), `orgs/${O}/buyReads/br1`))));
  test('…not the driver', () => assertFails(getDoc(doc(as('drv1'), `orgs/${O}/buyReads/br1`))));
  test('…not the owner', () => assertFails(getDoc(doc(as('own'), `orgs/${O}/buyReads/br1`))));
  test('the app creator viewing as a driver of S1 doesn\'t see others\' refuels', () => assertFails(getDoc(doc(as('vdrv', { creator: true }), `orgs/${O}/purchases/b1`))));
  test('…viewing as the S1 manager does', () => assertSucceeds(getDoc(doc(as('vmgr', { creator: true }), `orgs/${O}/purchases/b1`))));
});

describe('requests from the website', () => {
  // Written only by the websiteSignup function; read in the Firebase console. No app user reads or writes them,
  // not even the app creator, and nobody fakes a request or the spam counters from the app.
  const C = { creator: true };
  test('signed-out visitors can\'t read or write requests', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'siteRequests/q1')));
    await assertFails(setDoc(doc(anon, 'siteRequests/q2'), { company: 'x' }));
  });
  test('owners and the app creator can\'t read them either', async () => {
    await assertFails(getDoc(doc(as('own'), 'siteRequests/q1')));
    await assertFails(getDocs(collection(as('boss2', C), 'siteRequests')));
  });
  test('nobody writes, changes or deletes them from the app', async () => {
    await assertFails(setDoc(doc(as('own'), 'siteRequests/q3'), { company: 'x' }));
    await assertFails(updateDoc(doc(as('boss2', C), 'siteRequests/q1'), { status: 'done' }));
    await assertFails(deleteDoc(doc(as('boss2', C), 'siteRequests/q1')));
  });
  test('the spam counters are server-only', async () => {
    await assertFails(getDoc(doc(as('own'), 'siteLimits/day-2026-10-26')));
    await assertFails(setDoc(doc(as('own'), 'siteLimits/day-2026-10-26'), { n: 0 }));
  });
});
