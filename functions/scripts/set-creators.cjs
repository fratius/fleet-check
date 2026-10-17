// Gives the "app creator" sign-in claim to the accounts listed in APP_CREATOR_EMAILS (comma separated)
// and takes it away from accounts that were creators before but aren't listed any more.
// Run by the Deploy workflow with the Firebase service account; change the list in the GitHub variable.
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

(async () => {
  const projectId = process.env.PROJECT || process.env.GCLOUD_PROJECT;
  initializeApp({ projectId });
  const auth = getAuth();
  const db = getFirestore();
  const emails = String(process.env.APP_CREATOR_EMAILS || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const ref = db.doc('platform/creators');
  const before = ((await ref.get()).data() || {}).uids || [];
  const now = [];
  for (const email of emails) {
    try {
      const u = await auth.getUserByEmail(email);
      now.push(u.uid);
      if (!(u.customClaims && u.customClaims.creator)) {
        await auth.setCustomUserClaims(u.uid, { ...(u.customClaims || {}), creator: true });
        console.log(`App creator: ${email} added.`);
      } else console.log(`App creator: ${email} already set.`);
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') console.log(`::warning title=App creator::No account with ${email} yet. Sign up in the app with it, then run Deploy again.`);
      else throw e;
    }
  }
  for (const uid of before) {
    if (now.includes(uid)) continue;
    const u = await auth.getUser(uid).catch(() => null);
    if (!u) continue;
    const claims = { ...(u.customClaims || {}) };
    delete claims.creator;
    await auth.setCustomUserClaims(uid, claims);
    console.log(`App creator: ${u.email || uid} removed.`);
  }
  await ref.set({ uids: now, emails, updatedAt: Date.now() });
})().catch((e) => { console.error(e); process.exit(1); });
