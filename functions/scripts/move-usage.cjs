// Moves AI speed and cost out of damage checks saved before they were kept apart: pass1, pass2, serverMs, prepMs
// and each spot's verdict time go to orgs/{org}/checkUsage/{checkId} (only the app creator reads it), then are
// removed from the check, which everyone at the station reads. Copies first, removes after; safe to run again.
// Run by the Deploy workflow with the Firebase service account (and by the emulator tests).
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const MOVE = ['pass1', 'pass2', 'serverMs', 'prepMs'];

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  let moved = 0;
  for (const org of (await db.collection('orgs').get()).docs) {
    const checks = await org.ref.collection('checks').get();
    for (const c of checks.docs) {
      const d = c.data();
      const spots = Array.isArray(d.spots) ? d.spots : [];
      const timed = spots.some((p) => p && p.verdict && 'ms' in p.verdict);
      if (!MOVE.some((k) => k in d) && !timed) continue;
      const uref = org.ref.collection('checkUsage').doc(c.id);
      const cur = (await uref.get()).data() || {};
      const spotMs = { ...(cur.spotMs || {}) };
      spots.forEach((p, j) => { if (p && p.verdict && typeof p.verdict.ms === 'number' && spotMs[j] == null) spotMs[j] = p.verdict.ms; });
      // What's already in checkUsage wins: it was written by the newer functions.
      await uref.set({
        checkId: c.id, stationId: d.stationId || null, createdAt: d.createdAt || null, tier: d.tier || null, model: d.model || null,
        pass1: cur.pass1 ?? d.pass1 ?? null, pass2: cur.pass2 ?? d.pass2 ?? null,
        serverMs: cur.serverMs ?? d.serverMs ?? null, prepMs: cur.prepMs ?? d.prepMs ?? null, spotMs,
      }, { merge: true });
      const patch = Object.fromEntries(MOVE.filter((k) => k in d).map((k) => [k, FieldValue.delete()]));
      if (timed) patch.spots = spots.map((p) => (p && p.verdict && 'ms' in p.verdict ? { ...p, verdict: Object.fromEntries(Object.entries(p.verdict).filter(([k]) => k !== 'ms')) } : p));
      await c.ref.update(patch);
      moved++;
    }
  }
  console.log(moved ? `Moved the speed and cost of ${moved} damage check${moved === 1 ? '' : 's'} to checkUsage.` : 'No damage checks to move.');
})().catch((e) => { console.error(e); process.exit(1); });
