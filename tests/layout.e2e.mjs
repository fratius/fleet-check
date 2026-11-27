// Blind test, 26 Nov 2026, cause 4: the layout in every language, at phone width, in a real browser against the
// emulators (Test workflow, job "Layout in every language").
//   - Arabic and Persian: after signing in, the whole app is on screen and every button works (it was drawn 10,000 px
//     off the screen, and nothing could be tapped, not even the language switch).
//   - The guard: Fleet, a van, Review, People, Data, Account and the camera in all 32 languages: the app is on the
//     screen, nothing runs off its edge, the app's own texts aren't cut or tiny, and no English is left on a
//     translated screen (tests/layoutcheck.mjs says what counts).
//   - Long names (no spaces, an emoji) don't run off a card; a name over 40 characters is refused with a message.
// Run: emulators:exec --only auth,firestore,functions,storage "npm --prefix tests run layout" (APP_DIR = the web build).
import assert from 'node:assert/strict';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { chromium } from 'playwright';

import { layoutProblems } from './layoutcheck.mjs';

const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getAuth } = fnRequire('firebase-admin/auth');
const { FieldValue, getFirestore } = fnRequire('firebase-admin/firestore');

const APP_DIR = process.env.APP_DIR || new URL('../dist-e2e', import.meta.url).pathname;
const PORT = 8098;
const URL0 = `http://127.0.0.1:${PORT}`;
const app = initializeApp({ projectId: 'demo-fleet-check' }, 'layout-e2e');
const db = getFirestore(app);
const auth = getAuth(app);
const I18N = new URL('../public/i18n/', import.meta.url).pathname;
// English and the 31 translations.
const ALL = ['en', ...readdirSync(I18N).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2)).sort()];
// LAYOUT_LANGS=de,ar: only those, to look into a problem on this computer (CI always checks all of them).
const CODES = process.env.LAYOUT_LANGS ? process.env.LAYOUT_LANGS.split(',') : ALL;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, URL0).pathname);
  let f = join(APP_DIR, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(APP_DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': p === '/sw.js' ? 'no-cache' : 'no-store' });
  createReadStream(f).pipe(res);
});

// A company with what the main screens show: a van with a driver whose name has no spaces, a free van, a damage check
// waiting for review by that driver, a driver whose name starts with an emoji, and a change of this phone that stopped.
const ORG = 'layoutOrg1', ST = 'layoutSt1', VAN = 'layoutVan1', VAN2 = 'layoutVan2', CHECK = 'layoutCheck1';
const OWNER = { email: 'lena.layout@example.com', password: 'layout-pass-1', name: 'Lena Owner' };
const LONG = { email: 'long.layout@example.com', password: 'layout-pass-2', name: 'Maximilianalexanderwilhelmfriedrich Schwarzenbergerhausen' };
const EMOJI = { email: 'emoji.layout@example.com', password: 'layout-pass-3', name: '😀 Emma Stone' };
// An owner of their own for the right-to-left test: it switches the language, which follows the person (their profile).
const RTL = { email: 'rami.layout@example.com', password: 'layout-pass-4', name: 'Rami Owner' };
let browser;

