// The app creator's own test company with three real sign-ins, to use the app exactly as each role does:
// a fleet owner, a fleet manager and a driver (by default the creator's address with "+owner", "+manager" and
// "+driver", which Gmail delivers to the same inbox). Run by hand from GitHub Actions (Test accounts).
//
// Unlike the demo company, nothing here is made up or replaced: the company starts with two empty stations, the three
// accounts add vans, give them out, pick them up and scan them like customers do, and everything they do stays.
// Running it again only puts back what is missing (the company, a station, an account, a membership); it never
// deletes or resets anything. The company is "comped" (never billed, no trial that runs out, no AI allowance).
//
// Passwords are random and never printed (the repository is public): set each one in the app with
// "Forgot your password?".
//
// This is the one way into a company that isn't an invite link or an approved sign-up. It only ever adds the
// creator's own "+tag" addresses, to the creator's own test company.
const { randomBytes } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const COMPANY = 'Casian Test DSP';
const STATIONS = [{ name: 'Test station 1', code: 'TST1' }, { name: 'Test station 2', code: 'TST2' }];
const ACCOUNTS = [
  { role: 'owner', tag: 'owner', first: 'Casian', last: 'Fleet Owner' },
  { role: 'manager', tag: 'manager', first: 'Casian', last: 'Fleet Manager' },
  { role: 'driver', tag: 'driver', first: 'Casian', last: 'Driver' },
];

(async () => {
  initializeApp({ projectId: process.env.PROJECT || process.env.GCLOUD_PROJECT });
  const auth = getAuth();
  const db = getFirestore();
  const creatorEmail = String(process.env.CREATOR_EMAIL || '').trim().toLowerCase();
  if (!creatorEmail) throw new Error('CREATOR_EMAIL is not set.');
  const [local, domain] = creatorEmail.split('@');

  const creator = await auth.getUserByEmail(creatorEmail);
  const creators = (((await db.doc('platform/creators').get()).data() || {}).uids) || [];
  if (!creators.includes(creator.uid)) throw new Error('Only for the app creator (APP_CREATOR_EMAILS).');

  // 1. The three sign-ins (made once, kept after that).
  const users = {};
  for (const a of ACCOUNTS) {
    const email = `${local}+${a.tag}@${domain}`;
    const name = `${a.first} ${a.last}`;
    let u;
    try {
      u = await auth.getUserByEmail(email);
      console.log(`The ${a.role} account already exists.`);
    } catch (e) {
      if (!e || e.code !== 'auth/user-not-found') throw e;
      u = await auth.createUser({ email, password: randomBytes(24).toString('base64url'), displayName: name });
      console.log(`The ${a.role} account was created.`);
    }
    if (u.uid === creator.uid) throw new Error('A test address must differ from your own.');
    users[a.role] = { ...a, uid: u.uid, email, name: u.displayName || name };
  }
  const owner = users.owner;

  // 2. The test company: found by its marker, else made. Never a demo company, never replaced.
  let org = (await db.collection('orgs').where('testCompanyOf', '==', creator.uid).limit(1).get()).docs[0];
  const now = Date.now();
  if (!org) {
    const ref = db.collection('orgs').doc();
    await ref.create({
      name: COMPANY, createdBy: owner.uid, createdAt: now, stationsReady: true, testCompanyOf: creator.uid,
      billing: { status: 'comped', trialStart: now, trialEnd: now, source: 'app', plan: 'premium', vans: null, updatedAt: now },
      aiTier: 'quick', licenceCheckMonths: 6, dashScans: true, dashScansBy: owner.name, dashScansAt: now,
    });
    org = await ref.get();
    console.log('The test company was created.');
  } else {
    console.log('The test company already exists; checking what is missing.');
  }

  // 3. Its stations (by name; renamed ones are left alone once there are two). Drivers pick up vans themselves at
  // station 1 (the owner or manager can switch it off in the app).
  const have = (await org.ref.collection('stations').get()).docs.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
  const stationIds = have.map((d) => d.id);
  for (let i = have.length; i < STATIONS.length; i++) {
    const ref = org.ref.collection('stations').doc();
    await ref.create({ ...STATIONS[i], createdAt: now + i, ...(i === 0 ? { selfAssign: true, selfAssignBy: owner.name, selfAssignAt: now } : {}) });
    stationIds.push(ref.id);
  }
  const first = stationIds[0];

  // 4. Memberships: owner of the company, manager and driver at station 1. A membership that is already there keeps
  // its station and details (moved in the app on purpose); only a different role stops the run.
  for (const a of Object.values(users)) {
    const ref = org.ref.collection('members').doc(a.uid);
    const cur = await ref.get();
    if (cur.exists) {
      const role = cur.data().role === 'admin' ? 'owner' : cur.data().role;
      if (role !== a.role) throw new Error(`The ${a.role} account is in the test company as ${role}. Change it back in the app (People).`);
    } else {
      await ref.create({
        role: a.role, stationIds: a.role === 'owner' ? [] : [first], email: a.email, name: a.name, firstName: a.first, lastName: a.last,
        phone: '', transporterId: '', joinedAt: now, testAccount: true, invite: 'test-accounts-workflow',
      });
      console.log(`The ${a.role} account was added to the test company.`);
    }
    await db.doc(`users/${a.uid}`).set({ orgIds: FieldValue.arrayUnion(org.id), orgId: org.id, email: a.email, name: a.name }, { merge: true });
  }
  // No names or ids here: the log is public.
  console.log(`Done: ${ACCOUNTS.map((a) => `${local}+${a.tag}@${domain}`).join(', ')} are in your test company.`);
  console.log('First time: in the app press "Forgot your password?" for each address, then sign in with it.');
})().catch((e) => { console.error(`::error title=Test accounts::${e.message || e}`); process.exit(1); });
