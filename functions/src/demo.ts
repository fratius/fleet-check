import { randomBytes } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

import { damageLogFor, modelOf, tourNumbers, type TourEnd } from './fleetlog';
import { cardDigits, purchaseFlags, said, type BuyKind, type Receipt } from './purchases';

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
/**
 * Made-up fleet records for the demo vans: the van's facts (everyone at the station sees them) and its contract,
 * insurance and deadlines (owners and managers). Deadlines are spread so some are overdue or due soon.
 */
const WMI: Record<string, string> = { 'Mercedes-Benz': 'W1V', Ford: 'WF0', Rivian: '7FC', Volkswagen: 'WV1', Fiat: 'ZFA', Renault: 'VF1', 'Citroën': 'VF7' };
const day0 = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Made-up fuel use per 100 km by model (litres, or kWh for the electric ones) and the tank size in litres. */
const USE: Record<string, [number, number | null]> = {
  eSprinter: [29, null], 'EDV 700': [33, null], Transit: [10.8, 80], Crafter: [10.2, 75], 'Sprinter L3': [11.5, 93],
  Ducato: [10.4, 90], 'Master L4': [11.8, 80], 'Transit Custom': [8.6, 70], Berlingo: [6.8, 50], 'Transit Luton': [13.5, 80],
};
function demoFacts(n: number, make: string, model: string, cls: string) {
  const ev = /eSprinter|Rivian/.test(model);
  const tall = cls === 'box_truck' || cls === 'step_van' ? 3.3 : cls === 'midsize_van' ? 2.0 : cls === 'compact_van' ? 1.85 : 2.72;
  return {
    vin: `${WMI[make] || 'WDB'}9${String(70000 + n * 137).padStart(5, '0')}P${String(431208 + n * 911).slice(0, 6)}`.slice(0, 17),
    firstReg: `${2022 + (n % 3)}-${String(1 + ((n * 5) % 12)).padStart(2, '0')}-15`, modelYear: 2022 + (n % 3),
    color: n % 4 === 3 ? 'Silver' : 'White', fuel: ev ? 'electric' : 'diesel', tankL: ev ? null : USE[model]?.[1] ?? 80, gearbox: ev || n % 2 ? 'automatic' : 'manual',
    powerKw: ev ? 150 : 120, batteryKwh: ev ? 113 : null, rangeKm: ev ? 400 : null, branded: n % 3 !== 2, keys: 2,
    heightM: tall, lengthM: cls === 'large_van_long' ? 6.97 : cls === 'compact_van' ? 4.4 : cls === 'midsize_van' ? 5.05 : 5.93,
    grossKg: cls === 'compact_van' ? 2300 : 3500, payloadKg: cls === 'compact_van' ? 800 : ev ? 900 : 1200,
    cargoM3: cls === 'large_van_long' ? 15.5 : cls === 'compact_van' ? 3.8 : cls === 'midsize_van' ? 6 : 11,
    tyreSize: cls === 'compact_van' ? '205/60 R16' : '235/65 R16 C',
    breakdownPhone: '+49 800 555 0100', insurer: 'Hansa Fleet Insurance (made up)', policyNo: `HF-${48210 + n}`, claimsPhone: '+49 30 555 0199',
  };
}
function demoDetails(n: number, now: number) {
  const D = 86400_000;
  // Spread the deadlines: one inspection overdue, a service and a safety check soon, a lease ending.
  const off = (d: number) => day0(now + d * D);
  const leased = n % 4 !== 3;
  return {
    ownership: leased ? 'leased' : 'owned', provider: leased ? 'Nordlicht Fleet Leasing (made up)' : null, contractNo: leased ? `NFL-2024-${3100 + n}` : null,
    start: off(-400 - n * 20), end: leased ? off(n === 2 ? 75 : 700 + n * 30) : null,
    kmPerYear: leased ? 40000 : null, kmAtStart: leased ? 12 : null,
    included: leased ? ['maintenance', 'tyres'] : [], contact: leased ? 'Fleet desk, +49 40 555 0144' : null,
    returnNotes: leased ? 'Return washed, with both keys and the service book. Damage over 2 cm is charged.' : null,
    coverage: 'full', insuranceRenewal: off(n === 5 ? 25 : 120 + n * 9),
    odometerKm: 38000 + n * 4100 + (n === 1 ? 9000 : 0), odometerAt: off(-3),
    due: {
      hu: off(n === 0 ? -10 : 200 + n * 23), uvv: off(n === 3 ? 20 : 150 + n * 11), service: off(n === 1 ? 12 : 90 + n * 14),
      serviceKm: 60000 + n * 5000, tyres: off(n === 4 ? 9 : 160), tax: off(240 + n * 7),
    },
    fuelCard: n % 4 === 3 ? 'Shell card ending 4471' : 'DKV card ending 20' + String(10 + n), notes: n === 0 ? 'Rear door seal replaced in spring.' : null,
  };
}

