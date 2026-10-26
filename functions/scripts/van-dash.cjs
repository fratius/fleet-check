// Fills in, once per company, what came before 2026-10-26: each van's latest dashboard (km, fuel or battery,
// range, warning lights) and the km of each driver's time with a van, from the dashboard photos of tours and refuels.
// After that the functions keep both up to date (functions/src/vandash.ts). Each company is marked; safe to run again.
// Run by the Deploy workflow with the Firebase service account, after the functions are built.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { fillVanDash } = require('../lib/vandash.js');

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let orgs = 0, vans = 0, spans = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    if (org.data().vanDash) continue;
    const r = await fillVanDash(org.ref, () => db.batch());
    await org.ref.update({ vanDash: Date.now() });
    orgs++; vans += r.vans; spans += r.assignments;
  }
  console.log(orgs ? `Filled in the km and dashboard of ${vans} van${vans === 1 ? '' : 's'} and the km of ${spans} driver period${spans === 1 ? '' : 's'} (${orgs} compan${orgs === 1 ? 'y' : 'ies'}).`
    : 'No companies to fill in.');
})().catch((e) => { console.error(e); process.exit(1); });
