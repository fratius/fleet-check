// Screenshots for the App Store and Google Play: the web app against the Firebase emulators, in the demo company,
// at the iPhone 6.9" size (440 x 956 points at 3x = 1320 x 2868 pixels), in English and German. Nothing touches
// the real project. The Store screenshots workflow runs it; store/compose.mjs then puts each one under a caption.
// Run: emulators:exec --only auth,firestore,functions,storage "node tests/store-shots.mjs" (APP_DIR = the web build,
// OUT_DIR = where the PNGs go).
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';

import { chromium } from 'playwright';

const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getAuth } = fnRequire('firebase-admin/auth');
const { getFirestore } = fnRequire('firebase-admin/firestore');

const APP_DIR = process.env.APP_DIR || new URL('../dist-e2e', import.meta.url).pathname;
const OUT = process.env.OUT_DIR || new URL('../store-shots', import.meta.url).pathname;
const PORT = 8098;
const URL0 = `http://127.0.0.1:${PORT}`;
const app = initializeApp({ projectId: 'demo-fleet-check' }, 'store-shots');
const db = getFirestore(app);
const auth = getAuth(app);
const ROOT = new URL('..', import.meta.url).pathname;
const tr = (code, key) => (code === 'en' ? key : JSON.parse(readFileSync(join(ROOT, 'public/i18n', `${code}.json`), 'utf8'))[key] || key);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, URL0).pathname);
  let f = join(APP_DIR, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(APP_DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
});

const OWNER = { email: 'lena.hoffmann@example.com', password: 'store-shots-1', name: 'Lena Hoffmann' };
const LOCALES = [['en', 'en-GB'], ['de', 'de-DE']];
const log = (...a) => console.log('[shots]', ...a);

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

/** Waits until the page has settled: no spinner, every image loaded, then a moment for the last paint. */
async function settle(page) {
  await page.waitForTimeout(2500);
  await until(async () => page.evaluate(() => [...document.images].every((i) => i.complete)), 30_000, 'images').catch(() => {});
  await until(async () => (await page.locator('[role=progressbar] >> visible=true').count()) === 0, 20_000, 'spinners').catch(() => {});
  await page.waitForTimeout(1500);
}

async function signIn(browser, code, locale, who) {
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, locale, colorScheme: 'light', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('page error', String(e).slice(0, 200)));
  await page.goto(URL0 + '/sign-in');
  await page.locator('input[type=email] >> visible=true').fill(who.email);
  await page.locator('input[type=password] >> visible=true').fill(who.password);
  await page.locator(`[role=button] >> text="${tr(code, 'Sign in')}" >> visible=true`).last().click();
  return { ctx, page };
}

async function shot(page, dir, name, path, waitFor) {
  await page.goto(URL0 + path);
  if (waitFor) await visible(page, waitFor).waitFor({ timeout: 60_000 }).catch(() => log(`"${waitFor}" not seen on ${path}`));
  await settle(page);
  if (path === '/data') {
    const info = await page.evaluate(() => {
      const f = document.fonts;
      const tabs = [...document.querySelectorAll('[role=tab]')].slice(0, 4).map((t) => { const l = [...t.querySelectorAll('div')].find((d) => d.childElementCount === 0); const cs = l && getComputedStyle(l); return `${t.innerText.replace(/\n/g, '/')} cell=${Math.round(t.getBoundingClientRect().width)} fs=${cs && cs.fontSize} ff=${cs && cs.fontFamily.split(',')[0]} basis=${cs && cs.flexBasis}`; });
      return { win: innerWidth, check: f ? f.check('100px Tessera_600SemiBold') : 'none', status: f ? f.status : 'none', faces: f ? [...f].map((x) => x.family + ':' + x.status).join(',') : '', lang: document.documentElement.lang, tabs };
    });
    log('DIAG', JSON.stringify(info));
  }
  await page.screenshot({ path: join(dir, `${name}.png`) });
  log('saved', dir.split('/').pop(), name, path);
}