/** What each demo van costs (owners only). */
function demoCosts(n: number, now: number) {
  const leased = n % 4 !== 3;
  return { createdAt: now, updatedAt: now, updatedByName: 'Demo', monthly: leased ? 690 + n * 15 : null, excessPerKm: leased ? 0.08 : null,
    purchasePrice: leased ? null : 41500, deductible: 1000, premium: 2350 + n * 40 };
}

const FRAMES = ['Front', 'Front left corner', 'Left side', 'Rear left corner', 'Rear', 'Rear right corner', 'Right side', 'Front right corner'];
const usage = (ms: number, calls: number, images: number) => ({ ms, calls, images, inTok: 0, outTok: 0, cost: 0 });

const DEMO_VERSION = 6;
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
  batch.set(org, { name: 'Demo DSP (test data)', createdBy: uid, createdAt: now, stationsReady: true, demo: true, demoVersion: DEMO_VERSION, aiTier: 'default', demoLogins: logins,
    dashScans: true, dashScansBy: ownerName, dashScansAt: now - 30 * day, licenceCheckMonths: 6 });

  const vans = VANS.map(([name, plate, cls, st, make, model, a], n) => {
    const ref = org.collection('vehicles').doc();
    batch.set(ref, { name, plate, cls, ...a, make, model, scanId: null, stationId: stationIds[st], createdAt: now - (60 - n) * day, createdBy: uid, demo: true, ...demoFacts(n, make, model, cls) });
    batch.set(org.collection('vehicleDetails').doc(ref.id), { stationId: stationIds[st], createdAt: now - (60 - n) * day, updatedAt: now, updatedByName: 'Demo', ...demoDetails(n, now) });
    batch.set(org.collection('vehicleCosts').doc(ref.id), demoCosts(n, now));
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
        severity: verdict.v === 'damage' ? verdict.severity || 'cosmetic' : null, confidence: 0.8, reason: verdict.reason, closeupBox: null } : null,
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
      tier: 'default', model: 'demo', photos: 8, spots, notVisible: ['roof: too high to see'], missedNote: note, demo: true,
    });
    // Speed and cost go where only the app creator reads them (checkUsage), like real checks.
    await org.collection('checkUsage').doc(ref.id).set({
      checkId: ref.id, stationId: stationIds[van.st], createdAt: when, tier: 'default', model: 'demo',
      pass1: usage(38_000, 1, 8), pass2: withCloseups ? usage(withCloseups * 6400, withCloseups, withCloseups * 2) : null,
      serverMs: 41_000, prepMs: 3_000, spotMs: Object.fromEntries((spots as { closeups: string[] }[]).map((p, j) => [j, p.closeups.length ? 6400 : null]).filter(([, v]) => v != null)),
    });
    return ref.id;
  };
  /** A manager's decisions; `known` links a damage seen again to the one already on the van's record. */
  const decided = (by: typeof managers[number], at: number, d: Record<string, boolean>, manual: unknown[] = [], known: Record<string, string> = {}, notes: Record<string, string> = {}) => ({
    decisions: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { damage: v, note: notes[k] || '', by: by.id, byName: by.name, at, known: known[k] || null }])),
    manual, by: by.id, byName: by.name, at,
  });
  // A damage history for eSprinter 02: photos eight days ago without damage, a check five days ago that found a
  // dent and a scuff, and the check two days ago that found the dent again plus new damage.
  const T5 = now - 8 * day, T6 = now - 5 * day + 2 * 3600_000;
  const [w5, w6] = await Promise.all([walk(vans[1], driverAt(1, T5), T5), walk(vans[1], driverAt(1, T6), T6)]);
  void w5;
  const c1 = await check(vans[1], w6, driverAt(1, T6), T6, 'reviewed', async (id) => Promise.all([
    spot(id, 0, 'right sliding door', 'dent', 'dent', 0.78, null, { v: 'damage', reason: 'A shallow dent about 3 cm across, the paint is not broken.', severity: 'repair' }, 6),
    spot(id, 1, 'front bumper, left corner', 'scuff', 'scuff', 0.62, null, { v: 'damage', reason: 'Scuffed plastic on the bumper corner, about 6 cm.', severity: 'cosmetic' }, 1),
  ]), decided(managers[0], T6 + 3 * 3600_000, { 0: true, 1: true }, [], {}, { 0: 'Driver reported it at drop-off.' }));
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
      spot(id, 2, 'right sliding door', 'dent', 'dent', 0.74, null, { v: 'damage', reason: 'A shallow dent about 3 cm across.', severity: 'repair' }, 6),
    ]), decided(managers[0], now - 2 * day + 3 * 3600_000, { 0: true, 1: false, 2: true },
      [{ panel: 'right mirror cover', type: 'crack', note: 'Hairline crack, about 4 cm', by: managers[0].id, byName: managers[0].name, at: now - 2 * day + 3 * 3600_000, known: null }],
      { 2: `${c1}:0` })).then(async (c2) => {
      // Comments by the station's manager.
      const notes: [string, string, number][] = [
        [`${c1}:0`, 'Asked the driver: a cage trolley rolled into the door at the loading dock.', T6 + 4 * 3600_000],
        [`${c1}:0`, 'Seen again two days ago, no bigger. Repair together with the bumper.', now - 2 * day + 4 * 3600_000],
        [`${c2}:0`, 'Bodyshop quote 240 EUR for the bumper corner. Booked for next Tuesday.', now - 2 * day + 5 * 3600_000],
      ];
      await Promise.all(notes.map(([key, text, at]) => org.collection('damageNotes').doc().set({
        vehicleId: vans[1].id, stationId: stationIds[vans[1].st], damageKey: key, text, by: managers[0].id, byName: managers[0].name, createdAt: at,
      })));
    }),
    // Reviewed: nothing was damage.
    check(vans[3], w4, driverAt(3, T4), T4, 'reviewed', async (id) => Promise.all([
      spot(id, 0, 'roller door', 'scuff', 'scuff', 0.29, 'dirt', { v: 'dirt', reason: 'Dust on the shutter; wiped off.' }, 4),
    ]), decided(managers[0], now - 5 * day + 2 * 3600_000, { 0: false })),
  ]);

  // Three more damages found over the month, each between two walk-arounds, so the driver numbers have some.
  const more: [number, number, number, string, string, Mark][] = [[2, 20, 16, 'rear doors, lower edge', 'dent', 'dent'], [7, 12, 9, 'left side panel', 'scratch', 'scratch'], [5, 26, 22, 'rear bumper, left corner', 'scuff', 'scuff']];
  await Promise.all(more.map(async ([vi, before, after, panel, type, mark]) => {
    const van = vans[vi];
    const tb = now - before * day + 7 * 3600_000, ta = now - after * day + 16 * 3600_000;
    await walk(van, driverAt(vi, tb), tb);
    const wa = await walk(van, driverAt(vi, ta), ta);
    const mgr = managers[van.st];
    await check(van, wa, driverAt(vi, ta), ta, 'reviewed', async (id) => Promise.all([
      spot(id, 0, panel, type, mark, 0.77, null, { v: 'damage', reason: `A ${type} on the ${panel}, about ${type === 'dent' ? 3 : 6} cm.`, severity: type === 'dent' ? 'repair' : 'cosmetic' }, 4),
    ]), decided(mgr, ta + 2 * 3600_000, { 0: true }, vi === 5 ? [{ panel: 'left mirror glass', type: 'crack', note: 'Cracked across', by: mgr.id, byName: mgr.name, at: ta + 2 * 3600_000, known: null }] : []));
  }));
  // Who had the van when each damage could have happened (what the app writes after every review).
  const reviewed = await org.collection('checks').where('status', '==', 'reviewed').get();
  await Promise.all(reviewed.docs.map((d) => damageLogFor(orgId, d.id)));

  const demoVans = vans.map((v, i) => ({ ...v, n: i, make: VANS[i][4], model: VANS[i][5], plate: VANS[i][1], stationId: stationIds[v.st] }));
  const { fills, dieselPath } = await demoTours(org, orgId, now, demoVans, schedule, drivers);
  const cards = new Map(demoVans.map((v) => [v.id, cardDigits(demoDetails(v.n, now).fuelCard)]));
  const current = (vanId: string) => { const i = vans.findIndex((v) => v.id === vanId); return schedule.find((a) => a.van === i && a.end == null)?.driver || null; };
  await demoBuys(org, orgId, now, fills, dieselPath, managers, cards, current, demoVans);
  await demoPeople(org, now, drivers, managers, vans, stationIds, schedule);

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