before(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const now = Date.now();
  for (const p of [OWNER, LONG, EMOJI, RTL]) p.uid = (await auth.createUser({ email: p.email, password: p.password, displayName: p.name })).uid;
  const b = db.batch();
  b.set(db.doc(`orgs/${ORG}`), { name: 'Layout DSP', createdBy: OWNER.uid, createdAt: now, stationsReady: true, aiTier: 'quick' });
  b.set(db.doc(`orgs/${ORG}/stations/${ST}`), { name: 'Layout station', code: 'DLY1', createdAt: now });
  for (const [p, role] of [[OWNER, 'owner'], [LONG, 'driver'], [EMOJI, 'driver'], [RTL, 'owner']]) {
    b.set(db.doc(`orgs/${ORG}/members/${p.uid}`), { role, stationIds: role === 'owner' ? [] : [ST], email: p.email, name: p.name, joinedAt: now });
    b.set(db.doc(`orgs/${ORG}/names/${p.uid}`), { name: p.name, at: now });
    b.set(db.doc(`users/${p.uid}`), { orgIds: [ORG], orgId: ORG, email: p.email, name: p.name });
  }
  const van = (n) => ({ name: '', plate: `B-LY ${n}`, cls: 'large_van', roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn', fuel: 'diesel', stationId: ST, createdAt: now + n, createdBy: OWNER.uid, scanId: null });
  b.set(db.doc(`orgs/${ORG}/vehicles/${VAN}`), { ...van(1), assignedTo: { assignmentId: 'lyA1', driverId: LONG.uid, since: now - 3600_000, kmStart: null, kmEnd: null } });
  b.set(db.doc(`orgs/${ORG}/vehicles/${VAN2}`), van(2));
  b.set(db.doc(`orgs/${ORG}/assignments/lyA1`), { vehicleId: VAN, vehicleName: 'B-LY 1', plate: 'B-LY 1', driverId: LONG.uid, driverName: LONG.name, stationId: ST,
    start: now - 3600_000, end: null, startedBy: OWNER.uid, startedByName: OWNER.name, endedBy: null, endedByName: null, endReason: null, createdAt: now - 3600_000 });
  b.set(db.doc(`orgs/${ORG}/walkarounds/lyWalk1`), { vehicleId: VAN, vehicleName: 'B-LY 1', cls: 'large_van', stationId: ST, source: 'camera', createdAt: now - 600_000,
    createdBy: LONG.uid, totalMs: null, frames: 1, taken: 1, skipped: 0, retakes: 0, photos: [{ n: 1, label: 'Front', w: 900, h: 1200, takenAt: now - 600_000 }] });
  b.set(db.doc(`orgs/${ORG}/checks/${CHECK}`), { vehicleId: VAN, vehicleName: 'B-LY 1', cls: 'large_van', walkId: 'lyWalk1', createdBy: LONG.uid, walkBy: LONG.uid, stationId: ST,
    tier: 'quick', model: 'test', photos: 1, notVisible: [], missedNote: '', createdAt: now - 500_000, status: 'submitted', submittedAt: now - 400_000, review: null,
    spots: [{ photo: 0, photoLabel: 'Front', box: [0.3, 0.35, 0.5, 0.5], panel: 'front bumper', type: 'scratch', sizeCm: 6, conf: 0.8, mightBe: null, closeup: '', refPath: null, closeups: [], verdict: null, feedback: null, markPath: null }] });
  await b.commit();
  // CHROME_PATH: a Chrome already on this computer, to run the test without Playwright's own browser.
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(process.env.CHROME_PATH ? ['--no-sandbox'] : [])] });
});

after(async () => {
  await browser?.close();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
});

const dictOf = (code) => (code === 'en'
  ? Object.fromEntries(Object.keys(JSON.parse(readFileSync(join(I18N, 'de.json'), 'utf8'))).map((k) => [k, k]))
  : JSON.parse(readFileSync(join(I18N, `${code}.json`), 'utf8')));

/** A change made on this phone in English that stopped: its card must show in the language chosen later (4.4). */
const stoppedChange = (uid) => ({
  id: 'lyJob1', type: 'change', what: 'change', orgId: ORG, uid, vehicleId: VAN2, vehicleName: 'B-LY 2', assignmentId: null, then: null,
  createdAt: Date.now() - 60_000, files: [], status: 'failed', personId: EMOJI.uid,
  title: 'Give B-LY 2 to 😀 Emma Stone', titleSrc: { k: 'Give {van} to {name}', v: { van: 'B-LY 2', name: '😀 Emma Stone' } },
  error: 'This change was refused. Check that you still belong to this company and may change it.',
  errorSrc: { k: 'This change was refused. Check that you still belong to this company and may change it.' },
  errorCode: 'permission-denied', change: { kind: 'call', fn: 'assignVan', data: { orgId: ORG, vehicleId: VAN2, driverId: EMOJI.uid, expect: null, rid: 'rlayout1' } },
});

