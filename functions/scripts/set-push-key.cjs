// Puts the public half of the notification key pair where the app reads it (config/push). The pair itself is the
// WEBPUSH_KEYS secret (made once by the Deploy workflow); this script gets it on stdin and prints nothing of it.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

(async () => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const { publicKey } = JSON.parse(raw.trim());
  if (!publicKey || !/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)) throw new Error('The notification key looks wrong.');
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const ref = getFirestore().doc('config/push');
  const cur = (await ref.get()).data() || {};
  if (cur.vapidPublicKey === publicKey) { console.log('Notification key unchanged.'); return; }
  await ref.set({ vapidPublicKey: publicKey, updatedAt: Date.now() });
  console.log('Notification key published for the app.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
