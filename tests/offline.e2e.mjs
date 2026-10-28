// The web app without a connection, in a real browser against the Firebase emulators (Test workflow):
// a fleet owner gives a van to a driver and renames it with no signal, reloads the app offline, and when the
// connection is back everything goes through by itself, once.
// Run: emulators:exec --only auth,firestore,functions,storage "node --test tests/offline.e2e.mjs" (APP_DIR = the web build).
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { chromium } from 'playwright';

const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getAuth } = fnRequire('firebase-admin/auth');
const { getFirestore } = fnRequire('firebase-admin/firestore');

const APP_DIR = process.env.APP_DIR || new URL('../dist-e2e', import.meta.url).pathname;
const PORT = 8099;
const URL0 = `http://127.0.0.1:${PORT}`;
const app = initializeApp({ projectId: 'demo-fleet-check' }, 'offline-e2e');
const db = getFirestore(app);
const auth = getAuth(app);

// The web build, served like Hosting does (every page is the app).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, URL0).pathname);
  let f = join(APP_DIR, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(APP_DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': p === '/sw.js' ? 'no-cache' : 'no-store' });
  createReadStream(f).pipe(res);
});

let browser;
const ORG = 'offlineOrg1', ST = 'offlineSt1', VAN = 'offlineVan1';
const OWNER = { email: 'olga.offline@example.com', password: 'offline-pass-1', name: 'Olga Owner' };
const DRIVER = { email: 'dana.offline@example.com', password: 'offline-pass-2', name: 'Dana Driver' };

before(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const o = await auth.createUser({ email: OWNER.email, password: OWNER.password, displayName: OWNER.name });
  const d = await auth.createUser({ email: DRIVER.email, password: DRIVER.password, displayName: DRIVER.name });
  const now = Date.now();
  const b = db.batch();
  b.set(db.doc(`orgs/${ORG}`), { name: 'Offline DSP', createdBy: o.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
  b.set(db.doc(`orgs/${ORG}/members/${o.uid}`), { role: 'owner', stationIds: [], email: OWNER.email, name: OWNER.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG}/members/${d.uid}`), { role: 'driver', stationIds: [ST], email: DRIVER.email, name: DRIVER.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG}/stations/${ST}`), { name: 'Main station', code: 'DBE1', createdAt: now });
  b.set(db.doc(`orgs/${ORG}/vehicles/${VAN}`), { name: 'Van 1', plate: 'B-OF 1', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: ST, createdAt: now, createdBy: o.uid, scanId: null });
  b.set(db.doc(`users/${o.uid}`), { orgIds: [ORG], orgId: ORG, email: OWNER.email, name: OWNER.name });
  await b.commit();
  OWNER.uid = o.uid; DRIVER.uid = d.uid;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
});

const visible = (page, text) => page.locator(`text=${text} >> visible=true`).first();
async function until(fn, ms = 60_000, what = 'the condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test('no signal in the garage: give a van and rename it offline, reopen the app offline, everything goes through once', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Online: sign in, the fleet loads.
  await page.goto(URL0 + '/sign-in');
  await page.locator('input[type=email] >> visible=true').fill(OWNER.email);
  await page.locator('input[type=password] >> visible=true').fill(OWNER.password);
  await page.locator('[role=button] >> text=Sign in >> visible=true').last().click();
  await visible(page, 'Van 1').waitFor({ timeout: 60_000 });
  await visible(page, 'Van 1').click();
  // The van page; the people of the station load once (and are kept for later).
  await visible(page, 'Give to a driver').click();
  await visible(page, DRIVER.name).waitFor({ timeout: 30_000 });
  await visible(page, 'Cancel').click();
  // The app keeps its files and what it saw (a few seconds after the data arrived).
  await page.waitForTimeout(6000);

  // The signal is gone.
  await ctx.setOffline(true);
  await visible(page, 'Give to a driver').click();
  await visible(page, DRIVER.name).click();
  await visible(page, 'Saved on this phone. It goes through by itself when there\'s a connection.').waitFor({ timeout: 20_000 });
  await visible(page, `Give Van 1 to ${DRIVER.name}`).waitFor({ timeout: 10_000 });
  // Not offered again while it's on its way.
  assert.equal(await page.locator('text=Give to a driver >> visible=true').count(), 0);

  // Renamed offline: shows at once.
  await visible(page, 'Details').click();
  await visible(page, 'Name, plate and type').click();
  const name = page.locator('input >> visible=true').first();
  await name.fill('Van One');
  await visible(page, 'Save changes').click();
  await visible(page, 'Van One').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4000);

  // The app is closed and opened again, still without a connection: it opens, with what it saw and what waits.
  await page.reload();
  await visible(page, 'Van One').waitFor({ timeout: 30_000 });
  await visible(page, 'No connection').waitFor({ timeout: 30_000 });
  // Nothing reached the server yet.
  const before = (await db.doc(`orgs/${ORG}/vehicles/${VAN}`).get()).data();
  assert.equal(before.name, 'Van 1');
  assert.equal(before.assignedTo ?? null, null);

  // The connection is back: it all goes through by itself.
  await ctx.setOffline(false);
  const van = await until(async () => {
    const v = (await db.doc(`orgs/${ORG}/vehicles/${VAN}`).get()).data();
    return v.name === 'Van One' && v.assignedTo?.driverId === DRIVER.uid ? v : null;
  }, 90_000, 'the van to be renamed and given to the driver on the server');
  assert.equal(van.assignedTo.driverName, DRIVER.name);
  // Once: one handover, started by the owner.
  const hand = await db.collection(`orgs/${ORG}/assignments`).where('vehicleId', '==', VAN).get();
  assert.equal(hand.size, 1);
  assert.equal(hand.docs[0].data().startedBy, OWNER.uid);
  // Nothing left waiting on the phone.
  await until(async () => (await page.locator('text=/wait(s)? on this phone/ >> visible=true').count()) === 0, 60_000, 'the strip to go');
  assert.deepEqual(errors, []);
  await ctx.close();
});
