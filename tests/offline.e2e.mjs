// The web app without a connection, in a real browser against the Firebase emulators (Test workflow):
// a fleet owner gives a van to a driver and renames it with no signal, reloads the app offline, and when the
// connection is back everything goes through by itself, once.
// Also with a connection: a photo as big as a phone camera's is shrunk in the browser and identified (Add vehicle),
// and the app doesn't say "No connection" when the server has answered with nothing new.
// And an incident written without signal that reaches the server much later (the rules want its time near the
// server's) is sent once more as made now, instead of stopping as "refused".
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
const ORG_A = 'onlineOrgA', ST_A = 'onlineStA', ORG_B = 'onlineOrgB', ST_B = 'onlineStB';
const OWNER2 = { email: 'ona.online@example.com', password: 'online-pass-1', name: 'Ona Owner' };

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
  // A second owner with two companies of her own: one with a van, one without any yet (for the last two tests).
  const o2 = await auth.createUser({ email: OWNER2.email, password: OWNER2.password, displayName: OWNER2.name });
  const b2 = db.batch();
  for (const [org, name, st] of [[ORG_A, 'Online DSP', ST_A], [ORG_B, 'Empty DSP', ST_B]]) {
    b2.set(db.doc(`orgs/${org}`), { name, createdBy: o2.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
    b2.set(db.doc(`orgs/${org}/members/${o2.uid}`), { role: 'owner', stationIds: [], email: OWNER2.email, name: OWNER2.name, joinedAt: now });
    b2.set(db.doc(`orgs/${org}/stations/${st}`), { name: 'Main station', code: 'DBE2', createdAt: now });
  }
  b2.set(db.doc(`orgs/${ORG_A}/vehicles/onlineVan1`), { name: '', plate: 'B-ON 1', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: ST_A, createdAt: now, createdBy: o2.uid, scanId: null });
  b2.set(db.doc(`users/${o2.uid}`), { orgIds: [ORG_A, ORG_B], orgId: ORG_A, email: OWNER2.email, name: OWNER2.name });
  await b2.commit();
  OWNER2.uid = o2.uid;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
});

