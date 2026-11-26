// The web app without a connection, in a real browser against the Firebase emulators (Test workflow):
// a fleet owner gives a van to a driver and renames it with no signal, reloads the app offline, and when the
// connection is back everything goes through by itself, once.
// Also with a connection: a photo as big as a phone camera's is shrunk in the browser and identified (Add vehicle),
// and the app doesn't say "No connection" when the server has answered with nothing new.
// And an incident written without signal that reaches the server much later (the rules want its time near the
// server's) is sent once more as made now, instead of stopping as "refused".
// And a sign-up link without a card: the sign-up page asks for no card and the company opens with its free days.
// And the AI comparison of a walk-around shows for its owner, also in a demo company; and for the driver who took the
// pick-up or drop-off photos, with the close-ups to take.
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
const { FieldValue, getFirestore } = fnRequire('firebase-admin/firestore');

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
  // A fake camera (the same as the blind tester's), for the walk-around tests at the end.
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
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
  assert.equal(van.assignedTo.driverName, undefined, 'drivers read the van: no names on it');
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
  // The plate read from the same photo is in the plate field, with a note to check it against the van.
  await visible(page, 'Read from the photo. Check it against the van.').waitFor({ timeout: 10_000 });
  assert.ok((await page.locator('input').evaluateAll((els) => els.map((e) => e.value))).includes('B-FR 1234'), 'the plate field filled from the photo');
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

test('the AI comparison of a walk-around shows for the owner, also in a demo company', async () => {
  // The blind tester found the card hidden in a demo company, where walk-arounds are compared too (PR #32).
  // Written past the rules as the server writes it; the walk-around is marked as made-up so the trigger leaves it.
  const now = Date.now();
  const ORG_D = 'demoCmpOrg', ST_D = 'demoCmpSt', VAN_D = 'demoCmpVan', WALK = 'demoCmpWalk';
  const b = db.batch();
  b.set(db.doc(`orgs/${ORG_D}`), { name: 'Demo DSP (test data)', createdBy: OWNER2.uid, createdAt: now, stationsReady: true, aiTier: 'quick', demo: true });
  b.set(db.doc(`orgs/${ORG_D}/members/${OWNER2.uid}`), { role: 'owner', stationIds: [], email: OWNER2.email, name: OWNER2.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_D}/stations/${ST_D}`), { name: 'Main station', code: 'DBE3', createdAt: now });
  b.set(db.doc(`orgs/${ORG_D}/vehicles/${VAN_D}`), { name: '', plate: 'B-DC 1', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: ST_D, createdAt: now, createdBy: OWNER2.uid, scanId: null });
  b.set(db.doc(`orgs/${ORG_D}/walkarounds/${WALK}`), {
    vehicleId: VAN_D, vehicleName: 'B-DC 1', cls: 'large_van', stationId: ST_D, source: 'camera', createdAt: now, createdBy: OWNER2.uid, demo: false,
    totalMs: null, frames: 1, taken: 1, skipped: 0, retakes: 0, photos: [{ n: 1, label: 'Front', w: 900, h: 1200, takenAt: now }],
    cmp: { status: 'done', at: now, frames: 12, compared: 12, notCompared: [], found: 1, unsure: 0, checkId: null, refAt: now - 3600_000 },
  });
  b.set(db.doc(`users/${OWNER2.uid}`), { orgIds: [ORG_A, ORG_B, ORG_D] }, { merge: true });
  await b.commit();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(page, OWNER2);
  await openCompany(page, 'Demo DSP (test data)');
  await page.goto(`${URL0}/walk/${WALK}`);
  await visible(page, 'AI comparison').waitFor({ timeout: 60_000 });
  await visible(page, '1 possible new damage').waitFor({ timeout: 10_000 });
  await visible(page, '12 photos compared with the van\'s photos from').waitFor({ timeout: 10_000 });
  await page.context().close();
});

test('A1, A4–A7: the driver sees the AI result of their pick-up or drop-off on the Vans tab, and the close-ups on the check', async () => {
  // Product owner, 2026-11-22. Written past the rules as the server writes them; the walk-arounds' photos have no files,
  // so the comparison trigger leaves them alone.
  const now = Date.now();
  const ORG_C = 'closeupOrg', ST_C = 'closeupSt', VAN_C = 'closeupVan', W1 = 'closeupWalk1', K1 = 'cmp-closeupWalk1';
  const RIA = { email: 'ria.closeup@example.com', password: 'closeup-pass-1', name: 'Ria Driver' };
  const r = await auth.createUser({ email: RIA.email, password: RIA.password, displayName: RIA.name });
  const b = db.batch();
  b.set(db.doc(`orgs/${ORG_C}`), { name: 'Closeup DSP', createdBy: OWNER2.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
  b.set(db.doc(`orgs/${ORG_C}/members/${OWNER2.uid}`), { role: 'owner', stationIds: [], email: OWNER2.email, name: OWNER2.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_C}/members/${r.uid}`), { role: 'driver', stationIds: [ST_C], email: RIA.email, name: RIA.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_C}/stations/${ST_C}`), { name: 'Main station', code: 'DBE4', createdAt: now });
  b.set(db.doc(`orgs/${ORG_C}/vehicles/${VAN_C}`), { name: '', plate: 'B-CU 1', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: ST_C, createdAt: now, createdBy: OWNER2.uid, scanId: null });
  b.set(db.doc(`users/${r.uid}`), { orgIds: [ORG_C], orgId: ORG_C, email: RIA.email, name: RIA.name });
  const walk = (id, at, kind, cmp) => b.set(db.doc(`orgs/${ORG_C}/walkarounds/${id}`), {
    vehicleId: VAN_C, vehicleName: 'B-CU 1', cls: 'large_van', stationId: ST_C, source: 'camera', createdAt: at, createdBy: r.uid,
    totalMs: null, frames: 1, taken: 1, skipped: 0, retakes: 0, photos: [{ n: 1, label: 'Front', w: 900, h: 1200, takenAt: at }],
    handover: { kind, assignmentId: 'closeupA1' }, forHandover: kind, cmp,
  });
  walk(W1, now - 60_000, 'dropoff', { status: 'done', at: now, frames: 12, compared: 12, notCompared: [], found: 1, unsure: 0, checkId: K1, refAt: now - 86400_000 });
  const spot = { photo: 0, photoLabel: 'Front', box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, conf: 0.8, mightBe: null, closeup: '',
    refPath: null, beforePath: null, beforeWalkId: 'closeupWalk0', beforeAt: now - 86400_000, closeups: [], feedback: null, markPath: null, verdict: null,
    cmp: { verdict: 'damage', confidence: 0.8, reason: 'A new scratch on the bumper.', severity: 'cosmetic' } };
  const kref = db.doc(`orgs/${ORG_C}/checks/${K1}`);
  b.set(kref, {
    vehicleId: VAN_C, vehicleName: 'B-CU 1', cls: 'large_van', walkId: W1, createdAt: now - 50_000, createdBy: null, auto: 'compare', walkBy: r.uid, walkKind: 'dropoff',
    refWalkIds: ['closeupWalk0'], refAt: now - 86400_000, stationId: ST_C, status: 'checking', submittedAt: null, review: null, closeupBy: now + 29 * 60_000,
    tier: 'complex', model: 'test', photos: 12, spots: [spot], notVisible: [], notCompared: [], missedNote: '',
  });
  await b.commit();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(page, RIA);
  // A4 on the Vans tab: close-ups to take, with the time they have.
  await visible(page, 'AI check of your drop-off photos').waitFor({ timeout: 60_000 });
  await visible(page, 'The AI found 1 spot that may be new damage. Take close-ups of it now').waitFor({ timeout: 10_000 });
  await visible(page, 'After that the spots go to your fleet manager without close-ups.').waitFor({ timeout: 10_000 });
  await button(page, 'Take close-ups').click();
  // The check: the before and after of the spot, and the close-ups to take.
  await visible(page, 'Take close-ups of 1 spot').waitFor({ timeout: 30_000 });
  await visible(page, 'Before,').waitFor({ timeout: 10_000 });
  await visible(page, 'AI: new damage').waitFor({ timeout: 10_000 });
  // A5: the close-ups showed damage.
  const shot = { ...spot, closeups: ['orgs/closeupOrg/checks/cmp-closeupWalk1/spot1_1_x.jpg'],
    verdict: { verdict: 'damage', type: 'scratch', sizeCm: 6, severity: 'cosmetic', confidence: 0.9, reason: 'A scratch in the close-up.', closeupBox: null } };
  await kref.update({ status: 'submitted', submittedAt: Date.now(), submittedBy: r.uid, spots: [shot] });
  await visible(page, 'Your fleet manager is reviewing the possible damage.').waitFor({ timeout: 30_000 });
  await visible(page, 'Close-ups: damage').waitFor({ timeout: 10_000 });
  // No decision for a driver.
  assert.equal(await button(page, 'Not damage').count(), 0);
  await page.goto(`${URL0}/`);
  await visible(page, 'Your fleet manager is reviewing the possible damage.').waitFor({ timeout: 60_000 });
  // A6: the close-ups showed none.
  await kref.update({ spots: [{ ...shot, verdict: { ...shot.verdict, verdict: 'no_damage', type: null, sizeCm: null, severity: null } }] });
  await visible(page, 'Your close-ups show no damage. Your fleet manager confirms it.').waitFor({ timeout: 30_000 });
  // A7: nobody took close-ups within 30 minutes.
  await kref.update({ spots: [{ ...spot, verdict: { verdict: 'skipped', type: null, sizeCm: null, severity: null, confidence: null, reason: '', closeupBox: null } }],
    submittedBy: null, sentLate: true, noCloseups: true });
  await visible(page, 'Nobody took close-ups within 30 minutes, so the spots went to your fleet manager without them.').waitFor({ timeout: 30_000 });
  // A1/A2: a newer pick-up with nothing new; A3: the van's first photos.
  await db.doc(`orgs/${ORG_C}/walkarounds/closeupWalk2`).set({
    vehicleId: VAN_C, vehicleName: 'B-CU 1', cls: 'large_van', stationId: ST_C, source: 'camera', createdAt: Date.now(), createdBy: r.uid,
    totalMs: null, frames: 1, taken: 1, skipped: 0, retakes: 0, photos: [{ n: 1, label: 'Front', w: 900, h: 1200, takenAt: Date.now() }],
    handover: { kind: 'pickup', assignmentId: 'closeupA2' }, forHandover: 'pickup',
    cmp: { status: 'done', at: Date.now(), frames: 12, compared: 12, notCompared: [], found: 0, unsure: 0, checkId: null, refAt: now - 60_000 },
  });
  await visible(page, 'AI check of your pick-up photos').waitFor({ timeout: 30_000 });
  await visible(page, 'No new damage on your pick-up photos.').waitFor({ timeout: 10_000 });
  await db.doc(`orgs/${ORG_C}/walkarounds/closeupWalk2`).update({ cmp: { status: 'first', at: Date.now(), frames: 12, compared: 0, notCompared: [], found: 0, unsure: 0, checkId: null, refAt: null } });
  await visible(page, 'These are the first photos of this van: the next pick-ups and drop-offs are compared with them.').waitFor({ timeout: 30_000 });
  // Close-ups still to take on the earlier drop-off stay on the Vans tab next to the newer pick-up (blind QA, round 1).
  await kref.update({ status: 'checking', submittedAt: null, sentLate: false, noCloseups: false, spots: [spot] });
  await visible(page, 'AI check of your drop-off photos').waitFor({ timeout: 30_000 });
  await button(page, 'Take close-ups').waitFor({ timeout: 10_000 });
  await visible(page, 'AI check of your pick-up photos').waitFor({ timeout: 10_000 });
  await page.context().close();
});

// ---------- Signing out (product owner, 2026-11-22): asks first, waits for the answer, always signs out ----------
const ORG_S = 'signoutOrg', ST_S = 'signoutSt', VAN_S = 'signoutVan';
const SO_MGR = { email: 'sami.signout@example.com', password: 'signout-pass-1', name: 'Sami Manager' };
const SO_DRV = { email: 'dora.signout@example.com', password: 'signout-pass-2', name: 'Dora Driver' };
async function signoutCompany() {
  if (SO_MGR.uid) return;
  const now = Date.now();
  const m = await auth.createUser({ email: SO_MGR.email, password: SO_MGR.password, displayName: SO_MGR.name });
  const d = await auth.createUser({ email: SO_DRV.email, password: SO_DRV.password, displayName: SO_DRV.name });
  const b = db.batch();
  b.set(db.doc(`orgs/${ORG_S}`), { name: 'Signout DSP', createdBy: OWNER.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
  b.set(db.doc(`orgs/${ORG_S}/members/${OWNER.uid}`), { role: 'owner', stationIds: [], email: OWNER.email, name: OWNER.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_S}/members/${m.uid}`), { role: 'manager', stationIds: [ST_S], email: SO_MGR.email, name: SO_MGR.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_S}/members/${d.uid}`), { role: 'driver', stationIds: [ST_S], email: SO_DRV.email, name: SO_DRV.name, joinedAt: now });
  b.set(db.doc(`orgs/${ORG_S}/stations/${ST_S}`), { name: 'Main station', code: 'DBE5', createdAt: now });
  b.set(db.doc(`orgs/${ORG_S}/vehicles/${VAN_S}`), { name: 'Van S', plate: 'B-SO 1', cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: ST_S, createdAt: now, createdBy: OWNER.uid, scanId: null });
  for (const [u, who] of [[m, SO_MGR], [d, SO_DRV]]) b.set(db.doc(`users/${u.uid}`), { orgIds: [ORG_S], orgId: ORG_S, email: who.email, name: who.name });
  await b.commit();
  SO_MGR.uid = m.uid; SO_DRV.uid = d.uid;
}
const accountTab = async (page) => {
  await page.locator('text="Account" >> visible=true').last().click();
  await visible(page, 'Version').waitFor({ timeout: 30_000 });
};
const signInScreen = (page) => page.locator('input[type=email] >> visible=true').first();
/** Waits for the sign-in screen; if it doesn't come, says what the page shows instead. */
async function onSignIn(page, ms = 15_000) {
  try { await signInScreen(page).waitFor({ timeout: ms }); } catch (e) {
    const text = await page.locator('body').innerText().catch(() => '?');
    throw new Error(`No sign-in screen at ${page.url()}. The page shows: ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
  }
}