/** Firestore batches of up to 400 writes, committed as they fill up. */
function writer() {
  let b = db().batch(), n = 0;
  const done: Promise<unknown>[] = [];
  const next = () => { if (++n % 400 === 0) { done.push(b.commit()); b = db().batch(); } };
  return {
    set(ref: FirebaseFirestore.DocumentReference, data: object, merge = false) { if (merge) b.set(ref, data, { merge: true }); else b.set(ref, data); next(); },
    async flush() { done.push(b.commit()); await Promise.all(done); },
  };
}

/** A dashboard photo for the demo: a drawn instrument cluster with the odometer and a fuel or battery gauge. */
function dashPhoto(ev: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#15171a"/>
  <circle cx="330" cy="400" r="230" fill="#0b0c0e" stroke="#3a3f47" stroke-width="10"/><circle cx="870" cy="400" r="230" fill="#0b0c0e" stroke="#3a3f47" stroke-width="10"/>
  <path d="M175 520 A200 200 0 1 1 485 520" stroke="#e8e8e8" stroke-width="8" fill="none"/><path d="M715 520 A200 200 0 1 1 1025 520" stroke="#e8e8e8" stroke-width="8" fill="none"/>
  <line x1="330" y1="400" x2="250" y2="270" stroke="#ff4d2e" stroke-width="10" stroke-linecap="round"/><line x1="870" y1="400" x2="980" y2="300" stroke="#ff4d2e" stroke-width="10" stroke-linecap="round"/>
  <rect x="470" y="600" width="260" height="70" rx="8" fill="#0b0c0e" stroke="#3a3f47" stroke-width="4"/>
  <text x="600" y="648" font-family="Arial, sans-serif" font-size="40" fill="#9ef0ff" text-anchor="middle">048213 km</text>
  <text x="870" y="470" font-family="Arial, sans-serif" font-size="34" fill="#e8e8e8" text-anchor="middle">${ev ? 'BATTERY %' : 'E  ½  F'}</text>
  <rect x="40" y="40" width="460" height="90" rx="12" fill="#000" opacity="0.75"/>
  <text x="70" y="100" font-family="Arial, sans-serif" font-size="44" fill="#E2FF1C" font-weight="bold">DEMO PHOTO</text>
</svg>`;
}

type DemoVan = { id: string; name: string; cls: string; st: number; n: number; make: string; model: string; plate: string; stationId: string };
type Slot = { van: number; driver: { id: string; name: string }; start: number; end: number | null };
/** How each made-up driver drives: fuel use against the van's usual (1.17 = 17% more). */
const STYLE: Record<string, number> = { 'Lukas Schmidt': 1.17, 'Sofia Rossi': 0.93, 'Elena Petrova': 1.09, 'Mihai Popescu': 1.02, 'Jonas Weber': 1.04, 'Fatima Haddad': 0.97, 'David Kowalski': 0.99 };

/**
 * A month of tours from dashboard photos: on each working day the driver who has a van takes it out around 7:30 and
 * back around 17:00, 90 to 160 km. Diesel gauges are read to a sixteenth of a tank, like the AI would; electric
 * vans are charged at the depot overnight. A few tours have no end photo, a few refuels have no receipt, and some
 * vans show warning lights.
 */
type Fill = { van: DemoVan; driver: { id: string; name: string }; at: number; odo: number; fuelPct: number; litres: number; tank: number };
async function demoTours(org: FirebaseFirestore.DocumentReference, orgId: string, now: number, vans: DemoVan[], schedule: Slot[], drivers: { id: string; name: string; st: number }[]) {
  const day = 86400_000;
  const fills: Fill[] = [];
  const [dieselPath, evPath] = await Promise.all([
    put(`orgs/${orgId}/dash/demo/diesel.jpg`, await jpeg(dashPhoto(false))), put(`orgs/${orgId}/dash/demo/electric.jpg`, await jpeg(dashPhoto(true))),
  ]);
  // A repeatable "random" so the demo looks the same each time it's made.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const w = writer();
  const startOf = (t: number) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  for (const van of vans) {
    const [use, tank] = USE[van.model] || [10, 80];
    const ev = tank == null;
    const battery = 113;
    const slots = schedule.filter((x) => x.van === van.n).sort((a, b) => a.start - b.start);
    // Plan the van's tours first, then drive them in order.
    const plan: { slot: Slot; start: number; end: number | null }[] = [];
    for (const slot of slots) {
      for (let d0 = startOf(slot.start); d0 < (slot.end ?? now); d0 += day) {
        if (new Date(d0).getUTCDay() === 0) continue;
        const start = d0 + 5.5 * 3600_000 + Math.round(rnd() * 40) * 60_000;
        let end: number | null = d0 + 15 * 3600_000 + Math.round(rnd() * 120) * 60_000;
        if (start < slot.start || start > now) continue;
        if (slot.end != null && end > slot.end) continue;
        if (end > now) end = null; // still out on today's tour
        plan.push({ slot, start, end });
      }
    }
    let odo = 38000 + van.n * 4100 - plan.length * 125;
    let fuel = 70; // true tank level, percent
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const style = STYLE[p.slot.driver.name] ?? 1;
      const km = Math.round((van.st === 0 ? 110 : 95) + rnd() * 50);
      const used = (km * use * style * (0.95 + rnd() * 0.1)) / 100;
      const read = (pct: number) => (ev ? Math.round(pct) : Math.round(pct / 6.25) * 6.25);
      if (ev) fuel = 88 + rnd() * 10; // charged at the depot overnight
      const startPt: TourEnd = { readingId: '', at: p.start, km: odo, fuelPct: ev ? null : read(fuel), batteryPct: ev ? read(fuel) : null, by: p.slot.driver.id, byName: p.slot.driver.name };
      // Diesel: fill up on the way when the tank would get low (the receipt says how much; one in ten has none).
      let refuel: { litres: number | null; kwh: number | null; unknown: boolean } = { litres: null, kwh: null, unknown: false };
      const usedPct = (used / (ev ? battery : tank!)) * 100;
      let endTrue = fuel - usedPct;
      if (!ev && endTrue < 15) {
        const before = fuel - usedPct / 2;
        const litres = Math.round(((100 - before) / 100) * tank! * 10) / 10;
        endTrue = 100 - usedPct / 2;
        refuel = rnd() < 0.1 ? { litres: null, kwh: null, unknown: true } : { litres, kwh: null, unknown: false };
        // The refuel itself, with its receipt (made below), half way through the tour.
        if (p.end != null && refuel.litres) fills.push({ van, driver: p.slot.driver, at: p.start + Math.round((p.end - p.start) / 2), odo: odo + Math.round(km / 2), fuelPct: read(before), litres, tank: tank! });
      }
      odo += km;
      const tref = org.collection('tours').doc();
      const r1 = org.collection('readings').doc();
      startPt.readingId = r1.id;
      const warnings: string[] = [];
      const recent = now - p.start < 3 * day;
      if (van.name === 'Ducato 11' && recent) warnings.push('Check engine');
      if (van.name === 'Master 12' && now - p.start < 7 * day) warnings.push('AdBlue');
      if (rnd() < 0.03) warnings.push('Tyre pressure');
      const reading = (id: FirebaseFirestore.DocumentReference, pt: TourEnd, role: string, extra: object = {}) => w.set(id, {
        vehicleId: van.id, vehicleName: van.name, stationId: van.stationId, by: p.slot.driver.id, byName: p.slot.driver.name, driverId: p.slot.driver.id,
        at: pt.at, createdAt: pt.at, path: ev ? evPath : dieselPath, odometerKm: pt.km, fuelPct: pt.fuelPct, batteryPct: pt.batteryPct,
        rangeKm: ev ? Math.round(((pt.batteryPct || 0) / 100) * 380) : null, warnings, ai: { odometerKm: pt.km, fuelPct: pt.fuelPct, batteryPct: pt.batteryPct, rangeKm: null, warnings, confidence: 0.94 },
        corrected: [], tourId: tref.id, role, demo: true, ...extra,
      });
      reading(r1, startPt, 'start');
      const base = {
        driverId: p.slot.driver.id, driverName: p.slot.driver.name, vehicleId: van.id, vehicleName: van.name, plate: van.plate, stationId: van.stationId,
        model: modelOf(van), cls: van.cls, fuel: ev ? 'electric' : 'diesel', assignmentId: null, start: startPt, warnings, startAt: p.start, createdAt: p.start, demo: true,
      };
      const facts = { fuel: (ev ? 'electric' : 'diesel') as 'electric' | 'diesel', tankL: tank, batteryKwh: battery };
      if (p.end == null) {
        w.set(tref, { ...base, end: null, endedHow: null, refuel: null, km: null, hours: null, used: null, unit: null, per100: null, open: true });
      } else if (rnd() < 0.05 && i < plan.length - 1) {
        // No end photo: the van's next start photo ends it (an estimate, no fuel figure).
        const next = plan[i + 1];
        const endPt: TourEnd = { readingId: '', at: next.start, km: odo, fuelPct: ev ? null : read(endTrue), batteryPct: ev ? read(endTrue) : null, by: next.slot.driver.id, byName: next.slot.driver.name };
        w.set(tref, { ...base, end: endPt, endedHow: 'next', refuel: null, ...tourNumbers(startPt, endPt, 'next', null, facts), open: false });
      } else {
        const r2 = org.collection('readings').doc();
        const endPt: TourEnd = { readingId: r2.id, at: p.end, km: odo, fuelPct: ev ? null : read(endTrue), batteryPct: ev ? read(endTrue) : null, by: p.slot.driver.id, byName: p.slot.driver.name };
        reading(r2, endPt, 'end', { refuel });
        w.set(tref, { ...base, end: endPt, endedHow: 'photo', refuel, ...tourNumbers(startPt, endPt, 'photo', refuel, facts), open: false });
      }
      fuel = Math.max(5, endTrue);
    }
    // The van's odometer in its record follows the last photo.
    w.set(org.collection('vehicleDetails').doc(van.id), { odometerKm: odo, odometerAt: new Date(now).toISOString().slice(0, 10) }, true);
  }
  await w.flush();
  void drivers;
  return { fills, dieselPath };
}

/** A receipt or a photo of parts for the demo: a drawing with the numbers on it. */
function paperPhoto(lines: string[], title: string) {
  const rows = lines.map((l, i) => `<text x="60" y="${260 + i * 56}" font-family="Courier New, monospace" font-size="38" fill="#222">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
  <rect width="800" height="1200" fill="#c9c6bf"/><rect x="30" y="40" width="740" height="1120" fill="#fbfaf6"/>
  <text x="400" y="150" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#222" text-anchor="middle">${esc(title)}</text>
  ${rows}
  <rect x="40" y="1050" width="460" height="90" rx="12" fill="#000" opacity="0.75"/>
  <text x="70" y="1110" font-family="Arial, sans-serif" font-size="44" fill="#E2FF1C" font-weight="bold">DEMO PHOTO</text>
</svg>`;
}

/**
 * Refuels with their receipts (one for each refuel on the tours), some washes, a parts purchase, and the card
 * check in every state: the right card, a wrong one a manager allowed, one refused, and a driver waiting at the
 * pump right now.
 */
async function demoBuys(org: FirebaseFirestore.DocumentReference, orgId: string, now: number, fills: Fill[], dieselPath: string,
  managers: { id: string; name: string }[], vanCards: Map<string, string | null>, current: (vanId: string) => { id: string; name: string } | null, allVans: DemoVan[]) {
  const [receiptPath, washPath, partsPath] = await Promise.all([
    put(`orgs/${orgId}/buys/demo/receipt.jpg`, await jpeg(paperPhoto(['DIESEL      45,20 L', '  x 1,729 EUR/L', '', 'TOTAL       78,15 EUR', '', 'DKV ************2012', '14:05   ' + new Date(now).toISOString().slice(0, 10)], 'ARAL Spandau'))),
    put(`orgs/${orgId}/buys/demo/wash.jpg`, await jpeg(paperPhoto(['WASCHSTRASSE PREMIUM', '', 'TOTAL       14,90 EUR', '', 'DKV ************2012'], 'Car wash'))),
    put(`orgs/${orgId}/buys/demo/parts.jpg`, await jpeg(paperPhoto(['Mirror cover, right', 'for Transit 2019+', '', '1 pc'], 'Parts'))),
  ]);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const PLACES = ['Aral, Berlin-Spandau', 'Shell, Falkensee', 'JET, Potsdam', 'TotalEnergies, Berlin-Staaken', 'Esso, Werder'];
  const w = writer();
  const mgrOf = (v: DemoVan) => managers[v.st] || managers[0];
  const lastOdo = (v: DemoVan) => Math.max(38000 + v.n * 4100, ...fills.filter((f) => f.van.id === v.id).map((f) => f.odo));
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const hm = (t: number) => new Date(t).toISOString().slice(11, 16);
  type Make = {
    kind: BuyKind; van: DemoVan; by: { id: string; name: string }; role: string; at: number; odo: number; fuelPct: number | null; litres: number | null; total: number;
    merchant: string; items: Receipt['items']; status: string; card: 'match' | 'mismatch' | 'missing' | null; read4?: string | null; bank?: boolean;
    decision?: { allow: boolean; by: { id: string; name: string }; note: string } | null; note?: string | null; tank?: number | null; receiptCard?: string | null;
    receiptAt?: number | null; parts?: string[]; cancelled?: string | null;
  };
  const make = (m: Make) => {
    const expected = m.kind === 'parts' ? null : vanCards.get(m.van.id) || null;
    const receipt: Receipt | null = m.status === 'done' ? {
      readable: true, merchant: m.merchant, date: day(m.at), time: hm(m.at), items: m.items, total: m.total, currency: 'EUR',
      cardLast4: m.kind === 'parts' ? null : (m.receiptCard ?? expected), payment: 'card', confidence: 0.93, issue: null,
    } : null;
    const cardAt = m.at + 40_000;
    const read = m.card && m.card !== 'missing' ? { kind: m.bank ? 'bank' : 'fuel', issuer: m.bank ? 'Visa' : 'DKV', last4: m.card === 'match' ? expected : m.read4 || '8812', plate: null, expiry: '12/28' } : null;
    const why = m.card === 'match' ? said('Card ending {last4}.', { last4: expected }) : m.card === 'missing' ? said('{name} has no fuel card for the van.', { name: m.by.name })
      : m.bank ? said('A bank card, not the van\'s fuel card.') : said('Card ending {last4} ({issuer}); this van\'s card ends {expected}.', { last4: read?.last4, issuer: 'DKV', expected });
    const decision = m.decision ? { allow: m.decision.allow, by: m.decision.by.id, byName: m.decision.by.name, at: cardAt + 6 * 60_000, note: m.decision.note } : null;
    const card = { needed: !!expected && m.kind !== 'parts', expected, result: expected ? m.card : null, read: expected ? read : null, tries: 1,
      why: expected ? why.text : null, whyT: expected ? why.t : null, whyV: expected ? why.v : null, expired: false, at: expected ? cardAt : null };
    const flags = m.status === 'done' ? purchaseFlags({
      kind: m.kind, byName: m.by.name, vanFuel: 'diesel', tankL: m.tank ?? null, fuelPct: m.fuelPct, odometerKm: m.odo, lastKm: null, litres: m.litres, total: m.total, createdAt: m.at,
      vanDriverName: null, notTheirVan: false, card: card.needed ? { needed: true, expected, result: card.result, expired: false, plate: null } : null, vanPlate: m.van.plate,
      decision: decision ? { allow: decision.allow, byName: decision.byName } : null, receipt,
    }) : [];
    const doneAt = m.status === 'done' ? m.at + 25 * 60_000 : null;
    w.set(org.collection('purchases').doc(), {
      kind: m.kind, status: m.status, vehicleId: m.van.id, vehicleName: m.van.name, plate: m.van.plate, stationId: m.van.stationId, model: modelOf(m.van),
      vanFuel: m.kind === 'parts' && m.van.model === 'eSprinter' ? 'electric' : 'diesel', tankL: m.tank ?? null, by: m.by.id, byName: m.by.name, role: m.role,
      vanDriverId: m.role === 'driver' ? m.by.id : null, vanDriverName: m.role === 'driver' ? m.by.name : null, notTheirVan: false,
      dash: { path: dieselPath, at: m.at, ai: { odometerKm: m.odo, fuelPct: m.fuelPct, batteryPct: null, rangeKm: null, warnings: [] }, confidence: 0.93, readable: true, issue: null, done: true },
      lastKm: null, card, decision,
      receipt: receipt ? { path: m.kind === 'wash' ? washPath : receiptPath, at: m.receiptAt || m.at + 20 * 60_000, ai: receipt } : null,
      parts: m.parts || [], note: m.note || null, flags, corrected: [],
      odometerKm: m.status === 'done' ? m.odo : null, fuelPct: m.status === 'done' ? m.fuelPct : null, litres: m.status === 'done' ? m.litres : null,
      total: m.status === 'done' ? m.total : null, currency: m.status === 'done' ? 'EUR' : null, merchant: m.status === 'done' ? m.merchant : null,
      cancel: m.status === 'cancelled' ? { by: m.by.id, byName: m.by.name, at: m.at + 9 * 60_000, reason: m.cancelled || null } : null,
      createdAt: m.at, updatedAt: doneAt || m.at + 10 * 60_000, doneAt, demo: true,
    });
  };
  fills.forEach((f, i) => {
    const price = Math.round((1.64 + rnd() * 0.15) * 1000) / 1000;
    // One refuel with more litres than the tank had room for (the manager should ask about it).
    const litres = i === 5 ? Math.round((f.litres + 32) * 10) / 10 : f.litres;
    const total = Math.round(litres * price * 100) / 100;
    const merchant = PLACES[(i * 3 + f.van.n) % PLACES.length];
    const allowed = i === 9;
    const other = [...vanCards.values()].find((x) => x && x !== vanCards.get(f.van.id)) || '9911';
    make({ kind: 'fuel', van: f.van, by: f.driver, role: 'driver', at: f.at, odo: f.odo, fuelPct: f.fuelPct, litres, total, merchant, tank: f.tank,
      items: [{ product: 'diesel', description: 'Diesel', quantity: litres, unit: 'l', unitPrice: price, total }], status: 'done',
      card: allowed ? 'mismatch' : 'match', read4: allowed ? other : null, receiptCard: allowed ? other : null,
      decision: allowed ? { allow: true, by: mgrOf(f.van), note: 'That\'s another van\'s card, fine this once. Swap them back tonight.' } : null });
    // Every fourth stop, a wash after the refuel.
    if (i % 4 === 1) {
      const wt = Math.round((12.9 + rnd() * 6) * 10) / 10;
      make({ kind: 'wash', van: f.van, by: f.driver, role: 'driver', at: f.at + 30 * 60_000, odo: f.odo + 1, fuelPct: null, litres: null, total: wt, merchant,
        items: [{ product: 'wash', description: 'Waschstrasse Premium', quantity: 1, unit: 'pcs', unitPrice: wt, total: wt }], status: 'done', card: 'match' });
    }
  });
  // A driver who used a bank card: refused, and the driver cancelled.
  const d0 = fills.filter((f) => f.van.st === 0);
  const ref0 = d0[Math.max(0, d0.length - 3)];
  if (ref0) {
    make({ kind: 'fuel', van: ref0.van, by: ref0.driver, role: 'driver', at: ref0.at - 2 * 86400_000, odo: ref0.odo - 260, fuelPct: 25, litres: null, total: 0, merchant: '', items: [],
      status: 'cancelled', card: 'mismatch', bank: true, decision: { allow: false, by: mgrOf(ref0.van), note: 'Not with your own card. The van\'s card is in the glovebox.' }, cancelled: null });
  }
  // A driver at the pump right now with another van's card, waiting for the station's manager.
  // The demo driver login first, so signing in as them shows the driver's side of it.
  const diesel0 = allVans.filter((v) => v.st === 0 && (USE[v.model] || [10, 80])[1] != null)
    .sort((a, b) => Number(current(a.id)?.id.startsWith('demo-') ?? true) - Number(current(b.id)?.id.startsWith('demo-') ?? true));
  for (const v of diesel0) {
    const who = current(v.id);
    if (!who) continue;
    const wrong = [...vanCards.values()].find((x) => x && x !== vanCards.get(v.id)) || '9911';
    make({ kind: 'fuel', van: v, by: who, role: 'driver', at: now - 9 * 60_000, odo: lastOdo(v) + 140, fuelPct: 25, litres: null, total: 0, merchant: '', items: [], status: 'waiting', card: 'mismatch', read4: wrong });
    break;
  }
  // Parts bought by the manager for the cracked mirror cover.
  const v1 = allVans[2];
  make({ kind: 'parts', van: v1, by: mgrOf(v1), role: 'manager', at: now - 1.5 * 86400_000, odo: lastOdo(v1), fuelPct: null, litres: null, total: 46.9, merchant: 'Auto-Teile Schmidt, Spandau',
    items: [{ product: 'parts', description: 'Spiegelkappe rechts', quantity: 1, unit: 'pcs', unitPrice: 46.9, total: 46.9 }], status: 'done', card: null, parts: [partsPath],
    note: 'Right mirror cover cracked (on the damage record). New cover, fitted at the depot; cheaper than the bodyshop.' });
  await w.flush();
}

/**
 * Made-up driver records and incidents: licences, licence checks (one overdue, one never recorded), briefings (one
 * due soon, one overdue), employment, emergency contacts; a few fines, accidents and a complaint.
 */
async function demoPeople(org: FirebaseFirestore.DocumentReference, now: number, drivers: { id: string; name: string; st: number }[],
  managers: { id: string; name: string }[], vans: { id: string; name: string; st: number }[], stationIds: string[], schedule: Slot[]) {
  const day = 86400_000;
  const d = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);
  const w = writer();
  const EMERGENCY = ['Ayla Yilmaz', 'Marco Rossi', 'Anna Schmidt', 'Ioana Popescu', 'Omar Haddad', 'Lea Weber', 'Pavel Petrov', 'Ewa Kowalska', 'Sam Demo'];
  drivers.forEach((p, i) => {
    const mgr = managers[p.st];
    const from = -(220 + i * 83);
    const lastCheck = p.name === 'Ali Yilmaz' ? -205 : -(40 + i * 13);
    const checks = p.name === 'David Kowalski' ? [] : [
      { day: d(lastCheck - 182), at: now + (lastCheck - 182) * day, by: mgr.id, byName: mgr.name, ok: true, note: '' },
      { day: d(lastCheck), at: now + lastCheck * day, by: mgr.id, byName: mgr.name, ok: true, note: '' },
    ].filter((c) => c.day > d(from));
    const briefed = p.name === 'Mihai Popescu' ? -350 : p.name === 'Elena Petrova' ? -380 : -(120 + i * 20);
    w.set(org.collection('driverRecords').doc(p.id), {
      stationId: stationIds[p.st], createdAt: now + from * day, updatedAt: now - 3 * day, updatedByName: mgr.name,
      licenceClasses: p.name === 'Lukas Schmidt' ? ['B', 'C1'] : p.name === 'Fatima Haddad' ? ['B', 'BE'] : ['B'],
      licenceValid: p.name === 'Jonas Weber' ? d(41) : d(900 + i * 410),
      employment: p.name === 'Sofia Rossi' ? 'part' : p.name === 'David Kowalski' ? 'mini' : 'full',
      employedFrom: d(from), employedTo: null, vanBriefing: d(from + 1), safetyBriefing: d(briefed),
      emergencyName: `${EMERGENCY[i % EMERGENCY.length]} (made up)`, emergencyPhone: `+49 151 0000 ${String(9100 + i).padStart(4, '0')}`,
      notes: p.name === 'Lukas Schmidt' ? 'Talked about driving style after the second speeding fine.' : null, checks,
    });
  });
  const who = (name: string) => drivers.find((x) => x.name === name);
  const vanOf = (driverId: string, t: number) => {
    const a = schedule.find((x) => x.driver.id === driverId && x.start <= t && (x.end == null || t < x.end));
    return a ? vans[a.van] : null;
  };
  const incidents: [string, number, string, string, string | null, string | null, string][] = [
    ['Lukas Schmidt', -12, '10:42', 'fine', 'speeding', null, '61 km/h in a 50 zone, Spandauer Damm. Notice from the city; driver named.'],
    ['Lukas Schmidt', -9, '14:05', 'accident', null, 'yes', 'Reversed into a bollard at the loading dock. Rear bumper scuffed, nobody hurt.'],
    ['Lukas Schmidt', -3, '09:18', 'fine', 'speeding', null, '58 km/h in a 50 zone. Second this month.'],
    ['Ali Yilmaz', -15, '11:30', 'fine', 'parking', null, 'Parked in a bus stop while delivering.'],
    ['Jonas Weber', -6, '16:10', 'complaint', null, null, 'Customer says the parcel was left at the door without a photo.'],
    ['Elena Petrova', -20, '13:00', 'accident', null, 'no', 'Another car clipped the left mirror while the van was parked.'],
    ['David Kowalski', -4, '12:45', 'fine', 'parking', null, 'Second-row parking, 30 EUR.'],
  ];
  for (const [name, off, time, kind, fineType, atFault, note] of incidents) {
    const p = who(name);
    if (!p) continue;
    const at = now + off * day;
    const van = vanOf(p.id, at);
    const mgr = managers[p.st];
    w.set(org.collection('incidents').doc(), {
      driverId: p.id, driverName: p.name, vehicleId: van?.id || null, vehicleName: van?.name || null, stationId: stationIds[p.st],
      day: d(off), time, kind, fineType, atFault, note, by: mgr.id, byName: mgr.name, createdAt: at + 2 * 3600_000,
    });
  }
  await w.flush();
}