/** Replaces names in every text of the company's records (the emulators only), so the pictures read naturally. */
async function renameEverywhere(org, pairs) {
  const fix = (v) => {
    if (typeof v === 'string') return pairs.reduce((x, [a, b]) => x.split(a).join(b), v);
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object' && v.constructor === Object) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  const walk = async (ref) => {
    for (const col of await ref.listCollections()) {
      for (const d of (await col.get()).docs) {
        const before = JSON.stringify(d.data());
        const after = fix(d.data());
        if (JSON.stringify(after) !== before) await d.ref.set(after);
        await walk(d.ref);
      }
    }
  };
  const top = (await org.get()).data();
  const fixed = fix(top);
  if (JSON.stringify(fixed) !== JSON.stringify(top)) await org.set(fixed);
  await walk(org);
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const u = await auth.createUser({ email: OWNER.email, password: OWNER.password, displayName: OWNER.name });

  // The owner gets the demo company. Only the app creator can open one, so the owner is the app creator for that
  // one call (the claim is taken off before any screenshot, so no creator-only screen shows).
  {
    await auth.setCustomUserClaims(u.uid, { creator: true });
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const fnHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
    const si = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password, returnSecureToken: true }),
    }).then((r) => r.json());
    if (!si.idToken) throw new Error(`sign-in for the demo failed: ${JSON.stringify(si)}`);
    const r = await fetch(`http://${fnHost}/demo-fleet-check/us-central1/createDemoCompany`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${si.idToken}` }, body: JSON.stringify({ data: {} }),
    });
    if (!r.ok) throw new Error(`createDemoCompany: ${r.status} ${await r.text()}`);
    await until(async () => (await db.doc(`users/${u.uid}`).get()).data()?.orgId, 120_000, 'the demo company');
    await auth.setCustomUserClaims(u.uid, null);
  }
  const orgId = (await db.doc(`users/${u.uid}`).get()).data().orgId;
  const org = db.doc(`orgs/${orgId}`);
  // A name a real company would have on the screenshots ("Demo DSP (test data)" otherwise).
  await org.update({ name: 'Spree Logistik GmbH' });
  // The two demo logins are called "Alex Demo" and "Morgan Demo": everyday names on the screenshots.
  const NAMES = [['Alex Demo', 'Alex Wagner'], ['Morgan Demo', 'Morgan Becker'], ['Sam Demo', 'Sam Weber']];
  await renameEverywhere(org, NAMES);
  const odata = (await org.get()).data();
  const driver = (odata.demoLogins || []).find((l) => l.role === 'driver');
  const manager = (odata.demoLogins || []).find((l) => l.role === 'manager');
  for (const l of [driver, manager].filter(Boolean)) {
    await auth.updateUser(l.uid, { displayName: l.name });
    await db.doc(`users/${l.uid}`).set({ name: l.name }, { merge: true });
  }
  // A driver with a long history (not a login: those have test addresses on their page).
  const members = (await org.collection('members').where('role', '==', 'driver').get()).docs.map((d) => d.id)
    .filter((id) => !(odata.demoLogins || []).some((l) => l.uid === id));
  let histDriver = members[0], most = -1;
  for (const id of members) {
    const n = (await org.collection('assignments').where('driverId', '==', id).get()).size;
    if (n > most) { most = n; histDriver = id; }
  }

  // What to show: the van with the most damage on its record, a check waiting for the manager, the driver's history,
  // and the refuel waiting at the pump.
  const logs = (await org.collection('damageLog').get()).docs.map((d) => d.data()).sort((a, b) => (b.n || 0) - (a.n || 0));
  const vanId = logs[0]?.vehicleId || (await org.collection('vehicles').limit(1).get()).docs[0].id;
  const waiting = (await org.collection('checks').where('status', '==', 'submitted').limit(1).get()).docs[0];
  const checkId = waiting?.id || (await org.collection('checks').limit(1).get()).docs[0].id;
  const atPump = (await org.collection('purchases').where('status', '==', 'waiting').limit(1).get()).docs[0];
  log('org', orgId, 'van', vanId, 'check', checkId, 'pump', atPump?.id, 'driver', driver?.uid, 'manager', manager?.uid);

  for (const [code, locale] of LOCALES) {
    const dir = join(OUT, code);
    mkdirSync(dir, { recursive: true });
    // The fleet owner's view.
    {
      const { ctx, page } = await signIn(browser, code, locale, OWNER);
      await visible(page, 'eSprinter 01').waitFor({ timeout: 90_000 });
      await settle(page);
      // The vans that have a driver: names, km, warning lights.
      await page.locator(`text=${tr(code, 'With a driver ({n})').split(' (')[0]} >> visible=true`).first().click().catch(() => log('no "with a driver" filter'));
      await settle(page);
      await page.screenshot({ path: join(dir, '01-fleet.png') });
      log('saved', code, '01-fleet');
      await shot(page, dir, '02-van', `/vehicle/${vanId}`);
      await shot(page, dir, '04-review', '/review');
      await shot(page, dir, '06-data', '/data');
      if (histDriver) {
        await page.goto(URL0 + `/person/${histDriver}`);
        await page.waitForTimeout(3000);
        await page.locator(`[role=tab] >> text=${tr(code, 'Vans')} >> visible=true`).first().click().catch(() => log('no Vans tab'));
        await settle(page);
        await page.screenshot({ path: join(dir, '05-history.png') });
        log('saved', code, '05-history');
      }
      await ctx.close();
    }
    // The fleet manager decides on a check and on the driver at the pump.
    if (manager) {
      const { ctx, page } = await signIn(browser, code, locale, manager);
      await page.waitForTimeout(5000);
      await shot(page, dir, '03-check', `/check/${checkId}`);
      if (atPump) await shot(page, dir, '08-pump', `/buy/${atPump.id}`);
      await ctx.close();
    }
    // The driver's phone: their van, the pick-up, the buttons.
    if (driver) {
      const { ctx, page } = await signIn(browser, code, locale, driver);
      await page.waitForTimeout(5000);
      await shot(page, dir, '07-driver', '/');
      await ctx.close();
    }
  }
  writeFileSync(join(OUT, 'ids.json'), JSON.stringify({ orgId, vanId, checkId, pump: atPump?.id || null }, null, 1));
  await browser.close();
  server.close();
}

main().then(() => process.exit(0), (e) => { console.error('[shots] failed:', e); process.exit(1); });