test('A1, A4: signing out asks first, the question stays until answered, and Cancel changes nothing', async () => {
  await signoutCompany();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await signIn(page, SO_DRV);
  await visible(page, 'B-SO 1').waitFor({ timeout: 60_000 });
  await accountTab(page);
  await button(page, 'Sign out').click();
  await visible(page, 'Sign out of Fratius?').waitFor({ timeout: 10_000 });
  // A1: it doesn't go away by itself (it used to, after 3 seconds).
  await page.waitForTimeout(5000);
  assert.equal(await page.locator('text="Sign out of Fratius?" >> visible=true').count(), 1);
  assert.equal(await button(page, 'Cancel').count(), 1);
  // A4: Cancel: still signed in, on the Account tab.
  await button(page, 'Cancel').click();
  await until(async () => (await page.locator('text="Sign out of Fratius?" >> visible=true').count()) === 0, 10_000, 'the question to go');
  await visible(page, 'Version').waitFor({ timeout: 5000 });
  await button(page, 'Sign out').waitFor({ timeout: 5000 });
  await page.reload();
  await visible(page, 'Version').waitFor({ timeout: 60_000 });
  assert.equal(await signInScreen(page).count(), 0);
  await ctx.close();
});

test('A2, A3: after confirming it shows "Signing out…", then sign-in; even when the phone can\'t clear what it saved', async () => {
  await signoutCompany();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await signIn(page, SO_DRV);
  await visible(page, 'B-SO 1').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  await accountTab(page);
  // A3: clearing what this phone kept never finishes (its storage is stuck); Firebase's own storage still works.
  await page.evaluate(() => {
    const orig = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      if (this.name === 'fratius-outbox') return { objectStore: () => ({ getAllKeys: () => ({}), delete: () => ({}), get: () => ({}), put: () => ({}) }) };
      return orig.apply(this, a);
    };
  });
  await button(page, 'Sign out').click();
  await visible(page, 'Sign out of Fratius?').waitFor({ timeout: 10_000 });
  const t0 = Date.now();
  await button(page, 'Sign out').click();
  // A2: it shows it's working, then the sign-in screen within a few seconds.
  await visible(page, 'Signing out…').waitFor({ timeout: 3000 });
  await onSignIn(page);
  assert.ok(Date.now() - t0 < 15_000);
  // The app's address, or Back: sign-in, never the app or the company's data.
  for (const go of [() => page.goto(`${URL0}/account`), () => page.goBack(), () => page.goto(`${URL0}/`)]) {
    await go();
    await onSignIn(page, 30_000);
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('text=B-SO 1 >> visible=true').count(), 0);
    assert.equal(await page.locator('text="Version" >> visible=true').count(), 0);
  }
  await ctx.close();
});

