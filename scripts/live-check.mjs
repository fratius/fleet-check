// After each Deploy: does the live app work for a real member of a company? The emulators answer everything
// (they need no IAM roles, no indexes, no real AI key), so a broken live project passes every test: on 11 Nov 2026
// every upload from the app had been refused in production, probably since the first day, with all tests green.
//
// Signs in as the fleet manager of the app creator's demo company (one of the demo's own logins, so no extra
// sign-in exists in the live project; AGENTS.md) and does what the app does first:
//   1. uploads a photo where the app puts van-type scans (Storage rules, and their read of the database),
//   2. reads it back,
//   3. lists the vans of the manager's station (Firestore rules),
//   4. asks the AI for the van type of that photo (the functions, the Claude key, its workspace and credit).
// Then deletes the photo. One real AI request on the Fast model per deploy, about $0.0005; it counts toward the demo
// company's daily AI allowance and shows in the Test log.
//
// Run: node scripts/live-check.mjs              (live: PROJECT, credentials from google-github-actions/auth)
//      node scripts/live-check.mjs --emulators  (inside firebase emulators:exec; qa/run.sh runs it before the tester)
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const fnRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getAuth } = fnRequire('firebase-admin/auth');
const { getFirestore } = fnRequire('firebase-admin/firestore');
const { getStorage } = fnRequire('firebase-admin/storage');
const sharp = fnRequire('sharp');

const EMU = process.argv.includes('--emulators');
const web = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo.extra.firebase;
const PROJECT = EMU ? 'demo-fleet-check' : (process.env.PROJECT || web.projectId);
const BUCKET = EMU ? 'demo-fleet-check.appspot.com' : web.storageBucket;
const KEY = EMU ? 'demo-key' : web.apiKey;
const URLS = EMU
  ? { auth: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', storage: 'http://127.0.0.1:9199', firestore: 'http://127.0.0.1:8080', functions: `http://127.0.0.1:5001/${PROJECT}/us-central1` }
  : { auth: 'https://identitytoolkit.googleapis.com', storage: 'https://firebasestorage.googleapis.com', firestore: 'https://firestore.googleapis.com', functions: `https://us-central1-${PROJECT}.cloudfunctions.net` };
// The web app's key may only be accepted from the app's own pages.
const REFERER = EMU ? 'http://127.0.0.1:8099/' : `https://${PROJECT}.web.app/`;

const app = initializeApp({ projectId: PROJECT, storageBucket: BUCKET }, 'live-check');
const db = getFirestore(app);
const results = [];
const note = (level, title, msg) => console.log(`::${level} title=${title}::${msg.replace(/\n/g, ' ')}`);
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e?.message || e) });
    throw e;
  }
}
const body = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const short = (x) => (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400);

