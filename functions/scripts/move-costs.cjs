// Moves what each van costs out of its business record (vehicleDetails, read by owners and the station's fleet
// managers) into vehicleCosts, which only owners read: monthly rate, purchase price, price per extra kilometre,
// insurance premium and deductible. Copies first, removes after; safe to run again.
// Run by the Deploy workflow with the Firebase service account.
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const COSTS = ['monthly', 'purchasePrice', 'excessPerKm', 'premium', 'deductible'];

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let moved = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    for (const d of (await org.ref.collection('vehicleDetails').get()).docs) {
      const x = d.data();
      const here = COSTS.filter((k) => k in x);
      if (!here.length) continue;
      const cref = org.ref.collection('vehicleCosts').doc(d.id);
      const cur = (await cref.get()).data() || {};
      // What's already in vehicleCosts wins: an owner entered it there.
      const patch = { createdAt: cur.createdAt || x.createdAt || Date.now() };
      for (const k of here) if (cur[k] == null && x[k] != null) patch[k] = x[k];
      await cref.set(patch, { merge: true });
      await d.ref.update(Object.fromEntries(here.map((k) => [k, FieldValue.delete()])));
      moved++;
    }
  }
  console.log(moved ? `Moved the costs of ${moved} van${moved === 1 ? '' : 's'} to vehicleCosts (owners only).` : 'No van costs to move.');
})().catch((e) => { console.error(e); process.exit(1); });