test('A3, A5: signing out without a connection, with a change not sent yet: it says so, and the change goes through at the next sign-in', async () => {
  await signoutCompany();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await signIn(page, SO_MGR);
  await visible(page, 'B-SO 1').waitFor({ timeout: 60_000 });
  await visible(page, 'B-SO 1').click();
  await tab(page, 'Details').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  // No connection: the van is renamed on this phone only.
  await ctx.setOffline(true);
  await tab(page, 'Details').click();
  await button(page, 'Plate, name and type').click();
  await page.locator('input >> visible=true').nth(1).fill('Van Signout');
  await button(page, 'Save changes').click();
  await visible(page, 'Van Signout').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  await accountTab(page);
  await button(page, 'Sign out').click();
  // A5: the question says something waits on this phone.
  await visible(page, 'Sign out of Fratius?').waitFor({ timeout: 10_000 });
  await visible(page, '1 thing made on this phone isn\'t sent yet.').waitFor({ timeout: 10_000 });
  await button(page, 'Sign out').click();
  // A3: signed out without a connection.
  await onSignIn(page);
  assert.equal((await db.doc(`orgs/${ORG_S}/vehicles/${VAN_S}`).get()).data().name, 'Van S');
  // A5: the next sign-in on this phone sends it.
  await ctx.setOffline(false);
  await signIn(page, SO_MGR);
  await until(async () => (await db.doc(`orgs/${ORG_S}/vehicles/${VAN_S}`).get()).data().name === 'Van Signout', 90_000, 'the rename to reach the server');
  await ctx.close();
});

test('a sign-up link without a card: the page asks for no card, and the company opens with its free days', async () => {
  // Payments on with the tests' fake Stripe (functions/src/payments.ts), and a link the app creator made with
  // "Require a credit card" off (product owner, 2026-11-20). Nothing from js.stripe.com is needed on this path.
  await db.doc('platform/stripe').set({ mode: 'fake', publishableKey: 'pk_test_fake', tax: { mode: 'rate', rateId: 'txr_fake' } });
  const CODE = 'NOCARDE2E';
  await db.doc(`offers/${CODE}`).set({
    code: CODE, note: 'e2e', plan: 'pro', interval: 'month', trialDays: 21, percentOff: null, amountOff: null, months: null, validUntil: null,
    maxUses: 1, uses: 0, ended: false, requireCard: false, createdAt: Date.now(), createdBy: 'e2e',
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A text field by the label above it (components/ui.tsx, Field).
  const field = (label) => page.locator(`xpath=//*[normalize-space(.)="${label}"]/following-sibling::input[1] >> visible=true`).first();
  try {
    await page.goto(`${URL0}/start?offer=${CODE}`);
    const start = page.locator('[role=button] >> text=/^Start free until / >> visible=true').first();
    await start.waitFor({ timeout: 60_000 });
    // No card form: no Stripe fields, no "Company and card".
    assert.equal(await page.locator('text="Company and card" >> visible=true').count(), 0);
    assert.equal(await page.locator('iframe[name^="__privateStripeFrame"]').count(), 0);
    await visible(page, 'Free until').waitFor({ timeout: 10_000 });
    await field('Your name').fill('Nina Nocard');
    await page.locator('input[type=email] >> visible=true').first().fill('nina.nocard@example.com');
    await page.locator('input[type=password] >> visible=true').first().fill('nocard-pass-1');
    await field('Company name').fill('Nocard Logistik');
    await page.locator('[role=checkbox] >> text=/I accept the terms/ >> visible=true').first().click();
    await start.click();
    // The company opens: the owner's fleet, with no card asked for.
    await button(page, 'Add vehicle').waitFor({ timeout: 90_000 });
    const u = await auth.getUserByEmail('nina.nocard@example.com');
    const orgs = await db.collection('orgs').where('createdBy', '==', u.uid).get();
    assert.equal(orgs.size, 1);
    const b = orgs.docs[0].data().billing;
    assert.equal(b.status, 'trialing');
    assert.equal(b.cardLater, true);
    assert.equal(b.card, false);
    assert.equal(b.plan, 'pro');
    assert.ok(Math.abs(b.trialEnd - (Date.now() + 21 * 86400_000)) < 3_700_000, 'the link\'s 21 free days');
    assert.equal((await db.doc(`offers/${CODE}`).get()).data().uses, 1);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await db.doc('platform/stripe').delete();
  }
});

test('dates and times: digits get their dots and colon, the calendar and the clock wheel fill in an appointment (A1, A2, A4–A6)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await signIn(page, OWNER2);
  // An earlier test leaves this owner in their other company.
  await openCompany(page, 'Online DSP');
  await page.goto(`${URL0}/vehicle/onlineVan1?tab=service`);
  await button(page, 'Book an appointment').click();
  const day = page.getByRole('textbox', { name: 'Day', exact: true });
  const time = page.getByRole('textbox', { name: 'Time', exact: true });
  // A1, A2: only digits typed.
  await day.pressSequentially('31032027');
  assert.equal(await day.inputValue(), '31.03.2027');
  await time.pressSequentially('0930');
  assert.equal(await time.inputValue(), '09:30');
  await day.fill('');
  await time.fill('');
  await time.pressSequentially('930');
  await day.click(); // leaving the time field writes it out in full
  assert.equal(await time.inputValue(), '09:30');

  // A4, A5: the calendar opens on this month, yesterday can't be picked; a day next month fills in the field.
  const n = new Date();
  const label = (d) => new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  await page.getByRole('button', { name: 'Pick a day: Day' }).click();
  await button(page, 'Today').waitFor({ timeout: 10_000 });
  assert.ok(await page.locator('text=Mon >> visible=true').count(), 'weeks start on Monday');
  if (n.getDate() > 1) {
    const y = page.getByRole('button', { name: label(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate() - 1)), exact: true });
    assert.equal(await y.getAttribute('aria-disabled'), 'true', 'yesterday can\'t be picked for an appointment');
  }
  await page.getByRole('button', { name: 'Next month' }).click();
  const pick = new Date(Date.UTC(n.getFullYear(), n.getMonth() + 1, 15));
  await page.getByRole('button', { name: label(pick), exact: true }).click();
  const iso = pick.toISOString().slice(0, 10);
  assert.equal(await day.inputValue(), iso.split('-').reverse().join('.'));

  // A6: the clock wheel, in steps of 5 minutes; Cancel leaves the time as it was, Done fills it in.
  await page.getByRole('button', { name: 'Pick a time: Time' }).click();
  await page.getByRole('button', { name: 'Hours 14' }).click();
  assert.equal(await page.getByRole('button', { name: 'Minutes 37' }).count(), 0, '5-minute steps');
  // The pop-up's Cancel (the form below has one too).
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  assert.equal(await time.inputValue(), '09:30');
  await page.getByRole('button', { name: 'Pick a time: Time' }).click();
  await page.getByRole('button', { name: 'Hours 14' }).click();
  await page.getByRole('button', { name: 'Minutes 45' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).last().click();
  assert.equal(await time.inputValue(), '14:45');

  await page.locator('[role=button] >> text="Tyres" >> visible=true').first().click();
  await button(page, 'Book').click();
  const a = await until(async () => {
    const q = await db.collection(`orgs/${ORG_A}/serviceAppointments`).where('vehicleId', '==', 'onlineVan1').get();
    return q.size ? q.docs[0].data() : null;
  }, 60_000, 'the appointment to reach the server');
  assert.equal(a.day, iso);
  assert.equal(a.time, '14:45');

  // A5: the day a service was done can't be in the future: the calendar doesn't go past this month.
  await button(page, 'Add service').click();
  await page.locator('[role=button] >> text="Tyres" >> visible=true').first().click();
  await page.getByRole('button', { name: 'Pick a day: Day it was done' }).click();
  assert.equal(await page.getByRole('button', { name: 'Next month' }).getAttribute('aria-disabled'), 'true');
  await button(page, 'Today').click();
  const doneDay = page.getByRole('textbox', { name: 'Day it was done', exact: true });
  assert.equal(await doneDay.inputValue(), new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  // Typed instead of picked, a future day is refused too (blind QA, PR #47, F02).
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  await doneDay.fill('');
  await doneDay.pressSequentially(tomorrow.replace(/\./g, ''));
  assert.equal(await doneDay.inputValue(), tomorrow);
  await page.getByRole('textbox', { name: 'Odometer (km)', exact: true }).fill('12000');
  await button(page, 'Save').click();
  await visible(page, 'The day can\'t be in the future.').waitFor({ timeout: 10_000 });
  assert.equal((await db.collection(`orgs/${ORG_A}/services`).where('vehicleId', '==', 'onlineVan1').get()).size, 0);
  await ctx.close();
});

/* ---------- Driver sign-up made simple (product owner, 2026-11-24; criteria A1–A8 in the pull request) ---------- */

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};
const DRIVER_LINK = 'e2eDriverLinkToken0000000000001';
async function driverLink() {
  await db.doc(`companyLinks/${DRIVER_LINK}`).set({ orgId: ORG, active: true, token: DRIVER_LINK, createdAt: Date.now(), createdBy: OWNER.uid, createdByName: OWNER.name });
}
/** Opens the driver link and sends a request as a new driver (one station, picked by itself). */
async function signUpDriver(page, who) {
  const field = (label) => page.locator(`xpath=//*[normalize-space(.)="${label}"]/following-sibling::input[1] >> visible=true`).first();
  await page.goto(`${URL0}/join/${DRIVER_LINK}`);
  await visible(page, 'Sign up as a driver at').waitFor({ timeout: 60_000 });
  await field('First name').fill(who.first);
  await field('Last name').fill(who.last);
  await page.locator('input[type=email] >> visible=true').first().fill(who.email);
  await page.locator('input[type=password] >> visible=true').first().fill(who.password);
  await button(page, 'Send request').click();
  await visible(page, 'Request sent').waitFor({ timeout: 60_000 });
}

test('A2, A3: the driver link asks only for station, name, email and password, with the email tip and the password advice', async () => {
  await driverLink();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', userAgent: UA.iphone });
  const page = await ctx.newPage();
  try {
    await page.goto(`${URL0}/join/${DRIVER_LINK}`);
    await visible(page, 'Sign up as a driver at').waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('text=/Mobile number|Transporter ID/i >> visible=true').count(), 0, 'no phone number or Transporter ID');
    await visible(page, 'Tip: use the same email as in your Amazon app.').waitFor({ timeout: 10_000 });
    await visible(page, 'Choose a safe password of your own, at least 6 characters.').waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('input >> visible=true').count(), 4, 'first name, last name, email, password');
  } finally { await ctx.close(); }
});

