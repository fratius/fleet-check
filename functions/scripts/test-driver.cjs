// Makes (or updates) the app creator's own test driver account, so they can see the app exactly as a driver does:
// a separate sign-in (by default their address with "+driver", which Gmail delivers to the same inbox), a driver at
// one station of the company they own. Run by hand from GitHub Actions (Test driver account). The password is
// random and never printed (the repository is public): set it in the app with "Forgot your password?".
//
// This is the one way into a company that isn't an invite link. It only ever adds the creator's own test account,
// as a driver, to a company the creator owns.
const { randomBytes } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const auth = getAuth();
  const db = getFirestore();
  const ownerEmail = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!ownerEmail) throw new Error('OWNER_EMAIL is not set.');
  const [local, domain] = ownerEmail.split('@');
  const driverEmail = String(process.env.DRIVER_EMAIL || '').trim().toLowerCase() || `${local}+driver@${domain}`;
  const wantStation = String(process.env.STATION || '').trim().toLowerCase();
  // Only the creator's own address with a "+something" tag: this never adds anyone else.
  if (!driverEmail.startsWith(`${local}+`) || !driverEmail.endsWith(`@${domain}`)) throw new Error(`Use your own address with a tag, like ${local}+driver@${domain}.`);

  const owner = await auth.getUserByEmail(ownerEmail);
  const creators = (((await db.doc('platform/creators').get()).data() || {}).uids) || [];
  if (!creators.includes(owner.uid)) throw new Error('Only for the app creator (APP_CREATOR_EMAILS).');

  // The company: the one the creator owns and had open last, else the oldest they made. Never a demo company.
  const made = (await db.collection('orgs').where('createdBy', '==', owner.uid).get()).docs.filter((d) => !d.data().demo);
  if (!made.length) throw new Error('No company of yours yet. Create one in the app first.');
  const lastOpen = ((await db.doc(`users/${owner.uid}`).get()).data() || {}).orgId;
  const org = made.find((d) => d.id === lastOpen) || made.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0))[0];
  const stations = (await org.ref.collection('stations').get()).docs.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
  if (!stations.length) throw new Error('The company has no station yet.');
  const station = (wantStation && stations.find((s) => String(s.data().name || '').toLowerCase() === wantStation || String(s.data().code || '').toLowerCase() === wantStation)) || stations[0];

  let user;
  try {
    user = await auth.getUserByEmail(driverEmail);
    console.log('The test driver account already exists; making sure it is a driver at the station.');
  } catch (e) {
    if (!e || e.code !== 'auth/user-not-found') throw e;
    user = await auth.createUser({ email: driverEmail, password: randomBytes(24).toString('base64url'), displayName: 'Casian Driver (test)' });
    console.log('Test driver account created.');
  }
  if (user.uid === owner.uid) throw new Error('The driver address must differ from the owner address.');
  const name = user.displayName || 'Casian Driver (test)';
  const now = Date.now();
  const ref = org.ref.collection('members').doc(user.uid);
  const cur = await ref.get();
  if (cur.exists && cur.data().role !== 'driver') throw new Error('That account is already in the company with another role. Pick another DRIVER_EMAIL.');
  await ref.set({
    role: 'driver', stationIds: [station.id], email: driverEmail, name, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '),
    phone: cur.exists ? cur.data().phone || '' : '', transporterId: cur.exists ? cur.data().transporterId || '' : '', testAccount: true,
    joinedAt: cur.exists ? cur.data().joinedAt || now : now, invite: 'test-driver-workflow',
  }, { merge: true });
  await db.doc(`users/${user.uid}`).set({ orgIds: FieldValue.arrayUnion(org.id), orgId: org.id, email: driverEmail, name }, { merge: true });
  // No company, station or person names here: the log is public.
  console.log(`Done: ${driverEmail} is a driver at the ${stations.indexOf(station) + 1}. station (of ${stations.length}) of your company.`);
  console.log('Sign in to the app with it after setting a password with "Forgot your password?".');
})().catch((e) => { console.error(`::error title=Test driver account::${e.message || e}`); process.exit(1); });
