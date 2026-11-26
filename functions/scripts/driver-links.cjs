// Every company has its driver link from the start (product owner, 2026-11-26; functions/src/links.ts). New companies
// get it when they're made; this gives one to every company made before that has none. Safe to run again.
// Run by the Deploy workflow with the Firebase service account, after the functions are built.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { ensureDriverLink } = require('../lib/links.js');

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let made = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    if (org.data().closed) continue;
    const by = String(org.data().createdBy || '');
    const owner = by ? (await org.ref.collection('members').doc(by).get()).data() : null;
    const r = await ensureDriverLink(org.id, { uid: by, name: String(owner?.name || '') });
    if (r.made) made++;
  }
  console.log(made ? `Made the driver link of ${made} compan${made === 1 ? 'y' : 'ies'}.` : 'Every company has its driver link.');
})().catch((e) => { console.error(e); process.exit(1); });