test('A1, A5, A6: after the request on an iPhone: the App Store, "Waiting for approval", and never "Create a company"', async () => {
  await driverLink();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', userAgent: UA.iphone, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    const who = { first: 'Ioana', last: 'Ștefănescu', email: 'ioana.e2e@example.com', password: 'driver-pass-1' };
    await signUpDriver(page, who);
    await visible(page, 'We sent a confirmation to ioana.e2e@example.com.').waitFor({ timeout: 10_000 });
    await visible(page, 'Get Fratius').waitFor({ timeout: 10_000 });
    const ios = button(page, 'iPhone: open the App Store');
    await ios.waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('text=/^Android:/ >> visible=true').count(), 0, 'an iPhone gets only the App Store');
    assert.equal(await page.locator('text=/Add to Home Screen/ >> visible=true').count(), 0, 'no home-screen web app steps');
    // The App Store button goes to Fratius' App Store page (stopped here, the test has no App Store).
    await page.route('https://apps.apple.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>App Store</title>' }));
    await ios.click();
    await page.waitForURL(/apps\.apple\.com\/app\/id\d+/, { timeout: 10_000 });
    // Back in the web app (as after installing the app and signing in): waiting, and no "Create a company".
    await page.goto(URL0 + '/');
    await visible(page, 'Waiting for approval').waitFor({ timeout: 60_000 });
    await visible(page, 'Open the driver link from your fleet manager, or paste it here.').waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('text=/Create a company|Create company/ >> visible=true').count(), 0, 'no Create a company while waiting');
    // Rejected: still no "Create a company", and /start doesn't offer it either.
    const u = await auth.getUserByEmail(who.email);
    assert.equal((await db.doc(`users/${u.uid}`).get()).data().signedUpAs, 'driver');
    await db.doc(`orgs/${ORG}/joinRequests/${u.uid}`).update({ status: 'rejected', decidedAt: Date.now() });
    await db.doc(`users/${u.uid}`).update({ pendingJoin: FieldValue.delete() });
    await page.reload();
    await visible(page, 'Your company').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('text=/Create a company|Create company/ >> visible=true').count(), 0, 'no Create a company after a rejection');
    await page.goto(URL0 + '/start');
    await visible(page, 'This account signed up as a driver.').waitFor({ timeout: 60_000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('A5: on an Android phone "Get Fratius" offers the Android app; on a computer both', async () => {
  await driverLink();
  for (const [kind, ua, mobile] of [['android', UA.android, true], ['desktop', UA.desktop, false]]) {
    const ctx = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1280, height: 900 }, locale: 'en-GB', userAgent: ua, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage();
    try {
      await signUpDriver(page, { first: 'Radu', last: kind, email: `radu.${kind}.e2e@example.com`, password: 'driver-pass-2' });
      await button(page, 'Android: download the app').waitFor({ timeout: 10_000 });
      assert.equal(await page.locator('[role=button] >> text="iPhone: open the App Store" >> visible=true').count(), kind === 'desktop' ? 1 : 0, kind);
    } finally { await ctx.close(); }
  }
});

test('A4: a driver who already has an account signs in on the link, and "Forgot your password?" sends the reset email', async () => {
  await driverLink();
  const email = 'ana.again.e2e@example.com';
  await auth.createUser({ email, password: 'old-pass-123', displayName: 'Ana Again' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', userAgent: UA.android });
  const page = await ctx.newPage();
  const field = (label) => page.locator(`xpath=//*[normalize-space(.)="${label}"]/following-sibling::input[1] >> visible=true`).first();
  try {
    await page.goto(`${URL0}/join/${DRIVER_LINK}`);
    await visible(page, 'Sign up as a driver at').waitFor({ timeout: 60_000 });
    await field('First name').fill('Ana');
    await field('Last name').fill('Again');
    // "New account" with an email that has one: told to sign in, switched to it, the email kept.
    await page.locator('input[type=email] >> visible=true').first().fill(email);
    await page.locator('input[type=password] >> visible=true').first().fill('whatever-123');
    await button(page, 'Send request').click();
    await visible(page, 'An account with this email already exists. Sign in instead.').waitFor({ timeout: 30_000 });
    const forgot = button(page, 'Forgot your password?');
    await forgot.waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('input[type=email] >> visible=true').first().inputValue(), email);
    await forgot.click();
    await visible(page, 'Check your inbox for a link to set a new password.').waitFor({ timeout: 30_000 });
    // The auth emulator keeps the reset email it would send.
    const codes = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/demo-fleet-check/oobCodes`)).json();
    assert.ok(codes.oobCodes.some((c) => c.email === email && c.requestType === 'PASSWORD_RESET'), 'a password reset email was sent');
    // With the right password the request goes through on this link.
    await page.locator('input[type=password] >> visible=true').first().fill('old-pass-123');
    await button(page, 'Send request').click();
    await visible(page, 'Request sent').waitFor({ timeout: 60_000 });
  } finally { await ctx.close(); }
});

// Round 1 of the blind tester (F01, F02, F04), each a test before the fix.
test('A4 (F01): "Forgot your password?" answers the same whether or not the email has an account', async () => {
  await driverLink();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  try {
    await page.goto(`${URL0}/join/${DRIVER_LINK}`);
    await visible(page, 'Sign up as a driver at').waitFor({ timeout: 60_000 });
    await visible(page, 'I have one').click();
    await page.locator('input[type=email] >> visible=true').first().fill('nobody.here.e2e@example.com');
    await button(page, 'Forgot your password?').click();
    await visible(page, 'Check your inbox for a link to set a new password.').waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('text=/Email or password is wrong/ >> visible=true').count(), 0);
  } finally { await ctx.close(); }
});

test('F02: changing the language on the driver link stays on the driver link', async () => {
  await driverLink();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  try {
    await page.goto(`${URL0}/join/${DRIVER_LINK}`);
    await visible(page, 'Sign up as a driver at').waitFor({ timeout: 60_000 });
    await page.locator('[role=button] >> text=/^Language: / >> visible=true').first().click();
    await page.locator('[role=radio] >> text="Română" >> visible=true').first().click();
    await visible(page, 'Înscrie-te ca șofer la').waitFor({ timeout: 60_000 }).catch(async (e) => {
      throw new Error(`${e.message}\nat ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 600)}`);
    });
    assert.match(page.url(), new RegExp(`/join/${DRIVER_LINK}$`));
    await button(page, 'Trimite cererea').waitFor({ timeout: 10_000 });
  } finally {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await ctx.close();
  }
});

test('F04: "Use another account" clears the message about the account before', async () => {
  await driverLink();
  const email = 'rita.rejected.e2e@example.com';
  const u = await auth.createUser({ email, password: 'rejected-pass-1', displayName: 'Rita Rejected' });
  await db.doc(`orgs/${ORG}/joinRequests/${u.uid}`).set({ uid: u.uid, email: '', name: 'Rita Rejected', firstName: 'Rita', lastName: 'Rejected', phone: '', transporterId: '', stationId: ST, stationName: 'Main station', link: DRIVER_LINK, createdAt: Date.now() - 3600_000, expiresAt: Date.now() + 86400_000, status: 'rejected', sameTransporterId: null, decidedBy: OWNER.uid, decidedByName: OWNER.name, decidedAt: Date.now() - 60_000 });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  try {
    await signIn(page, { email, password: 'rejected-pass-1' });
    await visible(page, 'Your company').waitFor({ timeout: 60_000 });
    await page.goto(`${URL0}/join/${DRIVER_LINK}`);
    await visible(page, 'Signed in as').waitFor({ timeout: 60_000 });
    const xpathField = (label) => page.locator(`xpath=//*[normalize-space(.)="${label}"]/following-sibling::input[1] >> visible=true`).first();
    await xpathField('First name').fill('Rita');
    await xpathField('Last name').fill('Rejected');
    await button(page, 'Send request').click();
    const msg = page.locator('text=/wasn.t approved/ >> visible=true');
    await msg.first().waitFor({ timeout: 30_000 });
    await button(page, 'Use another account').click();
    await page.locator('input[type=email] >> visible=true').first().waitFor({ timeout: 30_000 });
    assert.equal(await msg.count(), 0, 'the old account\'s message is gone');
  } finally { await ctx.close(); }
});


