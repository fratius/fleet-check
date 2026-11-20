// The world the blind tester works in, on the Firebase emulators (qa/run.sh runs this inside emulators:exec).
// The tester never sees this file: it gets only the accounts and probe addresses written to $QA_DIR/accounts.md.
//
// - The app creator's sign-in (the `creator` claim, as Deploy sets it), who opens the demo company the normal way
//   (createDemoCompany): two stations, managers, drivers, vans, a month of history, tours, refuels and damage.
// - The demo's own two logins (a fleet manager and a driver at Berlin Spandau), a fleet manager and a driver at
//   Potsdam, and a fleet owner who isn't the app creator.
// - A second company ("Rival DSP") with its own owner, station, van and driver, to try what must stay apart.
// - The app's public address (config/web) set to the local web app, so invite and driver links open it.
// - Van-like photos in $QA_DIR/photos for screens that let you choose photos.
//
// These accounts exist only on the emulators and are thrown away after the run (no sign-in is made in the live
// project; AGENTS.md, "View as").
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const rootRequire = createRequire(new URL('../package.json', import.meta.url));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getAuth } = fnRequire('firebase-admin/auth');
const { getFirestore } = fnRequire('firebase-admin/firestore');
const jpeg = rootRequire('jpeg-js');

const PROJECT = 'demo-fleet-check';
const QA_DIR = process.env.QA_DIR;
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8099';
if (!QA_DIR) throw new Error('QA_DIR is not set.');
for (const v of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!process.env[v]) throw new Error(`${v} is not set: run this inside firebase emulators:exec.`);
}

const app = initializeApp({ projectId: PROJECT }, 'qa-seed');
const auth = getAuth(app);
const db = getFirestore(app);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const now = Date.now();
const pw = (s) => `qa-${s}-${Math.random().toString(36).slice(2, 10)}`;

async function signIn(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`Sign-in of ${email} failed: ${JSON.stringify(j)}`);
  return j.idToken;
}
async function call(fn, token, data) {
  const r = await fetch(`${FUNCTIONS}/${fn}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${fn} failed: ${JSON.stringify(j.error || j)}`);
  return j.result;
}
async function person(email, name) {
  const password = pw(email.split('@')[0].split('.')[0]);
  const u = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  return { uid: u.uid, email, password, name };
}
/** A sign-in that is a member of a company (the way the demo makes its own logins). */
async function member(org, p, role, stationIds) {
  const [firstName, ...rest] = p.name.split(' ');
  await db.doc(`orgs/${org}/members/${p.uid}`).set({ role, stationIds, name: p.name, firstName, lastName: rest.join(' '), email: p.email, phone: '', transporterId: '', joinedAt: now - 10 * 86400_000 });
  await db.doc(`users/${p.uid}`).set({ orgIds: [org], orgId: org, email: p.email, name: p.name });
}