const visible = (page, text) => page.locator(`text=${text} >> visible=true`).first();
// A button or tab by its exact label (texts elsewhere on the page can contain the same words).
const button = (page, text) => page.locator(`[role=button] >> text="${text}" >> visible=true`).first();
const tab = (page, text) => page.locator(`[role=tab] >> text="${text}" >> visible=true`).first();
async function until(fn, ms = 60_000, what = 'the condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
async function signIn(page, who) {
  await page.goto(URL0 + '/sign-in');
  await page.locator('input[type=email] >> visible=true').fill(who.email);
  await page.locator('input[type=password] >> visible=true').fill(who.password);
  await page.locator('[role=button] >> text=Sign in >> visible=true').last().click();
}
// The yellow strip of an app opened without a connection ("No connection. Showing what this phone last saw (…)").
const offlineStrip = (page) => page.locator('text=Showing what this phone last saw >> visible=true');
/** Opens another of the person's companies from Account, without leaving the page (the same session). */
async function openCompany(page, name) {
  const account = async () => {
    if (!(await page.locator('text="Your companies" >> visible=true').count())) await page.locator('text="Account" >> visible=true').last().click();
    await visible(page, 'Your companies').waitFor({ timeout: 30_000 });
  };
  // The open company is also the page's heading: its name is there twice (the heading and the list).
  const shown = page.locator(`text="${name}" >> visible=true`);
  await account();
  if ((await shown.count()) >= 2) return;
  await shown.last().click();
  // The app loads the company (a moment without pages) and shows its pages again.
  await until(async () => { await account(); return (await shown.count()) >= 2; }, 90_000, `${name} to open`);
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
  await visible(page, 'B-OF 1').waitFor({ timeout: 60_000 });
  await visible(page, 'B-OF 1').click();
  // The van page; the people of the station load once (and are kept for later).
  await button(page, 'Give to a driver').click();
  await visible(page, DRIVER.name).waitFor({ timeout: 30_000 });
  await button(page, 'Cancel').click();
  // The app keeps its files and what it saw (a few seconds after the data arrived).
  await page.waitForTimeout(6000);

  // The signal is gone.
  await ctx.setOffline(true);
  await button(page, 'Give to a driver').click();
  await visible(page, DRIVER.name).click();
  await visible(page, 'Saved on this phone. It goes through by itself, you don\'t need to do it again.').waitFor({ timeout: 30_000 });
  // Vans are called by their number plate (src/lib/vans.ts).
  await visible(page, `Give B-OF 1 to ${DRIVER.name}`).waitFor({ timeout: 10_000 });
  // Not offered again while it's on its way.
  assert.equal(await page.locator('text=Give to a driver >> visible=true').count(), 0);

  // Renamed offline: shows at once.
  await tab(page, 'Details').click();
  await button(page, 'Plate, name and type').click();
  // The plate comes first; the van's own name or fleet number second.
  const name = page.locator('input >> visible=true').nth(1);
  await name.fill('Van One');
  await button(page, 'Save changes').click();
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

test('a phone camera photo, bigger than the app sends, is shrunk in the browser and the van type is identified', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await signIn(page, OWNER2);
  const add = button(page, 'Add vehicle');
  await add.waitFor({ timeout: 60_000 });
  const orgId = (await db.doc(`users/${OWNER2.uid}`).get()).data().orgId;
  await add.click();
  // A 4000 × 3000 JPEG, like a phone camera's (the app sends at most 2400 px on the long side), made in the page.
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000; c.height = 3000;
    const x = c.getContext('2d');
    x.fillStyle = '#1e5bd8'; x.fillRect(0, 0, 4000, 3000);
    x.fillStyle = '#ffffff'; x.fillRect(800, 900, 2400, 1200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button(page, 'Choose photos').click()]);
  await chooser.setFiles({ name: 'van.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await page.locator('[aria-label="Remove photo 1"] >> visible=true').waitFor({ timeout: 30_000 });
  await button(page, 'Identify the type').click();
  // The emulator's stand-in for the AI answers "Test Van" (functions/src/claude.ts): the photo got there.
  await visible(page, 'Looks like a Test Van').waitFor({ timeout: 120_000 });
  assert.equal(await page.locator('text=/Couldn.t (upload|open) the photos/ >> visible=true').count(), 0);
  const scans = await db.collection(`orgs/${orgId}/scans`).get();
  assert.equal(scans.size, 1);
  assert.equal(scans.docs[0].data().photos, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('with a working connection the app never says "No connection": the same lists asked again, and no vans after a start without signal', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();

  await signIn(page, OWNER2);
  await button(page, 'Add vehicle').waitFor({ timeout: 60_000 });
  // Starts in the company with a van, whichever was open last.
  await openCompany(page, 'Online DSP');
  // The app keeps what it saw (a few seconds after the data arrived): from here on there is a saved copy.
  await page.waitForTimeout(6000);
  // The other company (no vans yet) and back: the same lists are asked again in the same session, and the
  // server confirms what the phone already has. That isn't "No connection".
  await openCompany(page, 'Empty DSP');
  await page.waitForTimeout(6000);
  await openCompany(page, 'Online DSP');
  await page.waitForTimeout(8000);
  assert.equal(await offlineStrip(page).count(), 0, '"No connection" after coming back to a company with the same vans');
  await openCompany(page, 'Empty DSP');
  await page.waitForTimeout(8000);
  assert.equal(await offlineStrip(page).count(), 0, '"No connection" after coming back to a company without vans');

  // Opened without a signal: the saved copy, and the strip says so.
  await ctx.setOffline(true);
  await page.reload();
  await offlineStrip(page).first().waitFor({ timeout: 60_000 });
  // The signal is back: the strip goes by itself, also when there is nothing new to load (no vans, nothing changed).
  await ctx.setOffline(false);
  await until(async () => (await offlineStrip(page).count()) === 0, 120_000, 'the "No connection" strip to go once the connection is back');
  // (The page is there, not between two states.)
  await visible(page, 'Your companies').waitFor({ timeout: 30_000 });
  assert.equal(await offlineStrip(page).count(), 0);
  await ctx.close();
});

test('an incident written without signal and sent twenty minutes later still goes through, as made when it arrives', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  // The page's clock starts twenty minutes ago and runs on from there: what's written now is twenty minutes old
  // once the clock is put right below, as if the phone had been without signal (or closed) that long. The rules
  // only take an incident whose time is within ten minutes of the server's.
  await page.clock.install({ time: new Date(Date.now() - 20 * 60_000) });
  await signIn(page, OWNER);
  await visible(page, 'B-OF 1').waitFor({ timeout: 60_000 });
  await page.locator('text="People" >> visible=true').last().click();
  await page.locator(`[aria-label^="${DRIVER.name}"] >> visible=true`).first().click();
  await button(page, 'Add an incident').waitFor({ timeout: 30_000 });

  // The signal is gone: the incident is written and kept on the phone.
  await ctx.setOffline(true);
  await button(page, 'Add an incident').click();
  await page.locator('textarea >> visible=true').last().fill('Parked on the pavement');
  await button(page, 'Add the incident').click();
  await visible(page, 'Parked on the pavement').waitFor({ timeout: 30_000 });
  assert.equal((await db.collection(`orgs/${ORG}/incidents`).get()).size, 0);

  // Twenty minutes later the signal is back: it goes through by itself, nobody writes it again.
  await page.clock.setSystemTime(new Date());
  await ctx.setOffline(false);
  const inc = await until(async () => {
    const q = await db.collection(`orgs/${ORG}/incidents`).get();
    return q.size ? q.docs[0].data() : null;
  }, 90_000, 'the incident to reach the server');
  assert.equal(inc.note, 'Parked on the pavement');
  assert.equal(inc.driverId, DRIVER.uid);
  assert.equal(inc.by, OWNER.uid);
  // It counts from when it arrived (like every change made without a connection).
  assert.ok(Math.abs(inc.createdAt - Date.now()) < 5 * 60_000, `createdAt is ${Math.round((Date.now() - inc.createdAt) / 60_000)} minutes old`);
  await until(async () => (await page.locator('text=/stopped\\. Tap to see why/ >> visible=true').count()) === 0 && (await page.locator('text=/wait(s)? on this phone/ >> visible=true').count()) === 0, 60_000, 'nothing left waiting or stopped');
  await visible(page, 'Parked on the pavement').waitFor({ timeout: 30_000 });
  await ctx.close();
});
