import { randomBytes } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

/**
 * A demo company to try the app with: two stations, fleet managers, drivers, vans, walk-arounds and
 * damage checks in every state. Everything is made up: the people can't sign in, the photos are drawings
 * and no AI was called (model "demo", cost 0).
 */

const db = () => getFirestore();
const bucket = () => getStorage().bucket();
const rid = (n = 8) => randomBytes(n).toString('base64url').replace(/[-_]/g, 'x').slice(0, n);
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function jpeg(svg: string) { return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer(); }
async function put(path: string, buf: Buffer) {
  await bucket().file(path).save(buf, { contentType: 'image/jpeg', resumable: false, metadata: { cacheControl: 'private, max-age=31536000' } });
  return path;
}

/** A walk-around photo: sky, ground, a van side and a label saying it's a demo. */
function walkPhoto(label: string, hue: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,82%)"/><stop offset="0.62" stop-color="hsl(${hue},30%,92%)"/><stop offset="0.62" stop-color="#9a9a96"/><stop offset="1" stop-color="#7d7d79"/></linearGradient></defs>
  <rect width="900" height="1200" fill="url(#g)"/>
  <path d="M120 760 V520 L230 380 Q250 355 285 355 H760 Q790 355 790 385 V760 Z" fill="#f4f5f2" stroke="#33363b" stroke-width="6"/>
  <path d="M175 560 L250 440 H355 V560 Z" fill="#3a4250"/>
  <circle cx="270" cy="770" r="68" fill="#202226"/><circle cx="270" cy="770" r="28" fill="#9da1a8"/>
  <circle cx="660" cy="770" r="68" fill="#202226"/><circle cx="660" cy="770" r="28" fill="#9da1a8"/>
  <rect x="40" y="40" width="820" height="110" rx="14" fill="#000" opacity="0.75"/>
  <text x="70" y="108" font-family="Arial, sans-serif" font-size="44" fill="#E2FF1C" font-weight="bold">DEMO PHOTO</text>
  <text x="70" y="1120" font-family="Arial, sans-serif" font-size="40" fill="#fff">${esc(label)}</text>
</svg>`;
}

type Mark = 'scratch' | 'scuff' | 'dent' | 'none';
/** A close-up of paint, with a mark on it and optionally the yellow box the app draws. */
function panelPhoto(w: number, h: number, mark: Mark, boxed: boolean, label: string) {
  const cx = w * 0.5, cy = h * 0.5;
  const marks: Record<Mark, string> = {
    scratch: `<path d="M${cx - w * 0.14} ${cy + h * 0.05} Q${cx} ${cy - h * 0.02} ${cx + w * 0.15} ${cy - h * 0.06}" stroke="#4a4d52" stroke-width="${w / 160}" fill="none" stroke-linecap="round"/>`,
    scuff: `<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.12}" ry="${h * 0.05}" fill="#8f8a80" opacity="0.55"/>`,
    dent: `<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.08}" ry="${h * 0.07}" fill="url(#dent)"/>`,
    none: '',
  };
  const bx = cx - w * 0.18, by = cy - h * 0.14, bw = w * 0.36, bh = h * 0.28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9ecee"/><stop offset="0.5" stop-color="#fbfcfc"/><stop offset="1" stop-color="#d9dde0"/></linearGradient>
    <radialGradient id="dent"><stop offset="0" stop-color="#9aa0a6"/><stop offset="0.7" stop-color="#dfe3e6"/><stop offset="1" stop-color="#f6f7f8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#p)"/>
  <path d="M0 ${h * 0.82} H${w}" stroke="#c8ccd0" stroke-width="${w / 120}"/>
  ${marks[mark]}
  ${boxed ? `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#000" stroke-width="${w / 90}"/><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#E2FF1C" stroke-width="${w / 200}"/>` : ''}
  <rect x="${w * 0.04}" y="${h * 0.04}" width="${w * 0.5}" height="${h * 0.1}" rx="8" fill="#000" opacity="0.7"/>
  <text x="${w * 0.07}" y="${h * 0.11}" font-family="Arial, sans-serif" font-size="${h * 0.05}" fill="#E2FF1C" font-weight="bold">DEMO PHOTO</text>
  <text x="${w * 0.05}" y="${h * 0.95}" font-family="Arial, sans-serif" font-size="${h * 0.04}" fill="#555">${esc(label)}</text>
