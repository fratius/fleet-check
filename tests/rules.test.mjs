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