// 1. The app creator opens the demo company, as in the app.
const creator = await person('casey.creator@qa.example.com', 'Casey Creator');
await auth.setCustomUserClaims(creator.uid, { creator: true });
const { orgId: demo } = await call('createDemoCompany', await signIn(creator.email, creator.password), {});
const demoDoc = (await db.doc(`orgs/${demo}`).get()).data();
const stations = (await db.collection(`orgs/${demo}/stations`).orderBy('createdAt').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const [stA, stB] = stations;
const login = (role) => {
  const l = demoDoc.demoLogins.find((x) => x.role === role);
  return { uid: l.uid, email: l.email, password: l.password, name: l.name };
};
const managerA = login('manager');
const driverA = login('driver');

// 2. More sign-ins in the demo company: a fleet owner who isn't the app creator, a manager and a driver at Potsdam.
const owner = await person('olivia.owner@qa.example.com', 'Olivia Owner');
await member(demo, owner, 'owner', []);
const managerB = await person('peter.potsdam@qa.example.com', 'Peter Potsdam');
await member(demo, managerB, 'manager', [stB.id]);
const driverB = await person('pia.potsdam@qa.example.com', 'Pia Potsdam');
await member(demo, driverB, 'driver', [stB.id]);

// 3. Another company, to try what must stay apart.
const rivalOwner = await person('rita.rival@qa.example.com', 'Rita Rival');
const rivalDriver = await person('ron.rival@qa.example.com', 'Ron Rival');
const rival = 'qaRivalOrg1', rivalSt = 'qaRivalSt1', rivalVan = 'qaRivalVan1';
await db.doc(`orgs/${rival}`).set({ name: 'Rival DSP', createdBy: rivalOwner.uid, createdAt: now - 20 * 86400_000, stationsReady: true, aiTier: 'quick' });
await db.doc(`orgs/${rival}/stations/${rivalSt}`).set({ name: 'Hamburg Nord', code: 'DHH2', createdAt: now - 20 * 86400_000 });
await db.doc(`orgs/${rival}/vehicles/${rivalVan}`).set({ name: 'Rival 1', plate: 'HH-RV 77', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: rivalSt, createdAt: now - 20 * 86400_000, createdBy: rivalOwner.uid, scanId: null });
await member(rival, rivalOwner, 'owner', []);
await member(rival, rivalDriver, 'driver', [rivalSt]);

// 4. Invite and driver links open the local web app.
await db.doc('config/web').set({ url: APP_URL, updatedAt: now });

// Probe addresses: things some sign-ins must not be able to open.
const vansAt = async (st) => (await db.collection(`orgs/${demo}/vehicles`).where('stationId', '==', st).limit(1).get()).docs[0];
const vanA = await vansAt(stA.id), vanB = await vansAt(stB.id);
const otherDriverA = (await db.collection(`orgs/${demo}/members`).where('stationIds', 'array-contains', stA.id).get()).docs
  .find((d) => d.data().role === 'driver' && d.id !== driverA.uid);
const driverAtB = (await db.collection(`orgs/${demo}/members`).where('stationIds', 'array-contains', stB.id).get()).docs
  .find((d) => d.data().role === 'driver' && d.id !== driverB.uid);
const plate = (d) => d?.data().plate || '?';

// 5. Van-like photos (a white van on a grey yard, a plate) for screens that let you choose photos.
mkdirSync(join(QA_DIR, 'photos'), { recursive: true });
function van(w, h, side) {
  const data = Buffer.alloc(w * h * 4);
  const put = (x, y, r, g, b) => { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ground = y > h * 0.72;
    let c = ground ? [92, 92, 96] : [168, 186, 204];
    const bx0 = w * (side ? 0.1 : 0.25), bx1 = w * (side ? 0.9 : 0.75);
    const inBody = x > bx0 && x < bx1 && y > h * 0.25 && y < h * 0.75;
    if (inBody) c = [238, 240, 242];
    if (inBody && y < h * 0.42 && (side ? x > w * 0.72 : true) && x > bx0 + 8 && x < bx1 - 8) c = [40, 52, 64];
    const wheel = (cx) => (x - cx) ** 2 + (y - h * 0.75) ** 2 < (h * 0.07) ** 2;
    if (wheel(w * (side ? 0.25 : 0.33)) || wheel(w * (side ? 0.75 : 0.67))) c = [20, 20, 20];
    if (!side && x > w * 0.42 && x < w * 0.58 && y > h * 0.62 && y < h * 0.68) c = [250, 250, 250];
    put(x, y, ...c);
  }
  return jpeg.encode({ data, width: w, height: h }, 85).data;
}
const shots = [['van-front.jpg', false], ['van-left.jpg', true], ['van-rear.jpg', false], ['van-right.jpg', true]];
for (const [f, side] of shots) writeFileSync(join(QA_DIR, 'photos', f), van(1600, 1200, side));

// 6. What the tester gets.
const row = (role, where, p) => `| ${role} | ${where} | ${p.name} | ${p.email} | ${p.password} |`;
const md = `# Test system: address and accounts

App: ${APP_URL} (sign in at ${APP_URL}/sign-in)

| Role | Company, station | Name | Email | Password |
|---|---|---|---|---|
${row('App creator', 'every company; owner of Demo DSP', creator)}
${row('Fleet owner', `Demo DSP (test data), all stations`, owner)}
${row('Fleet manager A', `Demo DSP, ${stA.name}`, managerA)}
${row('Driver A', `Demo DSP, ${stA.name}`, driverA)}
${row('Fleet manager B', `Demo DSP, ${stB.name}`, managerB)}
${row('Driver B', `Demo DSP, ${stB.name} (no van yet)`, driverB)}
${row('Fleet owner (other company)', 'Rival DSP, Hamburg Nord', rivalOwner)}
${row('Driver (other company)', 'Rival DSP, Hamburg Nord', rivalDriver)}

Demo DSP has two stations, ${stA.name} and ${stB.name}, with vans, drivers, a month of history, tours, refuels
and damage already in it. Drivers pick up and drop off vans themselves at ${stA.name} (switched on); at ${stB.name}
it's off until an owner or that station's manager switches it on.

## Probes: addresses some sign-ins must not open

| Address | What it is | Must NOT open it |
|---|---|---|
| ${APP_URL}/vehicle/${vanB.id} | van ${plate(vanB)} at ${stB.name} | Fleet manager A, Driver A, both Rival DSP sign-ins |
| ${APP_URL}/vehicle/${vanA.id} | van ${plate(vanA)} at ${stA.name} | Fleet manager B, Driver B, both Rival DSP sign-ins |
| ${APP_URL}/person/${driverAtB?.id} | ${driverAtB?.data().name}, driver at ${stB.name} | Fleet manager A, Driver A, Driver B (another driver), Rival DSP |
| ${APP_URL}/person/${otherDriverA?.id} | ${otherDriverA?.data().name}, driver at ${stA.name} | Driver A (another driver), Fleet manager B, Rival DSP |
| ${APP_URL}/vehicle/${rivalVan} | van HH-RV 77 of Rival DSP | everyone in Demo DSP except the App creator |
`;
writeFileSync(join(QA_DIR, 'accounts.md'), md);
console.log(`Seeded: demo company ${demo} (${stations.map((s) => s.name).join(', ')}), Rival DSP, 8 sign-ins.`);
process.exit(0);