/* ---------- Cause 1 of the blind test (26 Nov 2026): the walk-around camera finishes safely ---------- */
// Criteria A1–A6 (pull request "Camera: nothing lost, saved once"). Each test failed on the app before the fix.
// The photos are taken through the real camera screen with Chrome's fake camera; the vans' plates say QUIET so
// the emulators' stand-in AI finds no damage in them.

const CAM_ORG = 'camOrg1', CAM_ST = 'camSt1';
const CAM_PICK = 'camVanPick', CAM_WALK = 'camVanWalk', CAM_DROP = 'camVanDrop';
const CAM1 = { email: 'cara.camera@example.com', password: 'camera-pass-1', name: 'Cara Camera' };
const CAM2 = { email: 'dirk.dropoff@example.com', password: 'camera-pass-2', name: 'Dirk Dropoff' };
let camReady = null;
function camWorld() {
  camReady ??= (async () => {
    const now = Date.now();
    const a = await auth.createUser({ email: CAM1.email, password: CAM1.password, displayName: CAM1.name });
    const c = await auth.createUser({ email: CAM2.email, password: CAM2.password, displayName: CAM2.name });
    CAM1.uid = a.uid; CAM2.uid = c.uid;
    const b = db.batch();
    b.set(db.doc(`orgs/${CAM_ORG}`), { name: 'Camera DSP', createdBy: OWNER.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
    b.set(db.doc(`orgs/${CAM_ORG}/members/${OWNER.uid}`), { role: 'owner', stationIds: [], email: OWNER.email, name: OWNER.name, joinedAt: now });
    b.set(db.doc(`orgs/${CAM_ORG}/stations/${CAM_ST}`), { name: 'Camera station', code: 'DCA1', createdAt: now, selfAssign: true, selfAssignBy: OWNER.name, selfAssignAt: now });
    for (const p of [CAM1, CAM2]) {
      b.set(db.doc(`orgs/${CAM_ORG}/members/${p.uid}`), { role: 'driver', stationIds: [CAM_ST], email: p.email, name: p.name, joinedAt: now });
      b.set(db.doc(`users/${p.uid}`), { orgIds: [CAM_ORG], orgId: CAM_ORG, email: p.email, name: p.name });
    }
    const van = (plate) => ({ name: '', plate, cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', stationId: CAM_ST, createdAt: now, createdBy: OWNER.uid, scanId: null });
    b.set(db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_PICK}`), van('QUIET 1'));
    b.set(db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_WALK}`), van('QUIET 2'));
    // Dirk has QUIET 3 (given by the owner an hour ago): he drops it off.
    b.set(db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_DROP}`), { ...van('QUIET 3'), assignedTo: { assignmentId: 'camA1', driverId: c.uid, since: now - 3600_000, kmStart: null, kmEnd: null } });
    b.set(db.doc(`orgs/${CAM_ORG}/assignments/camA1`), {
      vehicleId: CAM_DROP, vehicleName: 'QUIET 3', plate: 'QUIET 3', driverId: c.uid, driverName: CAM2.name, stationId: CAM_ST, start: now - 3600_000, end: null,
      startedBy: OWNER.uid, startedByName: OWNER.name, endedBy: null, endedByName: null, endReason: null, createdAt: now - 3600_000,
    });
    await b.commit();
  })();
  return camReady;
}
async function camPage(who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await signIn(page, who);
  await visible(page, 'Camera DSP').waitFor({ timeout: 60_000 }).catch(() => {});
  return { ctx, page, errors };
}
/** On the camera screen: the frame shown and how many there are ("QUIET 1, frame 3 of 12"). */
async function frameNow(page) {
  const t = await until(async () => {
    const allow = page.locator('[role=button] >> text="Allow camera" >> visible=true');
    if (await allow.count()) await allow.first().click();
    const x = await page.locator('text=/frame \\d+ of \\d+/ >> visible=true').first().textContent({ timeout: 1000 });
    return x || null;
  }, 60_000, 'the camera screen');
  const m = /frame (\d+) of (\d+)/.exec(t);
  return { n: Number(m[1]), total: Number(m[2]) };
}
/** Takes and uses photos until `count` are taken (or all, then the summary shows). */
async function takePhotos(page, count = Infinity) {
  for (let k = 0; k < count; k++) {
    if (await page.locator('text=/photos? aren.t sent yet|Tap a photo to retake it|All \\d+ photos are needed/ >> visible=true').count()) return;
    if (!(await page.locator('text=/frame \\d+ of \\d+/ >> visible=true').count())) {
      // The summary (all taken) or the next frame on its way.
      await page.waitForTimeout(300);
      if (!(await page.locator('text=/frame \\d+ of \\d+/ >> visible=true').count())) return;
    }
    const { n } = await frameNow(page);
    const shutter = page.getByRole('button', { name: `Take photo ${n}`, exact: true });
    await until(async () => (await shutter.isEnabled()) || null, 60_000, 'the camera to be ready');
    await shutter.click();
    const use = page.locator('[role=button] >> text=/^(Use photo|Use anyway)$/ >> visible=true').first();
    await use.waitFor({ timeout: 30_000 });
    await use.click();
    await until(async () => (await page.locator('text=/^(Use photo|Use anyway)$/ >> visible=true').count()) === 0 || null, 10_000, 'the photo to be used');
  }
}
/** On "Pick up a van": types the plate, finds the van and opens the camera (drivers see only their own van: cause 3a). */
async function pickByPlate(page, plate) {
  await page.getByPlaceholder('B-DS 104').first().fill(plate);
  await button(page, 'Find the van').click();
  await button(page, 'Take the photos to pick it up').click();
}
const walksOf = async (vehicleId, uid) => (await db.collection(`orgs/${CAM_ORG}/walkarounds`).where('vehicleId', '==', vehicleId).where('createdBy', '==', uid).get()).docs;

test('A1: leaving the camera with photos that aren\'t sent asks first (Close, Discard); the browser\'s back keeps them; throwing away is the driver\'s choice', async () => {
  await camWorld();
  const { ctx, page, errors } = await camPage(CAM1);
  try {
    await page.goto(`${URL0}/pickup`);
    await pickByPlate(page, 'QUIET 1');
    const { total } = await frameNow(page);
    await takePhotos(page);
    await visible(page, `${total}/${total}`).waitFor({ timeout: 30_000 });
    // The top button asks; "Back to the photos" keeps everything.
    await button(page, 'Close').click();
    await visible(page, `${total} photos aren't sent yet.`).waitFor({ timeout: 10_000 });
    await button(page, 'Pick up QUIET 1').waitFor({ timeout: 5000 });
    await button(page, 'Back to the photos').click();
    await visible(page, `${total}/${total}`).waitFor({ timeout: 5000 });
    // Discard asks too.
    await button(page, 'Discard').click();
    await visible(page, `${total} photos aren't sent yet.`).waitFor({ timeout: 10_000 });
    await button(page, 'Back to the photos').click();
    // The browser's own back button can't be held on the web: it leaves, but every photo is kept, and the camera
    // continues with them (the phone apps ask, like Close).
    await page.goBack();
    await page.waitForURL(/\/pickup/, { timeout: 30_000 });
    await page.goto(`${URL0}/pickup`);
    await pickByPlate(page, 'QUIET 1');
    await visible(page, `Continued where you stopped: ${total} photos kept.`).waitFor({ timeout: 30_000 });
    await visible(page, `${total}/${total}`).waitFor({ timeout: 10_000 });
    await button(page, 'Close').click();
    await visible(page, `${total} photos aren't sent yet.`).waitFor({ timeout: 10_000 });
    await button(page, `Throw away ${total} photos`).click();
    await page.waitForURL(/\/pickup/, { timeout: 30_000 });
    // Nothing was sent, and the van is still free.
    assert.equal((await walksOf(CAM_PICK, CAM1.uid)).length, 0);
    assert.equal((await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_PICK}`).get()).data().assignedTo ?? null, null);
    // Thrown away means gone: the camera starts again at frame 1 (here opened by its link, with the plate).
    await page.goto(`${URL0}/scan/${CAM_PICK}?handover=pickup&plate=QUIET%201`);
    assert.equal((await frameNow(page)).n, 1);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('A2: a reload part-way through keeps the photos already taken and goes on where it stopped', async () => {
  await camWorld();
  // Dirk's own van (drivers walk around only the van they have: cause 3a).
  const CAM_WALK = CAM_DROP;
  const { ctx, page } = await camPage(CAM2);
  try {
    await page.goto(`${URL0}/scan/${CAM_WALK}`);
    await frameNow(page);
    await takePhotos(page, 3);
    assert.equal((await frameNow(page)).n, 4);
    await page.waitForTimeout(1500); // the last photo is kept on the phone right after "Use photo"
    await page.reload();
    const f = await frameNow(page);
    assert.equal(f.n, 4, 'goes on at frame 4');
    await visible(page, 'Continued where you stopped: 3 photos kept.').waitFor({ timeout: 10_000 });
    // And again after closing the browser tab and opening the camera from the van page.
    const p2 = await ctx.newPage();
    await page.close();
    await p2.goto(`${URL0}/scan/${CAM_WALK}`);
    assert.equal((await frameNow(p2)).n, 4);
    // The note goes once the next photo is taken (blind tester: it stayed until the end).
    await takePhotos(p2, 1);
    assert.equal(await p2.locator('text=Continued where you stopped >> visible=true').count(), 0);
    // Thrown away: the next walk-around starts from scratch.
    await button(p2, 'Close').click();
    await button(p2, 'Throw away 4 photos').click();
    await p2.goto(`${URL0}/scan/${CAM_WALK}`);
    assert.equal((await frameNow(p2)).n, 1);
  } finally { await ctx.close(); }
});

/**
 * Guard test for cause 1: a walk-around, a pick-up and a drop-off, each on a camera page opened by its link (nothing
 * to go back to) and its button pressed twice: one walk-around, the handover done once, and the page moves on.
 */
test('A3, A4 (guard): walk-around, pick-up and drop-off from a link, pressed twice: saved once and the screen moves on', async () => {
  await camWorld();
  // Cara picks up QUIET 1 (by its link, with the plate as the plate page sends it), then walks around it, her van now.
  for (const [who, van, kind, label, url] of [
    [CAM1, CAM_PICK, 'pickup', /^Pick up QUIET 1$/, `/scan/${CAM_PICK}?handover=pickup&plate=QUIET%201`],
    [CAM1, CAM_PICK, 'walkaround', /^Save \d+ photos$/, `/scan/${CAM_PICK}`],
    [CAM2, CAM_DROP, 'dropoff', /^Drop off QUIET 3$/, `/scan/${CAM_DROP}?handover=dropoff`],
  ]) {
    const { ctx, page, errors } = await camPage(who);
    try {
      const before = (await walksOf(van, who.uid)).length;
      await page.goto(URL0 + url);
      await frameNow(page);
      await takePhotos(page);
      const send = page.locator(`[role=button] >> text=${label} >> visible=true`).first();
      await send.waitFor({ timeout: 30_000 });
      await send.dblclick();
      // The page moves on: the walk-around's page, the Vans tab after a pick-up by the plate, or the van's.
      await page.waitForURL(kind === 'walkaround' ? /\/walk\// : kind === 'pickup' ? (u) => u.pathname === '/' : new RegExp(`/vehicle/${van}`), { timeout: 120_000 });
      await until(async () => (await walksOf(van, who.uid)).length > before || null, 120_000, `the ${kind} to arrive`);
      await page.waitForTimeout(5000); // a second copy would have arrived by now
      const walks = await walksOf(van, who.uid);
      assert.equal(walks.length, before + 1, `${kind}: one walk-around`);
      const v = (await db.doc(`orgs/${CAM_ORG}/vehicles/${van}`).get()).data();
      if (kind === 'pickup') {
        await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${van}`).get()).data().assignedTo?.driverId === who.uid || null, 60_000, 'the pick-up');
        const open = await db.collection(`orgs/${CAM_ORG}/assignments`).where('driverId', '==', who.uid).where('end', '==', null).get();
        assert.equal(open.size, 1, 'one pick-up');
      }
      if (kind === 'dropoff') {
        await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${van}`).get()).data().assignedTo == null || null, 60_000, 'the drop-off');
        assert.equal((await db.doc(`orgs/${CAM_ORG}/assignments/camA1`).get()).data().endReason, 'dropped off');
      }
      if (kind === 'walkaround') assert.equal(v.assignedTo?.driverId, who.uid, 'a walk-around doesn\'t change who has the van');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

// Blind tester, round 1 on this pull request (F01): a drop-off camera for a van the driver doesn't have opened, took
// 12 photos, and only then refused, leaving a stopped upload. It says so before any photo now.
test('F01: a drop-off of a van the driver doesn\'t have, or a pick-up while holding a van, says so before any photo', async () => {
  await camWorld();
  // After the guard test: Dirk dropped off QUIET 3 and has no van; Cara has QUIET 1.
  const d = await camPage(CAM2);
  try {
    await d.page.goto(`${URL0}/scan/${CAM_DROP}?handover=dropoff`);
    await visible(d.page, 'You don\'t have this van.').waitFor({ timeout: 60_000 });
    assert.equal(await d.page.getByRole('button', { name: 'Take photo 1', exact: true }).count(), 0, 'no camera');
  } finally { await d.ctx.close(); }
  const c = await camPage(CAM1);
  try {
    await c.page.goto(`${URL0}/scan/${CAM_PICK}?handover=pickup`);
    await visible(c.page, 'You have QUIET 1.').waitFor({ timeout: 60_000 });
    assert.equal(await c.page.getByRole('button', { name: 'Take photo 1', exact: true }).count(), 0, 'no camera');
    await c.page.goto(`${URL0}/scan/${CAM_WALK}?handover=pickup`);
    await visible(c.page, 'You have QUIET 1. Drop it off first').waitFor({ timeout: 60_000 });
    assert.equal(await c.page.getByRole('button', { name: 'Take photo 1', exact: true }).count(), 0, 'no camera');
    // A plain walk-around: of another van of the station it says so (cause 3a); of her own van the camera opens.
    await c.page.goto(`${URL0}/scan/${CAM_WALK}`);
    await visible(c.page, 'You don\'t have this van.').waitFor({ timeout: 60_000 });
    assert.equal(await c.page.getByRole('button', { name: 'Take photo 1', exact: true }).count(), 0, 'no camera');
    await c.page.goto(`${URL0}/scan/${CAM_PICK}`);
    assert.equal((await frameNow(c.page)).n, 1);
  } finally { await c.ctx.close(); }
});

test('A5: offline, a drop-off waits on the phone and goes through once when the connection is back', async () => {
  await camWorld();
  // Cara has QUIET 1 since the pick-up test above.
  await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_PICK}`).get()).data().assignedTo?.driverId === CAM1.uid || null, 30_000, 'Cara to have QUIET 1');
  const { ctx, page } = await camPage(CAM1);
  try {
    const before = (await walksOf(CAM_PICK, CAM1.uid)).length;
    await page.goto(`${URL0}/scan/${CAM_PICK}?handover=dropoff`);
    await frameNow(page);
    await takePhotos(page);
    await ctx.setOffline(true);
    await button(page, 'Drop off QUIET 1').click();
    await visible(page, 'The photos are saved on this phone.').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    assert.equal((await walksOf(CAM_PICK, CAM1.uid)).length, before, 'nothing reached the server offline');
    await ctx.setOffline(false);
    await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_PICK}`).get()).data().assignedTo == null || null, 180_000, 'the drop-off after the connection is back');
    await page.waitForTimeout(5000);
    assert.equal((await walksOf(CAM_PICK, CAM1.uid)).length, before + 1, 'one walk-around');
  } finally { await ctx.close(); }
});

// ---------- Blind test, 26 Nov 2026, cause 3a: drivers see only their own van and pick one up by its plate ----------
// After the tests above: QUIET 1, 2 and 3 are free; neither Cara nor Dirk has a van.
const camGive = async (vanId, plate, assignmentId, driverId, name) => {
  const now = Date.now();
  await db.doc(`orgs/${CAM_ORG}/assignments/${assignmentId}`).set({ vehicleId: vanId, vehicleName: plate, plate, driverId, driverName: name, stationId: CAM_ST, start: now, end: null,
    startedBy: OWNER.uid, startedByName: OWNER.name, endedBy: null, endedByName: null, endReason: null, createdAt: now });
  await db.doc(`orgs/${CAM_ORG}/vehicles/${vanId}`).update({ assignedTo: { assignmentId, driverId, since: now, kmStart: null, kmEnd: null } });
};

test('cause 3a (1a, 1b, 1d): a driver sees only the van they have, picks one up by its plate, and another driver\'s only after "Take it over"', async () => {
  await camWorld();
  await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_PICK}`).get()).data().assignedTo == null || null, 60_000, 'QUIET 1 to be free');
  await camGive(CAM_WALK, 'QUIET 2', 'camA2', CAM2.uid, CAM2.name);
  const { ctx, page, errors } = await camPage(CAM1);
  try {
    // The Vans tab: none of the station's vans, and the way to pick one up.
    await page.goto(`${URL0}/`);
    await button(page, 'Pick up a van').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    for (const p of ['QUIET 1', 'QUIET 2', 'QUIET 3']) assert.equal(await visible(page, p).count(), 0, `${p} isn't listed`);
    // A plate that isn't the company's: said so.
    await button(page, 'Pick up a van').click();
    await page.getByPlaceholder('B-DS 104').first().fill('QUIET 9');
    await button(page, 'Find the van').click();
    await visible(page, 'No van with the plate QUIET 9. Check the plate, or ask your fleet manager.').waitFor({ timeout: 60_000 });
    // Dirk's van: asked first, and no camera until "Take it over".
    await page.getByPlaceholder('B-DS 104').first().fill('quiet 2');
    await button(page, 'Find the van').click();
    await visible(page, 'Another driver has this van now. Take it over?').waitFor({ timeout: 60_000 });
    assert.equal(await button(page, 'Take the photos to pick it up').count(), 0, 'no camera before "Take it over"');
    await button(page, 'Take it over').click();
    await button(page, 'Take the photos to pick it up').click();
    await frameNow(page);
    await takePhotos(page);
    await button(page, 'Pick up QUIET 2').click();
    // To the Vans tab, which shows her van once the server has it.
    await page.waitForURL((u) => u.pathname === '/', { timeout: 120_000 });
    await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_WALK}`).get()).data().assignedTo?.driverId === CAM1.uid || null, 180_000, 'the take-over');
    const prev = (await db.doc(`orgs/${CAM_ORG}/assignments/camA2`).get()).data();
    assert.deepEqual([prev.endReason, prev.endedBy], ['taken over', CAM1.uid]);
    await visible(page, 'QUIET 2').waitFor({ timeout: 60_000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('cause 3a (1d): a van that got another driver after the photos were taken stops with "Take it over?"; taken over from the upload, it goes through', async () => {
  await camWorld();
  const { ctx, page, errors } = await camPage(CAM2);
  try {
    await page.goto(`${URL0}/pickup`);
    await page.getByPlaceholder('B-DS 104').first().fill('QUIET 3');
    await button(page, 'Find the van').click();
    await button(page, 'Take the photos to pick it up').click();
    await frameNow(page);
    await takePhotos(page);
    // Meanwhile the fleet manager gives QUIET 3 to someone else.
    await camGive(CAM_DROP, 'QUIET 3', 'camA3', 'camSomeoneElse', 'Sam Someone');
    await button(page, 'Pick up QUIET 3').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 120_000 });
    // Nothing happens to the other driver's handover until Dirk says so.
    await page.locator('text=/upload stopped/ >> visible=true').first().click({ timeout: 180_000 });
    await visible(page, 'Another driver has this van now. Take it over?').waitFor({ timeout: 30_000 });
    assert.equal((await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_DROP}`).get()).data().assignedTo.driverId, 'camSomeoneElse');
    await button(page, 'Take it over').click();
    await until(async () => (await db.doc(`orgs/${CAM_ORG}/vehicles/${CAM_DROP}`).get()).data().assignedTo?.driverId === CAM2.uid || null, 180_000, 'the take-over');
    assert.equal((await db.doc(`orgs/${CAM_ORG}/assignments/camA3`).get()).data().endReason, 'taken over');
    const open = await db.collection(`orgs/${CAM_ORG}/assignments`).where('driverId', '==', CAM2.uid).where('end', '==', null).get();
    assert.equal(open.size, 1, 'one pick-up');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ---------- Blind test, 26 Nov 2026, cause 2: what each role sees (the server refuses the rest: tests/history.test.mjs) ----------
