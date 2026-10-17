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
    await put(`invites/DRV111`, { code: 'DRV111', orgId: O, orgName: 'DSP One', role: 'driver', stationId: S1, stationName: 'DXX1', createdBy: 'mgr1', createdAt: 1 });
    await put(`invites/MGR222`, { code: 'MGR222', orgId: O, orgName: 'DSP One', role: 'manager', stationId: S2, stationName: 'DXX2', createdBy: 'own', createdAt: 1 });
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
  test('others cannot list companies', () => assertFails(getDocs(collection(as('own'), 'orgs'))));
  test('stranger cannot read a company', () => assertFails(getDoc(doc(as('nobody'), `orgs/${O}`))));
});

describe('changing vans', () => {
  test('manager adds a van to their station', () => assertSucceeds(setDoc(doc(as('mgr1'), `orgs/${O}/vehicles/n1`), { name: 'New', stationId: S1, createdAt: 3 })));
  test('manager cannot add a van to another station', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/vehicles/n2`), { name: 'New', stationId: S2, createdAt: 3 })));
  test('manager cannot move a van to another station', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`), { stationId: S2 })));
  test('owner moves a van between stations', () => assertSucceeds(updateDoc(doc(as('own'), `orgs/${O}/vehicles/v1`), { stationId: S2 })));
  test('driver cannot add a van', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/vehicles/n3`), { name: 'New', stationId: S1, createdAt: 3 })));
  test('driver cannot remove a van', () => assertFails(deleteDoc(doc(as('drv1'), `orgs/${O}/vehicles/v1`))));
  test('manager removes a van of their station', () => assertSucceeds(deleteDoc(doc(as('mgr1'), `orgs/${O}/vehicles/v1`))));
});

describe('walk-arounds and checks', () => {
  test('driver saves a walk-around at their station', () => assertSucceeds(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w2`), { vehicleId: 'v1', stationId: S1, createdBy: 'drv1', createdAt: 2 })));
  test('driver cannot save one for another station', () => assertFails(setDoc(doc(as('drv1'), `orgs/${O}/walkarounds/w3`), { vehicleId: 'v2', stationId: S2, createdBy: 'drv1', createdAt: 2 })));
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
  test('driver joins with a driver code', () => assertSucceeds(setDoc(doc(as('new1'), `orgs/${O}/members/new1`), { role: 'driver', stationIds: [S1], inviteCode: 'DRV111', name: 'N', email: 'n@x', joinedAt: 1 })));
  test('a driver code cannot make you a manager', () => assertFails(setDoc(doc(as('new1'), `orgs/${O}/members/new1`), { role: 'manager', stationIds: [S1], inviteCode: 'DRV111', name: 'N', email: 'n@x' })));
  test('a code cannot put you at another station', () => assertFails(setDoc(doc(as('new1'), `orgs/${O}/members/new1`), { role: 'driver', stationIds: [S2], inviteCode: 'DRV111', name: 'N', email: 'n@x' })));
  test('nobody joins as owner with a code', () => assertFails(setDoc(doc(as('new1'), `orgs/${O}/members/new1`), { role: 'owner', stationIds: [], inviteCode: 'MGR222', name: 'N', email: 'n@x' })));
  test('manager joins with a manager code', () => assertSucceeds(setDoc(doc(as('new2'), `orgs/${O}/members/new2`), { role: 'manager', stationIds: [S2], inviteCode: 'MGR222', name: 'N', email: 'n@x' })));
  test('manager makes a driver code for their station', () => assertSucceeds(setDoc(doc(as('mgr1'), 'invites/ABC123'), { code: 'ABC123', orgId: O, orgName: 'DSP One', role: 'driver', stationId: S1, stationName: 'DXX1', createdBy: 'mgr1', createdAt: 2 })));
  test('manager cannot make a manager code', () => assertFails(setDoc(doc(as('mgr1'), 'invites/ABC124'), { code: 'ABC124', orgId: O, orgName: 'DSP One', role: 'manager', stationId: S1, stationName: 'DXX1', createdBy: 'mgr1', createdAt: 2 })));
  test('manager cannot make a code for another station', () => assertFails(setDoc(doc(as('mgr1'), 'invites/ABC125'), { code: 'ABC125', orgId: O, orgName: 'DSP One', role: 'driver', stationId: S2, stationName: 'DXX2', createdBy: 'mgr1', createdAt: 2 })));
  test('owner makes a manager code', () => assertSucceeds(setDoc(doc(as('own'), 'invites/ABC126'), { code: 'ABC126', orgId: O, orgName: 'DSP One', role: 'manager', stationId: S2, stationName: 'DXX2', createdBy: 'own', createdAt: 2 })));
  test('driver cannot make codes', () => assertFails(setDoc(doc(as('drv1'), 'invites/ABC127'), { code: 'ABC127', orgId: O, orgName: 'DSP One', role: 'driver', stationId: S1, stationName: 'DXX1', createdBy: 'drv1', createdAt: 2 })));
  test('driver cannot list people', () => assertFails(getDocs(collection(as('drv1'), `orgs/${O}/members`))));
  test('driver reads their own membership', () => assertSucceeds(getDoc(doc(as('drv1'), `orgs/${O}/members/drv1`))));
  test('manager lists people', () => assertSucceeds(getDocs(collection(as('mgr1'), `orgs/${O}/members`))));
  test('manager removes a driver of their station', () => assertSucceeds(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/drv1`))));
  test('manager cannot remove a driver of another station', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/drv2`))));
  test('manager cannot remove the owner', () => assertFails(deleteDoc(doc(as('mgr1'), `orgs/${O}/members/own`))));
  test('owner moves a manager to another station', () => assertSucceeds(updateDoc(doc(as('own'), `orgs/${O}/members/mgr1`), { stationIds: [S2] })));
  test('manager cannot move drivers', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/members/drv1`), { stationIds: [S2] })));
  test('nobody changes their own role', () => assertFails(updateDoc(doc(as('mgr1'), `orgs/${O}/members/mgr1`), { role: 'owner' })));
  test('a driver can leave', () => assertSucceeds(deleteDoc(doc(as('drv1'), `orgs/${O}/members/drv1`))));
  test('the owner cannot leave their own company', () => assertFails(deleteDoc(doc(as('own'), `orgs/${O}/members/own`))));
  test('owner adds a station', () => assertSucceeds(setDoc(doc(as('own'), `orgs/${O}/stations/st3`), { name: 'DXX3', code: 'DXX3', createdAt: 3 })));
  test('manager cannot add a station', () => assertFails(setDoc(doc(as('mgr1'), `orgs/${O}/stations/st4`), { name: 'DXX4', code: 'DXX4', createdAt: 3 })));
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
