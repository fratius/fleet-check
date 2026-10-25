// Fast (Haiku) became the default model on 2026-10-25 (product owner). Companies still on Balanced, or with no
// model saved, move to Fast once; each company is marked so a later choice of Balanced or Best is never undone.
// Run by the Deploy workflow with the Firebase service account. Safe to run again.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let moved = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    const d = org.data();
    if (d.haikuDefault) continue;
    const patch = { haikuDefault: Date.now() };
    if (!d.aiTier || d.aiTier === 'default') { patch.aiTier = 'quick'; moved++; }
    await org.ref.update(patch);
  }
  console.log(moved ? `Moved ${moved} compan${moved === 1 ? 'y' : 'ies'} to the Fast model.` : 'No companies to move to the Fast model.');
})().catch((e) => { console.error(e); process.exit(1); });