</svg>`;
}

const STATIONS = [{ name: 'Berlin Spandau', code: 'DBE1' }, { name: 'Potsdam', code: 'DBE5' }];
const MANAGERS = [['Jana', 'Becker', 0], ['Tomasz', 'Nowak', 1]] as const;
const DRIVERS = [
  ['Ali', 'Yilmaz', 0], ['Sofia', 'Rossi', 0], ['Lukas', 'Schmidt', 0], ['Mihai', 'Popescu', 0],
  ['Fatima', 'Haddad', 1], ['Jonas', 'Weber', 1], ['Elena', 'Petrova', 1], ['David', 'Kowalski', 1],
] as const;
type Attrs = { roof: string; slideL: string; slideR: string; rear: string };
const VANS: [string, string, string, number, string, string, Attrs][] = [
  ['eSprinter 01', 'B-DS 101', 'large_van', 0, 'Mercedes-Benz', 'eSprinter', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['eSprinter 02', 'B-DS 102', 'large_van', 0, 'Mercedes-Benz', 'eSprinter', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Transit 03', 'B-DS 103', 'large_van', 0, 'Ford', 'Transit', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Rivian EDV 04', 'B-DS 104', 'step_van', 0, 'Rivian', 'EDV 700', { roof: 'high', slideL: 'no', slideR: 'no', rear: 'roller' }],
  ['Crafter 05', 'B-DS 105', 'large_van', 0, 'Volkswagen', 'Crafter', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Sprinter XL 06', 'B-DS 106', 'large_van_long', 0, 'Mercedes-Benz', 'Sprinter L3', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Ducato 11', 'P-DS 201', 'large_van', 1, 'Fiat', 'Ducato', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Master 12', 'P-DS 202', 'large_van_long', 1, 'Renault', 'Master L4', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Transit Custom 13', 'P-DS 203', 'midsize_van', 1, 'Ford', 'Transit Custom', { roof: 'low', slideL: 'no', slideR: 'yes', rear: 'barn' }],
  ['Berlingo 14', 'P-DS 204', 'compact_van', 1, 'Citroën', 'Berlingo', { roof: 'low', slideL: 'yes', slideR: 'yes', rear: 'barn' }],
  ['Box van 15', 'P-DS 205', 'box_truck', 1, 'Ford', 'Transit Luton', { roof: 'high', slideL: 'no', slideR: 'no', rear: 'roller' }],
  ['eSprinter 16', 'P-DS 206', 'large_van', 1, 'Mercedes-Benz', 'eSprinter', { roof: 'high', slideL: 'no', slideR: 'yes', rear: 'barn' }],
];
const FRAMES = ['Front', 'Front left corner', 'Left side', 'Rear left corner', 'Rear', 'Rear right corner', 'Right side', 'Front right corner'];
const usage = (ms: number, calls: number, images: number) => ({ ms, calls, images, inTok: 0, outTok: 0, cost: 0 });

const DEMO_VERSION = 2;
const password = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(10), (b) => a[b % a.length]).join('');
};

/** Makes (or reopens) the person's demo company. An older demo without logins and history is replaced. */
export async function createDemo(uid: string, ownerName: string, email: string, fresh = false): Promise<{ orgId: string; existed: boolean }> {
  const uref = db().doc(`users/${uid}`);
  const prev = (await uref.get()).data()?.demoOrgId as string | undefined;
  if (prev) {
    const o = await db().doc(`orgs/${prev}`).get();
    if (o.exists && !fresh && (o.data()?.demoVersion || 1) >= DEMO_VERSION) {
      await uref.set({ orgIds: FieldValue.arrayUnion(prev), orgId: prev }, { merge: true });
      return { orgId: prev, existed: true };
    }
    if (o.exists) await deleteDemo(prev);
  }
  const org = db().collection('orgs').doc();
  const orgId = org.id;
  const now = Date.now();
  const day = 86400_000;
  const batch = db().batch();
  const short = orgId.slice(0, 6).toLowerCase();
  batch.set(org.collection('members').doc(uid), { role: 'owner', stationIds: [], email, name: ownerName, joinedAt: now });

  const stationIds = STATIONS.map((st, i) => {
    const ref = org.collection('stations').doc();
    batch.set(ref, { name: st.name, code: st.code, createdAt: now + i });
    return ref.id;
  });
  const person = (first: string, last: string, role: string, st: number, n: number) => {
    const id = `demo-${rid(10)}`;
    batch.set(org.collection('members').doc(id), {
      role, stationIds: [stationIds[st]], name: `${first} ${last}`, firstName: first, lastName: last,
      email: `${first}.${last}@example.com`.toLowerCase(), phone: `+49 151 0000 ${String(100 + n).padStart(4, '0')}`,
      transporterId: role === 'driver' ? `DEMO${rid(8).toUpperCase()}` : '', joinedAt: now - (30 - n) * day, demo: true,
    });
    return { id, name: `${first} ${last}` };
  };
  const managers = MANAGERS.map(([f, l, st], n) => person(f, l, 'manager', st, n));
  const drivers: { id: string; name: string; st: number }[] = DRIVERS.map(([f, l, st], n) => ({ ...person(f, l, 'driver', st, n + 10), st }));

  // Two accounts you can really sign in with: a driver and a fleet manager at Berlin Spandau.
  const logins: { role: string; name: string; email: string; password: string; uid: string }[] = [];
  for (const [role, first, last] of [['driver', 'Alex', 'Demo'], ['manager', 'Morgan', 'Demo']] as const) {
    const em = `demo.${role}.${short}@example.com`;
    const pw = password();
    const u = await getAuth().createUser({ email: em, password: pw, displayName: `${first} ${last}` });
    batch.set(org.collection('members').doc(u.uid), {
      role, stationIds: [stationIds[0]], name: `${first} ${last}`, firstName: first, lastName: last, email: em,
      phone: role === 'driver' ? '+49 151 0000 0199' : '+49 151 0000 0198', transporterId: role === 'driver' ? `DEMO${rid(8).toUpperCase()}` : '',
      joinedAt: now - 20 * day, demo: true, login: true,
    });
    batch.set(db().doc(`users/${u.uid}`), { orgIds: [orgId], orgId, email: em, name: `${first} ${last}`, demo: true });
    logins.push({ role, name: `${first} ${last}`, email: em, password: pw, uid: u.uid });
    if (role === 'driver') drivers.push({ id: u.uid, name: `${first} ${last}`, st: 0 });
  }
  batch.set(org, { name: 'Demo DSP (test data)', createdBy: uid, createdAt: now, stationsReady: true, demo: true, demoVersion: DEMO_VERSION, aiTier: 'default', demoLogins: logins });

  const vans = VANS.map(([name, plate, cls, st, make, model, a], n) => {
    const ref = org.collection('vehicles').doc();
    batch.set(ref, { name, plate, cls, ...a, make, model, scanId: null, stationId: stationIds[st], createdAt: now - (60 - n) * day, createdBy: uid, demo: true });
    return { id: ref.id, name, cls, st };
  });
  // A month of assignments: in each 4-day block every driver of a station has a different van of that
  // station, so nobody has two vans at once. The last block is still running.
  const BLOCKS = 7, BLOCK = 4 * day;
  const blockStart = (b: number) => (b === BLOCKS - 1 ? now - 3 * 3600_000 : now - 3 * 3600_000 - (BLOCKS - 1 - b) * BLOCK);
  const schedule: { van: number; driver: { id: string; name: string }; start: number; end: number | null }[] = [];
  STATIONS.forEach((_, st) => {
    const sv = vans.map((v, i) => ({ v, i })).filter((x) => x.v.st === st);
    const sd = drivers.filter((d) => d.st === st);
    for (let b = 0; b < BLOCKS; b++) {
      sd.forEach((d, k) => {
        const van = sv[(k + b) % sv.length];
        schedule.push({ van: van.i, driver: d, start: blockStart(b) + k * 600_000, end: b === BLOCKS - 1 ? null : blockStart(b + 1) - 3600_000 });
      });
    }
  });
  const mgrOf = (st: number) => managers[st];
  // The first station switched to drivers picking up their vans themselves (with photos) when the current block
  // started; before that, and at the second station, the fleet manager handed them out.
  const selfFrom = blockStart(BLOCKS - 1) - 3600_000;
  batch.update(org.collection('stations').doc(stationIds[0]), { selfAssign: true, selfAssignBy: mgrOf(0).name, selfAssignAt: selfFrom });
  const pickups: { ref: FirebaseFirestore.DocumentReference; van: number; driver: { id: string; name: string }; at: number }[] = [];
  schedule.forEach((a) => {
    const van = vans[a.van];
    const ref = org.collection('assignments').doc();
    const self = van.st === 0 && a.start > selfFrom;
    const by = self ? a.driver : mgrOf(van.st);
    batch.set(ref, {
      vehicleId: van.id, vehicleName: van.name, plate: VANS[a.van][1], driverId: a.driver.id, driverName: a.driver.name, stationId: stationIds[van.st],
      start: a.start, end: a.end, startedBy: by.id, startedByName: by.name, endedBy: a.end ? by.id : null, endedByName: a.end ? by.name : null,
      endReason: a.end ? 'ended' : null, createdAt: a.start, startWalkId: null, endWalkId: null, demo: true,
    });
    if (self) pickups.push({ ref, van: a.van, driver: a.driver, at: a.start });
    if (!a.end) batch.update(org.collection('vehicles').doc(van.id), { assignedTo: { assignmentId: ref.id, driverId: a.driver.id, driverName: a.driver.name, since: a.start } });
  });
  /** Who had this van at this time (for walk-arounds and checks). */
  const driverAt = (vanIdx: number, t: number) => schedule.find((a) => a.van === vanIdx && a.start <= t && (a.end == null || t < a.end))?.driver
    || drivers.find((d) => d.st === vans[vanIdx].st)!;
  await batch.commit();

  // Walk-arounds with drawn photos for four vans.
  const walk = async (van: typeof vans[number], by: { id: string; name: string }, when: number) => {
    const ref = org.collection('walkarounds').doc();
    const photos = await Promise.all(FRAMES.map(async (label, i) => ({
      n: i + 1, label, w: 900, h: 1200, takenAt: when + i * 12_000,
      path: await put(`orgs/${orgId}/walkarounds/${ref.id}/${String(i + 1).padStart(2, '0')}.jpg`, await jpeg(walkPhoto(`${van.name}, ${label}`, 200 + i * 7))),
    })));
    await ref.set({ vehicleId: van.id, vehicleName: van.name, cls: van.cls, stationId: stationIds[van.st], source: 'camera', createdAt: when,
      createdBy: by.id, totalMs: 8 * 14_000, frames: 8, taken: 8, skipped: 0, retakes: 1, photos, demo: true });
    return ref.id;
  };
  const T1 = now - 2 * 3600_000, T2 = now - 2 * day, T3 = now - 40 * 60_000, T4 = now - 5 * day;
  const [w1, w2, w3, w4] = await Promise.all([
    walk(vans[0], driverAt(0, T1), T1), walk(vans[1], driverAt(1, T2), T2),
    walk(vans[6], driverAt(6, T3), T3), walk(vans[3], driverAt(3, T4), T4),
  ]);
  // Pick-up photos for the vans drivers picked up themselves.
  await Promise.all(pickups.map(async (p) => {
    const walkId = await walk(vans[p.van], p.driver, p.at - 8 * 60_000);
    await Promise.all([p.ref.update({ startWalkId: walkId }), org.collection('walkarounds').doc(walkId).update({ handover: { kind: 'pickup', assignmentId: p.ref.id } })]);
  }));

  // Damage checks in every state.
  const spot = async (checkId: string, i: number, panel: string, type: string, mark: Mark, conf: number, mightBe: string | null,
    verdict: null | { v: string; reason: string; severity?: string }, photo: number) => {
    const refPath = await put(`orgs/${orgId}/checks/${checkId}/ref${i + 1}.jpg`, await jpeg(panelPhoto(960, 720, mark, true, `${panel}, from the walk-around`)));
    let closeups: string[] = [], markPath: string | null = null;
    if (verdict) {
      closeups = [await put(`orgs/${orgId}/checks/${checkId}/spot${i + 1}_1.jpg`, await jpeg(panelPhoto(900, 1200, verdict.v === 'dirt' || verdict.v === 'reflection' ? 'none' : mark, false, `${panel}, close-up`)))];
      if (verdict.v === 'damage') markPath = await put(`orgs/${orgId}/checks/${checkId}/mark${i + 1}.jpg`, await jpeg(panelPhoto(900, 1200, mark, true, `${panel}, close-up`)));
    }
    return {
      photo, photoLabel: FRAMES[photo], box: [0.42, 0.4, 0.58, 0.52], panel, type, sizeCm: type === 'dent' ? 3 : 6, conf, mightBe, closeup: 'Stand level with the spot, about half a metre away.',
      refPath, closeups, markPath, feedback: null,
      verdict: verdict ? { verdict: verdict.v, type: verdict.v === 'damage' ? type : null, sizeCm: verdict.v === 'damage' ? (type === 'dent' ? 3 : 6) : null,
        severity: verdict.v === 'damage' ? verdict.severity || 'cosmetic' : null, confidence: 0.8, reason: verdict.reason, ms: 6400, closeupBox: null } : null,
    };
  };
  const check = async (van: typeof vans[number], walkId: string, by: { id: string; name: string }, when: number, status: string,
    make: (id: string) => Promise<unknown[]>, review: unknown = null, note = '') => {
    const ref = org.collection('checks').doc();
    const spots = await make(ref.id);
    const withCloseups = (spots as { closeups: string[] }[]).filter((p) => p.closeups.length).length;
    await ref.set({
      vehicleId: van.id, vehicleName: van.name, cls: van.cls, walkId, stationId: stationIds[van.st], createdAt: when, createdBy: by.id, createdByName: by.name,
      status, submittedAt: status === 'checking' ? null : when + 6 * 60_000, review, reviewedAt: status === 'reviewed' ? when + 3 * 3600_000 : null,
      tier: 'default', model: 'demo', photos: 8, pass1: usage(38_000, 1, 8), pass2: withCloseups ? usage(withCloseups * 6400, withCloseups, withCloseups * 2) : null,
      spots, notVisible: ['roof: too high to see'], missedNote: note, demo: true,
    });
  };
  const decided = (by: typeof managers[number], at: number, d: Record<string, boolean>, manual: unknown[] = []) => ({
    decisions: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { damage: v, note: '', by: by.id, byName: by.name, at }])),
    manual, by: by.id, byName: by.name, at,
  });
  await Promise.all([
    // Waiting for the manager at Berlin Spandau.
    check(vans[0], w1, driverAt(0, T1), T1, 'submitted', async (id) => Promise.all([
      spot(id, 0, 'right sliding door', 'scratch', 'scratch', 0.74, null, { v: 'damage', reason: 'A 6 cm scratch through the clear coat, visible in the close-up.' }, 6),
      spot(id, 1, 'front bumper, left corner', 'scuff', 'scuff', 0.41, 'dirt', { v: 'dirt', reason: 'The mark is gone in the close-up: road dirt.' }, 1),
      spot(id, 2, 'rear doors, lower edge', 'dent', 'dent', 0.33, null, null, 4),
    ]), null, 'Small crack in the right mirror glass'),
    // The driver is still at the van in Potsdam.
    check(vans[6], w3, driverAt(6, T3), T3, 'checking', async (id) => Promise.all([
      spot(id, 0, 'left front wing', 'scratch', 'scratch', 0.66, null, null, 1),
      spot(id, 1, 'rear bumper', 'scuff', 'scuff', 0.38, 'reflection', null, 4),
    ])),
    // Reviewed: damage approved, one added by the manager.
    check(vans[1], w2, driverAt(1, T2), T2, 'reviewed', async (id) => Promise.all([
      spot(id, 0, 'rear bumper, right corner', 'scratch', 'scratch', 0.81, null, { v: 'damage', reason: 'A scratch along the bumper corner, about 6 cm.', severity: 'repair' }, 5),
      spot(id, 1, 'left side panel', 'scuff', 'scuff', 0.35, 'reflection', { v: 'reflection', reason: 'The light patch moves between the photos: a reflection.' }, 2),
    ]), decided(managers[0], now - 2 * day + 3 * 3600_000, { 0: true, 1: false },
      [{ panel: 'right mirror cover', type: 'crack', note: 'Hairline crack, about 4 cm', by: managers[0].id, byName: managers[0].name, at: now - 2 * day + 3 * 3600_000 }])),
    // Reviewed: nothing was damage.
    check(vans[3], w4, driverAt(3, T4), T4, 'reviewed', async (id) => Promise.all([
      spot(id, 0, 'roller door', 'scuff', 'scuff', 0.29, 'dirt', { v: 'dirt', reason: 'Dust on the shutter; wiped off.' }, 4),
    ]), decided(managers[0], now - 5 * day + 2 * 3600_000, { 0: false })),
  ]);

  await uref.set({ orgIds: FieldValue.arrayUnion(orgId), orgId, demoOrgId: orgId }, { merge: true });
  return { orgId, existed: false };
}

/** Removes a demo company completely: data, photos, invite links, and the link from people's accounts. */
export async function deleteDemo(orgId: string) {
  const org = db().doc(`orgs/${orgId}`);
  const logins = ((await org.get()).data()?.demoLogins || []) as { uid: string }[];
  for (const l of logins) {
    await getAuth().deleteUser(l.uid).catch(() => {});
    await db().doc(`users/${l.uid}`).delete().catch(() => {});
  }
  const users = await db().collection('users').where('orgIds', 'array-contains', orgId).get();
  const invites = await db().collection('invites').where('orgId', '==', orgId).get();
  const batch = db().batch();
  users.docs.forEach((u) => batch.update(u.ref, { orgIds: FieldValue.arrayRemove(orgId), ...(u.data().demoOrgId === orgId ? { demoOrgId: FieldValue.delete() } : {}) }));
  invites.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await db().recursiveDelete(org);
  await bucket().deleteFiles({ prefix: `orgs/${orgId}/` }).catch(() => {});
}