async function main() {
  // The app creator's demo company: the newest one, with its manager login.
  const demos = (await db.collection('orgs').where('demo', '==', true).get()).docs
    .filter((d) => (d.data().demoLogins || []).some((l) => l.role === 'manager'))
    .sort((a, b) => (b.data().createdAt || 0) - (a.data().createdAt || 0));
  if (!demos.length) {
    note('warning', 'Live check skipped', 'No demo company with logins. Open one in the app (Account > Demo company) so every Deploy can check the live app.');
    return 'skipped';
  }
  const org = demos[0];
  const mgr = org.data().demoLogins.find((l) => l.role === 'manager');
  const member = (await db.doc(`orgs/${org.id}/members/${mgr.uid}`).get()).data();
  const st = member?.stationIds?.[0];
  if (!st) throw new Error(`The demo manager has no station in ${org.id}.`);

  let token = '';
  await step('Sign in as the demo company\'s fleet manager', async () => {
    const custom = await getAuth(app).createCustomToken(mgr.uid);
    const r = await fetch(`${URLS.auth}/v1/accounts:signInWithCustomToken?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json', referer: REFERER }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    const j = await body(r);
    if (!j.idToken) throw new Error(`Sign-in refused (${r.status}): ${short(j)}`);
    token = j.idToken;
    return mgr.email;
  });

  const scanId = `livecheck${Date.now()}`;
  const path = `orgs/${org.id}/scans/${scanId}/live-check.jpg`;
  const photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 196, g: 204, b: 212 } } })
    .composite([{ input: Buffer.from('<svg width="640" height="480"><rect x="120" y="140" width="400" height="220" fill="#f4f5f6"/><circle cx="200" cy="360" r="34"/><circle cx="440" cy="360" r="34"/></svg>'), top: 0, left: 0 }])
    .jpeg({ quality: 85 }).toBuffer();
  const enc = encodeURIComponent(path);
  try {
    await step('Upload a photo (Storage rules)', async () => {
      const b = 'livecheck' + Date.now();
      const multipart = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: path, contentType: 'image/jpeg' })}\r\n--${b}\r\nContent-Type: image/jpeg\r\n\r\n`),
        photo, Buffer.from(`\r\n--${b}--`),
      ]);
      const r = await fetch(`${URLS.storage}/v0/b/${BUCKET}/o?name=${enc}`, {
        method: 'POST', body: multipart,
        headers: { authorization: `Firebase ${token}`, 'x-goog-upload-protocol': 'multipart', 'content-type': `multipart/related; boundary=${b}`, referer: REFERER },
      });
      if (!r.ok) {
        const why = short(await body(r));
        throw new Error(r.status === 403
          ? `Refused (403): the upload rules said no to a member of the company. If they read the database (firestore.get/exists), check the Storage service account still has roles/firebaserules.firestoreServiceAgent (Deploy step "Let the upload rules read the database"). ${why}`
          : `Upload failed (${r.status}): ${why}`);
      }
      return `${photo.length} bytes`;
    });

    await step('Read the photo back', async () => {
      const r = await fetch(`${URLS.storage}/v0/b/${BUCKET}/o/${enc}?alt=media`, { headers: { authorization: `Firebase ${token}`, referer: REFERER } });
      if (!r.ok) throw new Error(`Read refused (${r.status}): ${short(await body(r))}`);
      const got = Buffer.from(await r.arrayBuffer());
      if (!got.equals(photo)) throw new Error(`Read back ${got.length} bytes, not the ${photo.length} uploaded.`);
      return 'same bytes';
    });

    await step('List the station\'s vans (Firestore rules)', async () => {
      const r = await fetch(`${URLS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/orgs/${org.id}:runQuery`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, referer: REFERER },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'vehicles' }], where: { fieldFilter: { field: { fieldPath: 'stationId' }, op: 'IN', value: { arrayValue: { values: [{ stringValue: st }] } } } }, limit: 5 } }),
      });
      const j = await body(r);
      if (!r.ok || !Array.isArray(j)) throw new Error(`Refused (${r.status}): ${short(j)}`);
      const n = j.filter((x) => x.document).length;
      if (!n) throw new Error('The list came back empty; the demo station has vans.');
      return `${n} vans`;
    });

    await step('Ask the AI for the van type (functions, Claude key)', async () => {
      const r = await fetch(`${URLS.functions}/identifyVehicle`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, referer: REFERER },
        body: JSON.stringify({ data: { orgId: org.id, stationId: st, scanId, paths: [path] } }),
      });
      const j = await body(r);
      const err = j?.error;
      if (err?.status === 'RESOURCE_EXHAUSTED') {
        note('warning', 'Live check', 'The demo company\'s daily AI allowance is used up, so the AI wasn\'t asked today.');
        return 'allowance used up';
      }
      if (!r.ok || err) throw new Error(`Refused (${r.status}): ${short(err || j)}`);
      return `answered (${j?.result?.class || 'no van found'})`;
    });
  } finally {
    await getStorage(app).bucket(BUCKET).file(path).delete().catch(() => {});
  }
  return 'done';
}

const outcome = await main().catch((e) => { note('error', 'Live check failed', e.message || String(e)); return 'failed'; });
const table = [EMU ? '### The basics on the emulators (before the blind tester)' : '### Live check after deploy', '', '| Step | Result | Time |', '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} ${r.detail.replace(/\|/g, '/').slice(0, 300)} | ${r.ms} ms |`)].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
process.exit(outcome === 'failed' ? 1 : 0);
