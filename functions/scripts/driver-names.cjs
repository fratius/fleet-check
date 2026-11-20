// Drivers don't see other drivers' names (product owner, 2026-11-20; functions/src/names.ts). Once per company: the
// names in its records go to orgs/{org}/names (owners and fleet managers read them) and out of the records drivers
// read (vans, damage checks, another driver's name on a driver's own assignment, tour, refuel or damage log line).
// Each company is marked (namesSplit); safe to run again.
// Run by the Deploy workflow with the Firebase service account, after the functions are built.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { splitNames } = require('../lib/names.js');

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let orgs = 0, names = 0, records = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    if (org.data().namesSplit) continue;
    const r = await splitNames(org.ref, () => db.batch());
    await org.ref.update({ namesSplit: Date.now() });
    orgs++; names += r.names; records += r.records;
  }
  console.log(orgs ? `Kept ${names} name${names === 1 ? '' : 's'} for owners and managers and took names out of ${records} record${records === 1 ? '' : 's'} drivers read (${orgs} compan${orgs === 1 ? 'y' : 'ies'}).`
    : 'No companies to change.');
})().catch((e) => { console.error(e); process.exit(1); });