// A company of its own: a fleet manager, Ada (has van RW 1) and Ben (no van) at one station; Ada's walk-around, her
// damage check still waiting for close-ups, and a check whose review is finished.
const RW_ORG = 'rwOrg1', RW_ST = 'rwSt1', RW_V1 = 'rwVan1', RW_V2 = 'rwVan2', RW_W1 = 'rwWalk1', RW_K1 = 'rwCheck1', RW_K2 = 'rwCheck2';
const RW_MGR = { email: 'rita.rules@example.com', password: 'rules-pass-1', name: 'Rita Manager' };
const RW_ADA = { email: 'ada.rules@example.com', password: 'rules-pass-2', name: 'Ada Driver' };
const RW_BEN = { email: 'ben.rules@example.com', password: 'rules-pass-3', name: 'Ben Driver' };
let rwReady = null;
function rwWorld() {
  rwReady ??= (async () => {
    const now = Date.now();
    for (const p of [RW_MGR, RW_ADA, RW_BEN]) p.uid = (await auth.createUser({ email: p.email, password: p.password, displayName: p.name })).uid;
    const b = db.batch();
    b.set(db.doc(`orgs/${RW_ORG}`), { name: 'Rules DSP', createdBy: OWNER.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
    b.set(db.doc(`orgs/${RW_ORG}/members/${OWNER.uid}`), { role: 'owner', stationIds: [], email: OWNER.email, name: OWNER.name, joinedAt: now });
    b.set(db.doc(`orgs/${RW_ORG}/stations/${RW_ST}`), { name: 'Rules station', code: 'DRW1', createdAt: now });
    for (const [p, role] of [[RW_MGR, 'manager'], [RW_ADA, 'driver'], [RW_BEN, 'driver']]) {
      b.set(db.doc(`orgs/${RW_ORG}/members/${p.uid}`), { role, stationIds: [RW_ST], email: p.email, name: p.name, joinedAt: now });
      b.set(db.doc(`users/${p.uid}`), { orgIds: [RW_ORG], orgId: RW_ORG, email: p.email, name: p.name });
    }
    b.set(db.doc(`orgs/${RW_ORG}/names/${RW_MGR.uid}`), { name: RW_MGR.name, at: now });
    const van = (plate) => ({ name: '', plate, cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', fuel: 'diesel', stationId: RW_ST, createdAt: now, createdBy: OWNER.uid, scanId: null });
    b.set(db.doc(`orgs/${RW_ORG}/vehicles/${RW_V1}`), { ...van('RW 1'), assignedTo: { assignmentId: 'rwA1', driverId: RW_ADA.uid, since: now - 3600_000, kmStart: null, kmEnd: null } });
    b.set(db.doc(`orgs/${RW_ORG}/vehicles/${RW_V2}`), van('RW 2'));
    b.set(db.doc(`orgs/${RW_ORG}/assignments/rwA1`), {
      vehicleId: RW_V1, vehicleName: 'RW 1', plate: 'RW 1', driverId: RW_ADA.uid, driverName: RW_ADA.name, stationId: RW_ST, start: now - 3600_000, end: null,
      startedBy: RW_MGR.uid, startedByName: RW_MGR.name, endedBy: null, endedByName: null, endReason: null, createdAt: now - 3600_000,
    });
    b.set(db.doc(`orgs/${RW_ORG}/walkarounds/${RW_W1}`), { vehicleId: RW_V1, vehicleName: 'RW 1', cls: 'large_van', stationId: RW_ST, source: 'camera', createdAt: now - 600_000,
      createdBy: RW_ADA.uid, totalMs: null, frames: 1, taken: 1, skipped: 0, retakes: 0, photos: [{ n: 1, label: 'Front', w: 900, h: 1200, takenAt: now - 600_000 }] });
    const spot = { photo: 0, photoLabel: 'Front', box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, conf: 0.8, mightBe: null,
      closeup: '', refPath: null, closeups: [], verdict: null, feedback: null, markPath: null };
    const check = { vehicleId: RW_V1, vehicleName: 'RW 1', cls: 'large_van', walkId: RW_W1, createdBy: RW_ADA.uid, walkBy: RW_ADA.uid, stationId: RW_ST,
      tier: 'quick', model: 'test', photos: 1, spots: [spot], notVisible: [], missedNote: '' };
    b.set(db.doc(`orgs/${RW_ORG}/checks/${RW_K1}`), { ...check, createdAt: now - 500_000, status: 'checking', submittedAt: null, review: null });
    b.set(db.doc(`orgs/${RW_ORG}/checks/${RW_K2}`), { ...check, createdAt: now - 400_000, status: 'reviewed', submittedAt: now - 300_000, reviewedAt: now - 200_000,
      review: { decisions: { 0: { damage: true, note: '', by: RW_MGR.uid, byName: RW_MGR.name, at: now - 200_000, known: null } }, manual: [], by: RW_MGR.uid, byName: RW_MGR.name, at: now - 200_000 } });
    await b.commit();
  })();
  return rwReady;
}
async function rwPage(who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await signIn(page, who);
  await visible(page, 'Rules DSP').waitFor({ timeout: 60_000 }).catch(() => {});
  return { ctx, page, errors };
}

// Since cause 3a (drivers see only their own van, its walk-arounds and checks) Ben no longer sees Ada's at all: the
// links show nothing of them, and still start nothing (qa/FEATURES.md 5.27 is superseded by 5.31).
test('cause 2 (A1), 3a (1a): another driver gets nothing of a damage check of someone else\'s photos, also by link', async () => {
  await rwWorld();
  const ben = await rwPage(RW_BEN);
  try {
    // Ada's walk-around: not available to Ben, so no "Check for damage" either.
    await ben.page.goto(`${URL0}/walk/${RW_W1}`);
    await visible(ben.page, 'This walk-around isn\'t available.').waitFor({ timeout: 60_000 });
    for (const label of ['Check for damage', 'Check for damage again']) assert.equal(await button(ben.page, label).count(), 0, `no ${label}`);
    // The check's own link starts nothing.
    await ben.page.goto(`${URL0}/check/new?walk=${RW_W1}`);
    await visible(ben.page, 'Only the driver who took these photos, or a fleet manager, can do this.').waitFor({ timeout: 60_000 });
    // Ada's check: not available, without close-ups or sending.
    await ben.page.goto(`${URL0}/check/${RW_K1}`);
    await visible(ben.page, 'This check isn\'t available.').waitFor({ timeout: 60_000 });
    assert.equal(await button(ben.page, 'Take close-ups of 1 spot').count(), 0, 'no close-ups');
    assert.equal(await button(ben.page, 'Send to the fleet manager').count(), 0, 'no sending');
    assert.equal((await db.doc(`orgs/${RW_ORG}/checks/${RW_K1}`).get()).data().status, 'checking');
    assert.deepEqual(ben.errors, []);
  } finally { await ben.ctx.close(); }
  // Ada has both.
  const ada = await rwPage(RW_ADA);
  try {
    await ada.page.goto(`${URL0}/check/${RW_K1}`);
    await button(ada.page, 'Take close-ups of 1 spot').waitFor({ timeout: 60_000 });
    await button(ada.page, 'Send to the fleet manager').waitFor({ timeout: 10_000 });
    await ada.page.goto(`${URL0}/walk/${RW_W1}`);
    await button(ada.page, 'Check for damage again').waitFor({ timeout: 60_000 });
  } finally { await ada.ctx.close(); }
});

test('cause 2 (A3): after "Finish review" nothing can change until "Change the review", which is recorded with who and when', async () => {
  await rwWorld();
  const { ctx, page, errors } = await rwPage(RW_MGR);
  try {
    await page.goto(`${URL0}/check/${RW_K2}`);
    await button(page, 'Change the review').waitFor({ timeout: 60_000 });
    for (const label of ['Damage', 'Not damage', 'Add damage the AI missed', 'Finish review']) assert.equal(await button(page, label).count(), 0, `no ${label}`);
    await button(page, 'Change the review').click();
    await visible(page, 'Review reopened by Rita Manager').waitFor({ timeout: 30_000 });
    await button(page, 'Not damage').waitFor({ timeout: 10_000 });
    // The screen shows the change at once; the server has it a moment later.
    const k = await until(async () => { const d = (await db.doc(`orgs/${RW_ORG}/checks/${RW_K2}`).get()).data(); return d.status === 'submitted' ? d : null; }, 30_000, 'the reopening on the server');
    assert.equal(k.reopens.length, 1);
    assert.equal(k.reopens[0].by, RW_MGR.uid);
    assert.ok(Math.abs(k.reopens[0].at - Date.now()) < 120_000);
    // Finished again: locked again, the reopening still shown.
    await button(page, 'Finish review').click();
    await button(page, 'Change the review').waitFor({ timeout: 30_000 });
    assert.equal(await button(page, 'Not damage').count(), 0);
    await visible(page, 'Review reopened by Rita Manager').waitFor({ timeout: 10_000 });
    await until(async () => (await db.doc(`orgs/${RW_ORG}/checks/${RW_K2}`).get()).data().status === 'reviewed' || null, 30_000, 'the review finished again on the server');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('cause 2 (A4): drivers without a van see no Refuel or Wash, and Add vehicle by its link is not available to drivers', async () => {
  await rwWorld();
  const ben = await rwPage(RW_BEN);
  try {
    await ben.page.goto(`${URL0}/vehicle/${RW_V2}`);
    await visible(ben.page, 'RW 2').waitFor({ timeout: 60_000 });
    await ben.page.waitForTimeout(1500);
    assert.equal(await button(ben.page, 'Refuel').count(), 0, 'no Refuel');
    assert.equal(await button(ben.page, 'Wash').count(), 0, 'no Wash');
    // The refuel page by its link says why.
    await ben.page.goto(`${URL0}/buy/new?van=${RW_V2}&kind=fuel`);
    await visible(ben.page, 'You don\'t have a van.').waitFor({ timeout: 60_000 });
    for (const path of ['/add', '/bulk']) {
      await ben.page.goto(URL0 + path);
      await visible(ben.page, 'Not available for drivers').waitFor({ timeout: 60_000 });
    }
    assert.deepEqual(ben.errors, []);
  } finally { await ben.ctx.close(); }
  // Ada has a van: she sees both.
  const ada = await rwPage(RW_ADA);
  try {
    await ada.page.goto(`${URL0}/vehicle/${RW_V1}`);
    await button(ada.page, 'Refuel').waitFor({ timeout: 60_000 });
    await button(ada.page, 'Wash').waitFor({ timeout: 10_000 });
  } finally { await ada.ctx.close(); }
});

// ---------- Blind test, 26 Nov 2026, cause 2b (B1, B2): the driver link on People ----------
test('cause 2b (B1, B2): a fleet manager sees the driver link with Share and Make a new link; a new one is asked first and replaces the old', async () => {
  await rwWorld();
  // Made with the company (the trigger), without anyone asking for it.
  const first = await until(async () => (await db.doc(`orgs/${RW_ORG}/links/drivers`).get()).data() || null, 60_000, 'the driver link of the company');
  const { ctx, page, errors } = await rwPage(RW_MGR);
  try {
    await page.goto(`${URL0}/people`);
    await visible(page, 'Driver sign-up link').waitFor({ timeout: 60_000 });
    await visible(page, first.token).waitFor({ timeout: 30_000 });
    await button(page, 'Share').waitFor({ timeout: 10_000 });
    assert.equal(await button(page, 'Make the driver link').count(), 0);
    await button(page, 'Make a new link').click();
    await visible(page, 'The old link stops working at once, for every station.').waitFor({ timeout: 10_000 });
    // Cancel changes nothing.
    await button(page, 'Cancel').click();
    assert.equal((await db.doc(`orgs/${RW_ORG}/links/drivers`).get()).data().token, first.token);
    await button(page, 'Make a new link').click();
    await visible(page, 'The old link stops working at once, for every station.').waitFor({ timeout: 10_000 });
    await button(page, 'Make a new link').click();
    const next = await until(async () => { const l = (await db.doc(`orgs/${RW_ORG}/links/drivers`).get()).data(); return l?.token !== first.token ? l : null; }, 30_000, 'the new link');
    await visible(page, next.token).waitFor({ timeout: 30_000 });
    await visible(page, 'Made by Rita Manager').waitFor({ timeout: 10_000 });
    assert.equal((await db.doc(`companyLinks/${first.token}`).get()).data().active, false);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// Blind tester, round 2 on #54 (F01): the manager saw no flag of a km typed lower than the van's. It's in Review.
test('cause 2b (B4, F01): a km typed lower than the van\'s shows in the manager\'s Review with both numbers', async () => {
  await rwWorld();
  await db.doc(`orgs/${RW_ORG}/vehicles/${RW_V1}`).update({ kmLower: { typed: 48200, kept: 50000, at: Date.now(), by: RW_ADA.uid } });
  const { ctx, page, errors } = await rwPage(RW_MGR);
  try {
    await page.goto(`${URL0}/review`);
    await visible(page, 'typed 48,200 km; the van had 50,000 km and keeps them.').waitFor({ timeout: 60_000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
  await db.doc(`orgs/${RW_ORG}/vehicles/${RW_V1}`).update({ kmLower: FieldValue.delete() });
});