async function signedIn(code, viewport = { width: 390, height: 844 }, who = OWNER) {
  const ctx = await browser.newContext({ viewport, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${URL0}/sign-in`);
  await page.evaluate(({ l, job }) => { localStorage.setItem('fc.lang', l); localStorage.setItem('fc.outbox.v1', JSON.stringify([job])); }, { l: code, job: stoppedChange(who.uid) });
  await page.goto(`${URL0}/sign-in`);
  await page.locator('input[type=email] >> visible=true').fill(who.email);
  await page.locator('input[type=password] >> visible=true').fill(who.password);
  await page.locator('input[type=password] >> visible=true').press('Enter');
  await page.locator('[role=tablist] >> visible=true').last().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  // Signed in, the app must still be in the language asked for (and keep it on a reload).
  const shown = await page.evaluate(() => ({ html: document.documentElement.lang, kept: localStorage.getItem('fc.lang') }));
  const prof = (await db.doc(`users/${who.uid}`).get()).data() || {};
  if (shown.html !== code || shown.kept !== code) console.log(`signed in for ${code}: shown ${shown.html}, kept ${shown.kept}, profile lang ${prof.lang} appLang ${prof.appLang}`);
  return { ctx, page, errors };
}

const SCREENS = [
  ['Fleet', '/'], ['a van', `/vehicle/${VAN}`], ['Review', '/review'], ['People', '/people'], ['Data', '/data'], ['Account', '/account'],
  ['the van with the stopped change', `/vehicle/${VAN2}`], ['the camera', `/scan/${VAN2}`],
];

test('cause 4.1: in Arabic and Persian the signed-in app is on the screen and every button works, the language switch too', async () => {
  for (const code of ['ar', 'fa']) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      // The language chosen in the last round follows the person: back to none, so this phone's choice counts.
      await db.doc(`users/${RTL.uid}`).set({ lang: FieldValue.delete(), appLang: FieldValue.delete() }, { merge: true });
      const { ctx, page, errors } = await signedIn(code, viewport, RTL);
      try {
        const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
        assert.ok(wide <= viewport.width + 1, `${code} at ${viewport.width}: the page is ${wide} px wide`);
        // The tab bar is on the screen and its tabs can be tapped: Account, then the language switch, then English.
        const tabs = page.locator('[role=tab] >> visible=true');
        const box = await tabs.last().boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, `${code}: the tab bar is on the screen (${JSON.stringify(box)})`);
        await page.goto(`${URL0}/account`);
        await page.waitForTimeout(2000);
        assert.equal(await page.evaluate(() => document.documentElement.lang), code, `${code}: still in ${code} after opening Account`);
        await page.locator(`[role=button] >> text="${dictOf(code)['Change language']}" >> visible=true`).first().click({ timeout: 15_000 });
        await page.locator('text="English" >> visible=true').first().click({ timeout: 15_000 });
        await page.locator('text="Account" >> visible=true').first().waitFor({ timeout: 15_000 });
        assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    }
  }
});

test('cause 4 guard: the main screens in all 32 languages at phone width: on the screen, nothing off the edge, nothing cut or tiny, no English left', async () => {
  assert.ok(process.env.LAYOUT_LANGS || CODES.length >= 32, `${CODES.length} languages`);
  const found = [];
  const queue = [...CODES];
  // Four browsers at a time.
  await Promise.all([0, 1, 2, 3].map(async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const dict = dictOf(code);
      const { ctx, page, errors } = await signedIn(code);
      try {
        for (const [name, path] of SCREENS) {
          await page.goto(`${URL0}${path}`);
          await page.waitForTimeout(path.startsWith('/scan') ? 4000 : 2500);
          // The screen must be in the language asked for; if it isn't, that's one problem, not every text on it.
          const shown = await page.evaluate(() => ({ html: document.documentElement.lang, kept: localStorage.getItem('fc.lang') }));
          if (shown.html !== code) { found.push(`${code} ${name}: shown in "${shown.html}" (kept: ${shown.kept})`); continue; }
          const probs = await page.evaluate(layoutProblems, { dict, lang: code });
          for (const p of probs) found.push(`${code} ${name}: ${p}`);
        }
        for (const e of errors) found.push(`${code}: page error ${e.slice(0, 120)}`);
      } finally { await ctx.close(); }
    }
  }));
  if (found.length) console.log(`Layout problems (${found.length}):\n${found.join('\n')}`);
  assert.deepEqual(found, []);
});

test('cause 4.3: a long name without spaces wraps on the Review card and the People list; an emoji name gets proper initials', async () => {
  const { ctx, page, errors } = await signedIn('en');
  try {
    for (const path of ['/review', '/people', `/vehicle/${VAN}`, `/person/${LONG.uid}`]) {
      await page.goto(`${URL0}${path}`);
      await page.locator(`text=/Maximilian/ >> visible=true`).first().waitFor({ timeout: 30_000 });
      // On the screen, and not cut by its box or an ellipsis: wrapped.
      const bad = await page.evaluate(() => [...document.querySelectorAll('#root *')].filter((el) => /Maximilian/.test(el.textContent || '') && !el.children.length)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0; })
        .map((el) => { const r = el.getBoundingClientRect(); return { off: r.right > innerWidth + 1 || r.left < -1, cut: el.scrollWidth > el.clientWidth + 1, text: el.textContent.slice(0, 60) }; })
        .filter((x) => x.off || x.cut));
      assert.deepEqual(bad, [], `${path}: the long name stays on the screen, whole`);
    }
    await page.goto(`${URL0}/people`);
    await page.locator('text=/Emma Stone/ >> visible=true').first().waitFor({ timeout: 30_000 });
    const circles = await page.evaluate(() => [...document.querySelectorAll('#root *')].filter((el) => !el.children.length && /^[\p{L}?]{1,2}$/u.test((el.textContent || '').trim()) || /[\uD800-\uDFFF]/.test(el.textContent || '') && !/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(el.textContent || ''))
      .map((el) => el.textContent.trim()));
    assert.ok(circles.includes('ES'), `initials ES among ${JSON.stringify(circles.slice(0, 20))}`);
    assert.ok(!circles.some((x) => /[\uD800-\uDFFF]/.test(x)), 'no half characters');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('cause 4.3: on the driver link, a last name over 40 characters is refused with a message, before anything is made', async () => {
  const token = 'layoutLinkToken0001';
  const now = Date.now();
  await db.doc(`companyLinks/${token}`).set({ orgId: ORG, active: true, token, createdAt: now, createdBy: OWNER.uid, createdByName: OWNER.name });
  await db.doc(`orgs/${ORG}/links/drivers`).set({ token, createdAt: now, createdBy: OWNER.uid, createdByName: OWNER.name });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  try {
    await page.goto(`${URL0}/join/${token}`);
    await page.locator('text=/Layout station/ >> visible=true').first().click({ timeout: 60_000 });
    await page.getByLabel('First name').fill('Nina');
    await page.getByLabel('Last name').fill('L'.repeat(41));
    await page.locator('text=/at most 40 characters/ >> visible=true').first().waitFor({ timeout: 10_000 });
    await page.getByLabel('Email').fill('nina.layout@example.com');
    await page.getByLabel('Password').fill('layout-pass-9');
    await page.locator('[role=button] >> text=/Send|Sign up|request/i >> visible=true').last().click();
    await page.waitForTimeout(3000);
    await page.locator('text=/at most 40 characters/ >> visible=true').first().waitFor({ timeout: 10_000 });
    const made = await auth.getUserByEmail('nina.layout@example.com').then(() => true, () => false);
    assert.equal(made, false, 'no account was made');
  } finally { await ctx.close(); }
});
