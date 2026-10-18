import { randomBytes } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';

import { ask } from './claude';
import { createDemo, deleteDemo } from './demo';
import { fit, markBox, refCrop, type Sent } from './images';
import { MODELS, TIERS, addUsage, noUsage, round, type Tier, type Usage } from './models';
import { CLASS_IDS, DAMAGE_TYPES, VERDICTS, findPrompt, findSchema, identifyPrompt, identifySchema, spotPrompt, spotSchema } from './prompts';

initializeApp();
// Same region as the Firestore database and Storage bucket (US), so photos don't cross the Atlantic twice.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const db = () => getFirestore();
const bucket = () => getStorage().bucket();
const opts = (timeoutSeconds: number) => ({ secrets: [ANTHROPIC_API_KEY], memory: '2GiB' as const, cpu: 1, timeoutSeconds, concurrency: 4 });

/* ---------- helpers ---------- */
type Box = [number, number, number, number];
const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, n) : null);
const posInt = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);
function normBox(b: unknown): Box | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  let [x0, y0, x1, y1] = b.map(clamp01);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const mw = 0.04;
  if (x1 - x0 < mw) { const c = (x0 + x1) / 2; x0 = Math.max(0, c - mw / 2); x1 = Math.min(1, c + mw / 2); }
  if (y1 - y0 < mw) { const c = (y0 + y1) / 2; y0 = Math.max(0, c - mw / 2); y1 = Math.min(1, c + mw / 2); }
  return [x0, y0, x1, y1];
}
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Role = 'owner' | 'manager' | 'driver';
interface Who { uid: string; name: string; orgId: string; tier: Tier; role: Role; stationIds: string[]; creator: boolean }

/** Signed in, a member of the company (or the app creator), a known model tier. */
async function guard(req: CallableRequest<{ orgId?: unknown; tier?: unknown }>): Promise<Who> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in again, then try again.');
  const orgId = String(req.data?.orgId || '');
  if (!ID.test(orgId)) throw new HttpsError('invalid-argument', 'Unknown company.');
  const tier = (TIERS.includes(req.data?.tier as Tier) ? req.data.tier : 'default') as Tier;
  const creator = req.auth?.token?.creator === true;
  const m = await db().doc(`orgs/${orgId}/members/${uid}`).get();
  const tokenName = String(req.auth?.token?.name || req.auth?.token?.email || '').split('@')[0];
  if (!m.exists) {
    if (creator) return { uid, name: tokenName || 'App creator', orgId, tier, role: 'owner', stationIds: [], creator };
    throw new HttpsError('permission-denied', 'Your account isn\'t a member of this company.');
  }
  const d = m.data() as { role?: string; stationIds?: string[]; name?: string };
  const role: Role = creator || d.role === 'owner' || d.role === 'admin' ? 'owner' : d.role === 'manager' ? 'manager' : 'driver';
  return { uid, name: d.name || tokenName, orgId, tier, role, stationIds: Array.isArray(d.stationIds) ? d.stationIds : [], creator };
}
/** Can this person work at this station? Owners and the app creator can work everywhere. */
function needStation(w: Who, stationId: string | undefined | null, message = 'This van belongs to another station.') {
  if (w.role === 'owner') return;
  if (!stationId || !w.stationIds.includes(stationId)) throw new HttpsError('permission-denied', message);
}
function needStaff(w: Who) {
  if (w.role === 'driver') throw new HttpsError('permission-denied', 'Only fleet managers and owners can do this.');
}
function checkPath(p: unknown, prefix: string): string {
  const s = String(p || '');
  if (!s.startsWith(prefix) || s.includes('..') || s.length > 300) throw new HttpsError('invalid-argument', 'A photo path is outside this company.');
  return s;
}
async function download(path: string): Promise<Buffer> {
  try { const [b] = await bucket().file(path).download(); return b; } catch {
    throw new HttpsError('not-found', 'A photo is missing from storage. Upload it again.');
  }
}
async function save(path: string, buf: Buffer) {
  await bucket().file(path).save(buf, { contentType: 'image/jpeg', resumable: false, metadata: { cacheControl: 'private, max-age=31536000' } });
  return path;
}
async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/* ---------- 1. identifyVehicle: which body class, so the app picks the photo frames ---------- */
export const identifyVehicle = onCall(opts(120), async (req) => {
  const who = await guard(req);
  const { uid, orgId, tier } = who;
  needStaff(who);
  const stationId = req.data?.stationId ? String(req.data.stationId) : null;
  if (stationId) needStation(who, stationId);
  const scanId = String(req.data?.scanId || '');
  if (!ID.test(scanId)) throw new HttpsError('invalid-argument', 'Unknown scan.');
  const raw = Array.isArray(req.data?.paths) ? req.data.paths : [];
  if (!raw.length || raw.length > 3) throw new HttpsError('invalid-argument', 'Send 1 to 3 photos.');
  const paths = raw.map((p: unknown) => checkPath(p, `orgs/${orgId}/scans/${scanId}/`));

  // The body shape doesn't need full detail: about 2,000 image tokens per photo keeps it fast and cheap.
  const imgs = await Promise.all(paths.map(async (p: string) => fit(await download(p), 2000, 1568)));
  const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), tier, imgs.map((image) => ({ image })), identifyPrompt(imgs.length), identifySchema, 1500);
  const r = a.obj;
  const pick = <K extends string>(v: unknown, ok: K[], d: K): K => (ok.includes(v as K) ? (v as K) : d);
  const cls = CLASS_IDS.includes(r.class as string) ? (r.class as string) : null;
  const alternatives = (Array.isArray(r.alternatives) ? r.alternatives : [])
    .filter((x: { class?: string }) => x && CLASS_IDS.includes(x.class as string) && x.class !== cls).slice(0, 2)
    .map((x: { class: string; confidence?: unknown }) => ({ cls: x.class, confidence: typeof x.confidence === 'number' ? clamp01(x.confidence) : null }));
  const issues = (Array.isArray(r.photoIssues) ? r.photoIssues : []).filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 4).map((x: string) => x.trim().slice(0, 90));
  const scan = {
    createdAt: Date.now(), createdBy: uid, tier, model: a.model, ms: a.usage.ms, photos: imgs.length,
    inTok: a.usage.inTok, outTok: a.usage.outTok, cost: a.usage.cost,
    predicted: cls, confidence: typeof r.confidence === 'number' ? clamp01(r.confidence) : null,
    vMake: str(r.make, 40), vModel: str(r.model, 40),
    roof: pick(r.roof, ['high', 'low', 'unknown'], 'unknown'),
    slideL: pick(r.slidingDoorLeft, ['yes', 'no', 'unknown'], 'unknown'),
    slideR: pick(r.slidingDoorRight, ['yes', 'no', 'unknown'], 'unknown'),
    rear: pick(r.rearDoors, ['barn', 'tailgate', 'roller', 'open_bed', 'unknown'], 'unknown'),
    verdict: null, actual: null, paths, reason: str(r.reason, 200), issues, stationId,
  };
  await db().doc(`orgs/${orgId}/scans/${scanId}`).set(scan);
  return { scan: { ...scan, id: scanId }, reason: scan.reason, issues, alternatives };
});

/* ---------- 2. findDamage: mark every spot that could be damage in a walk-around ---------- */
const BATCH = 10; // photos per call: keeps every request well under 100k tokens and lets batches run in parallel

interface Spot {
  photo: number; photoLabel: string; box: Box; panel: string; type: string; sizeCm: number | null; conf: number;
  mightBe: 'dirt' | 'reflection' | null; closeup: string; refPath: string | null; closeups: string[];
  verdict: null | Record<string, unknown>; feedback: null; markPath: string | null;
}

export const findDamage = onCall(opts(300), async (req) => {
  const t0 = Date.now();
  const who = await guard(req);
  const { uid, orgId, tier } = who;
  const walkId = String(req.data?.walkId || '');
  if (!ID.test(walkId)) throw new HttpsError('invalid-argument', 'Unknown walk-around.');
  const walk = await db().doc(`orgs/${orgId}/walkarounds/${walkId}`).get();
  if (!walk.exists) throw new HttpsError('not-found', 'This walk-around was deleted.');
  const w = walk.data() as { vehicleId: string; vehicleName: string; cls: string; stationId?: string; photos: { n: number; label: string; path?: string }[] };
  needStation(who, w.stationId);
  const photos = (w.photos || []).filter((p) => p.path).slice(0, 30);
  if (!photos.length) throw new HttpsError('failed-precondition', 'This walk-around has no uploaded photos.');

  const originals = await pool(photos, 6, (p) => download(checkPath(p.path, `orgs/${orgId}/walkarounds/${walkId}/`)));
  const sent: Sent[] = await pool(originals, 4, (b) => fit(b));
  const prepMs = Date.now() - t0;

  const batches: number[][] = [];
  for (let i = 0; i < photos.length; i += BATCH) batches.push(photos.slice(i, i + BATCH).map((_, k) => i + k));
  const ta = Date.now();
  const answers = await Promise.all(batches.map((b) => ask<{ spots?: unknown[]; notVisible?: unknown[] }>(
    ANTHROPIC_API_KEY.value(), tier,
    b.map((i, k) => ({ label: `Image ${k + 1}: ${photos[i].label}`, image: sent[i] })),
    findPrompt(w.vehicleName, w.cls, b.map((i) => photos[i].label)), findSchema, 4000)));
  const aiMs = Date.now() - ta;

  let usage = noUsage();
  const notVisible = new Set<string>();
  let spots: Spot[] = [];
  answers.forEach((a, bi) => {
    usage = addUsage(usage, a.usage);
    (Array.isArray(a.obj.notVisible) ? a.obj.notVisible : []).forEach((x) => { if (typeof x === 'string' && x.trim()) notVisible.add(x.trim().slice(0, 80)); });
    for (const s of (Array.isArray(a.obj.spots) ? a.obj.spots : []) as Record<string, unknown>[]) {
      const img = Math.round(Number(s.image)), box = normBox(s.box), b = batches[bi];
      if (!(img >= 1 && img <= b.length) || !box) continue;
      const pi = b[img - 1];
      spots.push({
        photo: pi, photoLabel: photos[pi].label, box, panel: str(s.panel, 60) || 'Body panel',
        type: DAMAGE_TYPES.includes(s.type as string) ? (s.type as string) : 'other', sizeCm: posInt(s.sizeCm), conf: round(clamp01(s.confidence)),
        mightBe: s.mightBe === 'dirt' || s.mightBe === 'reflection' ? s.mightBe : null, closeup: str(s.closeup, 160) || '',
        refPath: null, closeups: [], verdict: null, feedback: null, markPath: null,
      });
    }
  });
  usage.ms = aiMs; // wall time of the AI step; the batches run in parallel
  spots = spots.sort((a, b) => b.conf - a.conf).slice(0, 8);

  const ref = db().collection(`orgs/${orgId}/checks`).doc();
  await pool(spots, 4, async (s, i) => { s.refPath = await save(`orgs/${orgId}/checks/${ref.id}/ref${i + 1}.jpg`, await refCrop(originals[s.photo], s.box)); });

  const check = {
    vehicleId: w.vehicleId, vehicleName: w.vehicleName, cls: w.cls, walkId, createdAt: Date.now(), createdBy: uid,
    createdByName: who.name, stationId: w.stationId || null, status: spots.length ? 'checking' : 'submitted',
    submittedAt: spots.length ? null : Date.now(), review: null,
    tier, model: MODELS[tier].id, photos: photos.length, pass1: usage, pass2: null, spots, notVisible: [...notVisible].slice(0, 6),
    missedNote: '', serverMs: Date.now() - t0, prepMs,
  };
  await ref.set(check);
  return { checkId: ref.id, spots, notVisible: check.notVisible, usage, model: check.model };
});

/* ---------- 3. checkSpot: decide one spot from the driver's close-ups ---------- */
export const checkSpot = onCall(opts(180), async (req) => {
  const who = await guard(req);
  const { orgId, tier } = who;
  const checkId = String(req.data?.checkId || '');
  if (!ID.test(checkId)) throw new HttpsError('invalid-argument', 'Unknown check.');
  const j = Number(req.data?.spot);
  const raw = Array.isArray(req.data?.closeups) ? req.data.closeups : [];
  if (!raw.length || raw.length > 2) throw new HttpsError('invalid-argument', 'Send 1 or 2 close-ups.');
  const closeups = raw.map((p: unknown) => checkPath(p, `orgs/${orgId}/checks/${checkId}/`));
  const cref = db().doc(`orgs/${orgId}/checks/${checkId}`);
  const snap = await cref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'This check was deleted.');
  const k = snap.data() as { vehicleName: string; cls: string; spots: Spot[]; stationId?: string; status?: string };
  needStation(who, k.stationId);
  if (k.status === 'reviewed') throw new HttpsError('failed-precondition', 'A manager has already reviewed this check.');
  const spot = k.spots?.[j];
  if (!Number.isInteger(j) || !spot) throw new HttpsError('invalid-argument', 'Unknown spot.');
  if (!spot.refPath) throw new HttpsError('failed-precondition', 'The marked photo for this spot is missing.');

  const [refBuf, ...closeBufs] = await Promise.all([download(spot.refPath), ...closeups.map((p: string) => download(p))]);
  const [refImg, ...closeImgs] = await Promise.all([fit(refBuf), ...closeBufs.map((b) => fit(b))]);
  const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), tier,
    [{ label: 'Image 1', image: refImg }, ...closeImgs.map((image, m) => ({ label: `Image ${m + 2}`, image }))],
    spotPrompt(k.vehicleName, k.cls, spot, closeImgs.length), spotSchema, 1200);
  const o = a.obj;
  const v = VERDICTS.includes(o.verdict as string) ? (o.verdict as string) : 'unclear';
  const dmg = v === 'damage';
  const cb = dmg ? normBox(o.closeupBox) : null;
  const verdict = {
    verdict: v, type: dmg && DAMAGE_TYPES.includes(o.type as string) ? o.type : null, sizeCm: dmg ? posInt(o.sizeCm) : null,
    severity: dmg && (o.severity === 'cosmetic' || o.severity === 'repair') ? o.severity : null,
    confidence: round(clamp01(o.confidence)), reason: str(o.reason, 300) || '', ms: a.usage.ms, closeupBox: cb,
  };
  const markPath = cb ? await save(`orgs/${orgId}/checks/${checkId}/mark${j + 1}_${Date.now().toString(36)}.jpg`, await markBox(closeBufs[0], cb)) : null;

  await db().runTransaction(async (tx) => {
    const cur = await tx.get(cref);
    const d = cur.data() as { spots: Spot[]; pass2: Usage | null };
    const next = d.spots.slice();
    next[j] = { ...next[j], closeups, verdict, markPath, feedback: null };
    tx.update(cref, { spots: next, pass2: addUsage(d.pass2 || noUsage(), a.usage), updatedAt: FieldValue.serverTimestamp() });
  });
  return { verdict, usage: a.usage, model: a.model };
});

/* ---------- 4. submitCheck: the driver is done with close-ups and sends the check to the manager ---------- */
export const submitCheck = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  const checkId = String(req.data?.checkId || '');
  if (!ID.test(checkId)) throw new HttpsError('invalid-argument', 'Unknown check.');
  const note = typeof req.data?.missedNote === 'string' ? req.data.missedNote.trim().slice(0, 500) : '';
  const cref = db().doc(`orgs/${who.orgId}/checks/${checkId}`);
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(cref);
    if (!cur.exists) throw new HttpsError('not-found', 'This check was deleted.');
    const d = cur.data() as { spots: Spot[]; stationId?: string; status?: string };
    needStation(who, d.stationId);
    if (d.status === 'reviewed') throw new HttpsError('failed-precondition', 'A manager has already reviewed this check.');
    const skipped = { verdict: 'skipped', type: null, sizeCm: null, severity: null, confidence: null, reason: '', ms: null, closeupBox: null };
    tx.update(cref, {
      spots: d.spots.map((p) => (p.verdict ? p : { ...p, verdict: skipped })),
      status: 'submitted', submittedAt: Date.now(), submittedBy: who.uid, missedNote: note,
    });
  });
  return { ok: true };
});

/* ---------- 5. setupStations: moves a company made before stations existed onto stations ---------- */
export const setupStations = onCall({ timeoutSeconds: 120 }, async (req) => {
  const who = await guard(req);
  if (who.role !== 'owner') throw new HttpsError('permission-denied', 'Only the fleet owner can do this.');
  const org = db().doc(`orgs/${who.orgId}`);
  const o = await org.get();
  if (!o.exists) throw new HttpsError('not-found', 'Unknown company.');
  if (o.data()?.stationsReady) return { done: false };
  const stations = await org.collection('stations').orderBy('createdAt').limit(1).get();
  let mainId: string;
  if (stations.empty) {
    const ref = org.collection('stations').doc();
    await ref.set({ name: 'Main station', code: '', createdAt: Date.now() });
    mainId = ref.id;
  } else mainId = stations.docs[0].id;

  let writer = db().batch(), n = 0;
  const put = async (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
    writer.update(ref, data);
    if (++n % 400 === 0) { await writer.commit(); writer = db().batch(); }
  };
  for (const c of ['vehicles', 'walkarounds', 'checks', 'scans']) {
    const all = await org.collection(c).get();
    for (const d of all.docs) {
      const x = d.data();
      const patch: Record<string, unknown> = {};
      if (!x.stationId) patch.stationId = mainId;
      if (c === 'checks' && !x.status) { patch.status = 'submitted'; patch.review = null; }
      if (Object.keys(patch).length) await put(d.ref, patch);
    }
  }
  const members = await org.collection('members').get();
  for (const d of members.docs) {
    const x = d.data();
    if (x.role === 'admin') await put(d.ref, { role: 'owner', stationIds: [] });
    else if (!Array.isArray(x.stationIds) || !x.stationIds.length) await put(d.ref, { stationIds: [mainId] });
  }
  // Invite codes from before stations carry no role or station and can't be used any more.
  const old = await db().collection('invites').where('orgId', '==', who.orgId).get();
  for (const d of old.docs) if (!d.data().role) writer.delete(d.ref);
  writer.update(org, { stationsReady: true, inviteCode: FieldValue.delete() });
  await writer.commit();
  return { done: true, stationId: mainId };
});

/* ---------- 6. Invite links: one person, one use, valid for 24 hours ---------- */
const INVITE_HOURS = 24;
const inviteToken = () => randomBytes(18).toString('base64url'); // 24 characters, not guessable

/** Makes 1 to 20 invite links for one role at one station. */
export const createInvite = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  const role = req.data?.role === 'manager' ? 'manager' : req.data?.role === 'driver' ? 'driver' : null;
  const stationId = String(req.data?.stationId || '');
  const count = Math.max(1, Math.min(20, Math.round(Number(req.data?.count) || 1)));
  if (!role || !ID.test(stationId)) throw new HttpsError('invalid-argument', 'Pick a role and a station.');
  // Owners invite fleet managers and drivers; managers invite drivers to their own station.
  if (role === 'manager' && who.role !== 'owner') throw new HttpsError('permission-denied', 'Only the fleet owner can invite fleet managers.');
  needStaff(who);
  needStation(who, stationId, 'You can only invite drivers to your own station.');
  const [org, station] = await Promise.all([db().doc(`orgs/${who.orgId}`).get(), db().doc(`orgs/${who.orgId}/stations/${stationId}`).get()]);
  if (!org.exists || !station.exists) throw new HttpsError('not-found', 'Unknown station.');
  const now = Date.now();
  const batch = db().batch();
  const invites = Array.from({ length: count }, () => {
    const token = inviteToken();
    const invite = {
      token, orgId: who.orgId, orgName: String(org.data()?.name || ''), role, stationId, stationName: String(station.data()?.name || ''),
      createdBy: who.uid, createdByName: who.name, createdAt: now, expiresAt: now + INVITE_HOURS * 3600_000,
      usedBy: null, usedByName: null, usedAt: null,
    };
    batch.create(db().doc(`invites/${token}`), invite);
    return invite;
  });
  await batch.commit();
  return { invites };
});

/** What an invite link is for, shown before signing in. Needs no account: the link itself is the secret. */
export const peekInvite = onCall({ timeoutSeconds: 15 }, async (req) => {
  const token = String(req.data?.token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { status: 'missing' };
  const snap = await db().doc(`invites/${token}`).get();
  if (!snap.exists) return { status: 'missing' };
  const i = snap.data() as { orgName: string; role: string; stationName: string; createdByName?: string; expiresAt: number; usedBy: string | null };
  const status = i.usedBy ? (i.usedBy === req.auth?.uid ? 'mine' : 'used') : Date.now() > i.expiresAt ? 'expired' : 'ok';
  return { status, orgName: i.orgName, role: i.role, stationName: i.stationName, invitedBy: i.createdByName || '', expiresAt: i.expiresAt };
});

const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');

/** Uses an invite link: the signed-in person joins with the link's role and station, with their details. */
export const acceptInvite = onCall({ timeoutSeconds: 30 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in or create an account first.');
  const token = String(req.data?.token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpsError('invalid-argument', 'This invite link isn\'t complete. Ask for a new one.');
  const email = String(req.auth?.token?.email || '');
  const d = (req.data?.details || {}) as Record<string, unknown>;
  const firstName = clean(d.firstName, 40), lastName = clean(d.lastName, 40);
  const phone = clean(d.phone, 30), transporterId = clean(d.transporterId, 20).toUpperCase();
  const name = [firstName, lastName].filter(Boolean).join(' ') || String(req.auth?.token?.name || email.split('@')[0] || 'New member');
  if (!firstName || !lastName) throw new HttpsError('invalid-argument', 'Enter your first and last name.');
  if (phone && !/^[+0-9 ()/-]{6,30}$/.test(phone)) throw new HttpsError('invalid-argument', 'That phone number doesn\'t look right.');
  const iref = db().doc(`invites/${token}`);
  const out = await db().runTransaction(async (tx) => {
    const snap = await tx.get(iref);
    if (!snap.exists) throw new HttpsError('not-found', 'This invite link doesn\'t exist or was cancelled. Ask for a new one.');
    const i = snap.data() as { orgId: string; orgName: string; role: string; stationId: string; stationName: string; expiresAt: number; usedBy: string | null };
    if (i.usedBy === uid) return { orgId: i.orgId, orgName: i.orgName, role: i.role, stationName: i.stationName, already: true };
    if (i.usedBy) throw new HttpsError('failed-precondition', 'This invite link was already used. Each link works for one person; ask for a new one.');
    if (Date.now() > i.expiresAt) throw new HttpsError('deadline-exceeded', 'This invite link has expired. Links work for 24 hours; ask for a new one.');
    const mref = db().doc(`orgs/${i.orgId}/members/${uid}`);
    const m = await tx.get(mref);
    if (m.exists) throw new HttpsError('already-exists', `You're already in ${i.orgName}. Ask the fleet owner to change your role or station.`);
    tx.create(mref, { role: i.role, stationIds: [i.stationId], email, name, firstName, lastName, phone, transporterId, joinedAt: Date.now(), invite: token });
    tx.update(iref, { usedBy: uid, usedByName: name, usedAt: Date.now() });
    tx.set(db().doc(`users/${uid}`), { orgIds: FieldValue.arrayUnion(i.orgId), orgId: i.orgId, email, name, firstName, lastName, phone }, { merge: true });
    return { orgId: i.orgId, orgName: i.orgName, role: i.role, stationName: i.stationName, already: false };
  });
  await getAuth().updateUser(uid, { displayName: name }).catch(() => {});
  return out;
});

/* ---------- 7. Demo company: made-up stations, people, vans and checks to try the app with ---------- */
export const createDemoCompany = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in again, then try again.');
  const email = String(req.auth?.token?.email || '');
  const name = String(req.auth?.token?.name || email.split('@')[0] || 'You');
  return createDemo(uid, name, email, req.data?.fresh === true);
});

export const deleteDemoCompany = onCall({ timeoutSeconds: 120 }, async (req) => {
  const who = await guard(req);
  if (who.role !== 'owner') throw new HttpsError('permission-denied', 'Only the owner can remove the demo company.');
  const org = await db().doc(`orgs/${who.orgId}`).get();
  if (!org.exists || org.data()?.demo !== true) throw new HttpsError('failed-precondition', 'Only a demo company can be removed this way.');
  await deleteDemo(who.orgId);
  return { ok: true };
});

/* ---------- 8. Vans and drivers: assignments with a permanent history ---------- */
// An assignment links one van to one person from `start` to `end` (null while it lasts). A van has at most one
// open assignment and so does a person. Assignments are written only here and never edited or deleted: the only
// change is closing an open one. That record is the history of every van and every driver.

type EndReason = 'reassigned' | 'ended' | 'dropped off' | 'taken over' | 'switched van' | 'driver removed' | 'driver moved' | 'role changed' | 'van retired' | 'van moved';
interface Assignment {
  vehicleId: string; vehicleName: string; plate: string; driverId: string; driverName: string; stationId: string | null;
  start: number; end: number | null; startedBy: string; startedByName: string; endedBy: string | null; endedByName: string | null; endReason: EndReason | null;
  /** The walk-around taken at pick-up and at drop-off (drivers who pick up vans themselves); null when a manager assigned. */
  startWalkId: string | null; endWalkId?: string | null;
}
const closeWith = (who: Who, reason: EndReason, walkId: string | null = null) =>
  ({ end: Date.now(), endedBy: who.uid, endedByName: who.name, endReason: reason, endWalkId: walkId });

/** Gives a van to a driver (or a manager) of its station, or ends its assignment when `driverId` is null. */
export const assignVan = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const vehicleId = String(req.data?.vehicleId || '');
  const driverId = req.data?.driverId ? String(req.data.driverId) : null;
  if (!ID.test(vehicleId) || (driverId && !/^[A-Za-z0-9_-]{1,128}$/.test(driverId))) throw new HttpsError('invalid-argument', 'Unknown van or driver.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  const aCol = org.collection('assignments');
  return db().runTransaction(async (tx) => {
    const v = await tx.get(vref);
    if (!v.exists) throw new HttpsError('not-found', 'This van was removed.');
    const van = v.data() as { name: string; plate?: string; stationId?: string; retired?: boolean; assignedTo?: { assignmentId: string; driverId: string } | null };
    needStation(who, van.stationId);
    if (van.retired && driverId) throw new HttpsError('failed-precondition', 'This van is retired. Bring it back first.');
    let person: { name: string; role: string; stationIds?: string[] } | null = null;
    let personOpen: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (driverId) {
      const m = await tx.get(org.collection('members').doc(driverId));
      if (!m.exists) throw new HttpsError('not-found', 'This person isn\'t in the company any more.');
      person = m.data() as { name: string; role: string; stationIds?: string[] };
      if (!['driver', 'manager'].includes(person.role)) throw new HttpsError('invalid-argument', 'Vans go to drivers or fleet managers.');
      if (!van.stationId || !(person.stationIds || []).includes(van.stationId)) throw new HttpsError('failed-precondition', `${person.name} works at another station. Move the van or the person first.`);
      personOpen = (await tx.get(aCol.where('driverId', '==', driverId).where('end', '==', null))).docs;
    }
    if (driverId && van.assignedTo?.driverId === driverId) return { assignmentId: van.assignedTo.assignmentId, unchanged: true };
    // Close the van's current assignment and the person's current one (their other van becomes free).
    if (van.assignedTo?.assignmentId) tx.update(aCol.doc(van.assignedTo.assignmentId), closeWith(who, driverId ? 'reassigned' : 'ended'));
    for (const d of personOpen) {
      if (d.id === van.assignedTo?.assignmentId) continue;
      tx.update(d.ref, closeWith(who, 'reassigned'));
      tx.update(org.collection('vehicles').doc((d.data() as Assignment).vehicleId), { assignedTo: null });
    }
    if (!driverId || !person) { tx.update(vref, { assignedTo: null }); return { assignmentId: null }; }
    const now = Date.now();
    const aref = aCol.doc();
    const a: Assignment & { createdAt: number } = {
      vehicleId, vehicleName: van.name, plate: van.plate || '', driverId, driverName: person.name, stationId: van.stationId || null,
      start: now, end: null, startedBy: who.uid, startedByName: who.name, endedBy: null, endedByName: null, endReason: null, createdAt: now,
      startWalkId: null, endWalkId: null,
    };
    tx.set(aref, a);
    tx.update(vref, { assignedTo: { assignmentId: aref.id, driverId, driverName: person.name, since: now } });
    return { assignmentId: aref.id };
  });
});

/** Retires a van (or brings it back). Vans are never deleted: their walk-arounds, checks and history stay. */
export const retireVan = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const vehicleId = String(req.data?.vehicleId || '');
  const restore = req.data?.restore === true;
  if (!ID.test(vehicleId)) throw new HttpsError('invalid-argument', 'Unknown van.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  await db().runTransaction(async (tx) => {
    const v = await tx.get(vref);
    if (!v.exists) throw new HttpsError('not-found', 'Unknown van.');
    const van = v.data() as { stationId?: string; assignedTo?: { assignmentId: string } | null };
    needStation(who, van.stationId);
    if (restore) { tx.update(vref, { retired: false, retiredAt: null, retiredBy: null }); return; }
    if (van.assignedTo?.assignmentId) tx.update(org.collection('assignments').doc(van.assignedTo.assignmentId), closeWith(who, 'van retired'));
    tx.update(vref, { retired: true, retiredAt: Date.now(), retiredBy: who.name, assignedTo: null });
  });
  return { ok: true };
});

/** Ends a van assignment when the van moves to another station (the driver stays at theirs). */
export const moveVan = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const vehicleId = String(req.data?.vehicleId || '');
  const stationId = String(req.data?.stationId || '');
  if (!ID.test(vehicleId) || !ID.test(stationId)) throw new HttpsError('invalid-argument', 'Unknown van or station.');
  if (who.role !== 'owner') throw new HttpsError('permission-denied', 'Only the fleet owner moves vans between stations.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  await db().runTransaction(async (tx) => {
    const [v, st] = await Promise.all([tx.get(vref), tx.get(org.collection('stations').doc(stationId))]);
    if (!v.exists || !st.exists) throw new HttpsError('not-found', 'Unknown van or station.');
    const van = v.data() as { stationId?: string; assignedTo?: { assignmentId: string } | null };
    if (van.stationId === stationId) return;
    if (van.assignedTo?.assignmentId) tx.update(org.collection('assignments').doc(van.assignedTo.assignmentId), closeWith(who, 'van moved'));
    tx.update(vref, { stationId, assignedTo: null });
  });
  return { ok: true };
});

/** Removes someone from the company. Their van becomes free; their history stays. */
export const removePerson = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const uid = String(req.data?.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpsError('invalid-argument', 'Unknown person.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You can\'t remove yourself here.');
  const org = db().doc(`orgs/${who.orgId}`);
  const mref = org.collection('members').doc(uid);
  await db().runTransaction(async (tx) => {
    const m = await tx.get(mref);
    if (!m.exists) return;
    const p = m.data() as { role: string; stationIds?: string[] };
    // Owners remove anyone; managers remove drivers of their station.
    if (who.role !== 'owner' && !(p.role === 'driver' && (p.stationIds || []).some((s) => who.stationIds.includes(s)))) {
      throw new HttpsError('permission-denied', 'Fleet managers can only remove drivers of their station.');
    }
    const open = (await tx.get(org.collection('assignments').where('driverId', '==', uid).where('end', '==', null))).docs;
    for (const d of open) {
      tx.update(d.ref, closeWith(who, 'driver removed'));
      tx.update(org.collection('vehicles').doc((d.data() as Assignment).vehicleId), { assignedTo: null });
    }
    tx.delete(mref);
  });
  return { ok: true };
});

/**
 * The owner changes someone's role or station. Done here, not in the app, so a person who leaves a station
 * also leaves its van: their open assignment ends and the van becomes free. Their history stays.
 */
export const changePerson = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  if (who.role !== 'owner') throw new HttpsError('permission-denied', 'Only the fleet owner changes roles and stations.');
  const uid = String(req.data?.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpsError('invalid-argument', 'Unknown person.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You can\'t change your own role or station.');
  const role = req.data?.role == null ? null : String(req.data.role);
  const stationId = req.data?.stationId == null ? null : String(req.data.stationId);
  if (role && !['owner', 'manager', 'driver'].includes(role)) throw new HttpsError('invalid-argument', 'Unknown role.');
  if (stationId && !ID.test(stationId)) throw new HttpsError('invalid-argument', 'Unknown station.');
  if (!role && !stationId) return { ok: true };
  const org = db().doc(`orgs/${who.orgId}`);
  const mref = org.collection('members').doc(uid);
  await db().runTransaction(async (tx) => {
    const m = await tx.get(mref);
    if (!m.exists) throw new HttpsError('not-found', 'This person isn\'t in the company any more.');
    if (stationId && !(await tx.get(org.collection('stations').doc(stationId))).exists) throw new HttpsError('not-found', 'Unknown station.');
    const p = m.data() as { role: string; stationIds?: string[] };
    const nextRole = role || (p.role === 'admin' ? 'owner' : p.role);
    const nextStations = stationId ? [stationId] : p.stationIds || [];
    const open = (await tx.get(org.collection('assignments').where('driverId', '==', uid).where('end', '==', null))).docs;
    for (const d of open) {
      const a = d.data() as Assignment;
      const reason: EndReason | null = nextRole === 'owner' ? 'role changed' : !a.stationId || !nextStations.includes(a.stationId) ? 'driver moved' : null;
      if (!reason) continue;
      tx.update(d.ref, closeWith(who, reason));
      tx.update(org.collection('vehicles').doc(a.vehicleId), { assignedTo: null });
    }
    tx.update(mref, { role: nextRole, stationIds: nextStations });
  });
  return { ok: true };
});

/* ---------- 9. Drivers pick up and drop off vans themselves, where the station allows it ---------- */
// Some DSPs assign vans in Amazon's tools and just tell drivers to pick one up. Owners (any station) and fleet
// managers (their station) can let drivers record that themselves. Off by default. Every pick-up and drop-off is
// an ordinary assignment, so it lands in the same permanent history (startedBy is the driver).

export const setSelfAssign = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const stationId = String(req.data?.stationId || '');
  if (!ID.test(stationId)) throw new HttpsError('invalid-argument', 'Unknown station.');
  needStation(who, stationId, 'Fleet managers can only change this for their station.');
  const ref = db().doc(`orgs/${who.orgId}/stations/${stationId}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Unknown station.');
  await ref.update({ selfAssign: req.data?.on === true, selfAssignBy: who.name, selfAssignAt: Date.now() });
  return { ok: true };
});

/** Reads the van and checks this person may pick it up or drop it off at its station right now. */
async function selfService(tx: FirebaseFirestore.Transaction, who: Who, vehicleId: string) {
  if (!['driver', 'manager'].includes(who.role)) throw new HttpsError('permission-denied', 'Only drivers and fleet managers pick up vans.');
  if (!ID.test(vehicleId)) throw new HttpsError('invalid-argument', 'Unknown van.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  const v = await tx.get(vref);
  if (!v.exists) throw new HttpsError('not-found', 'Unknown van.');
  const van = v.data() as { name: string; plate?: string; stationId?: string; retired?: boolean; assignedTo?: { assignmentId: string; driverId: string; driverName: string } | null };
  needStation(who, van.stationId);
  const st = await tx.get(org.collection('stations').doc(van.stationId!));
  if (st.data()?.selfAssign !== true) throw new HttpsError('failed-precondition', 'At this station your fleet manager gives out the vans. Ask them, or ask them to let drivers pick up vans themselves.');
  return { org, vref, van };
}

// A pick-up or drop-off needs a full walk-around of that van, taken with the camera by this person just now:
// every photo of the van's frame set, none skipped, uploaded in the last two hours, used for one handover only.
const HANDOVER_MAX_AGE = 2 * 3600_000;
interface WalkDoc { vehicleId: string; createdBy: string | null; source: string; frames: number; taken: number; skipped: number; photos: { path?: string }[]; handover?: unknown }
async function checkHandoverPhotos(who: Who, vehicleId: string, walkId: string) {
  if (!ID.test(walkId)) throw new HttpsError('invalid-argument', 'Take the photos of the van first.');
  const w = await db().doc(`orgs/${who.orgId}/walkarounds/${walkId}`).get();
  const d = w.data() as WalkDoc | undefined;
  if (!d || d.vehicleId !== vehicleId || d.createdBy !== who.uid) throw new HttpsError('failed-precondition', 'These photos aren\'t yours or aren\'t of this van.');
  if (d.handover) throw new HttpsError('failed-precondition', 'These photos were already used. Take new ones.');
  if (d.source !== 'camera' || d.skipped > 0 || d.frames < 1 || d.taken < d.frames || (d.photos || []).length < d.frames) {
    throw new HttpsError('failed-precondition', 'Every photo of the walk-around is needed, taken with the camera. Take the missing ones.');
  }
  const prefix = `orgs/${who.orgId}/walkarounds/${walkId}/`;
  const files = await Promise.all(d.photos.map(async (p) => {
    if (!p.path || !p.path.startsWith(prefix)) return null;
    try { const [m] = await bucket().file(p.path).getMetadata(); return m; } catch { return null; }
  }));
  if (files.some((m) => !m || Date.now() - new Date(String(m.timeCreated)).getTime() > HANDOVER_MAX_AGE)) {
    throw new HttpsError('failed-precondition', 'Some photos didn\'t finish uploading or are more than two hours old. Take them again.');
  }
}
/** In the transaction: the walk-around is still unused; mark it as this handover's photos. */
async function useHandoverPhotos(tx: FirebaseFirestore.Transaction, org: FirebaseFirestore.DocumentReference, walkId: string) {
  const ref = org.collection('walkarounds').doc(walkId);
  const w = await tx.get(ref);
  if ((w.data() as WalkDoc | undefined)?.handover) throw new HttpsError('failed-precondition', 'These photos were already used. Take new ones.');
  return ref;
}

/**
 * The driver takes this van, with its pick-up photos. A van someone else still has in the app (they didn't drop
 * it off) is taken over: their assignment ends with these photos. A driver who has another van drops that off first.
 */
export const pickUpVan = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = await guard(req);
  const vehicleId = String(req.data?.vehicleId || '');
  const walkId = String(req.data?.walkId || '');
  await checkHandoverPhotos(who, vehicleId, walkId);
  return db().runTransaction(async (tx) => {
    const { org, vref, van } = await selfService(tx, who, vehicleId);
    if (van.retired) throw new HttpsError('failed-precondition', 'This van is retired.');
    if (van.assignedTo?.driverId === who.uid) return { assignmentId: van.assignedTo.assignmentId, unchanged: true };
    const aCol = org.collection('assignments');
    const mine = (await tx.get(aCol.where('driverId', '==', who.uid).where('end', '==', null))).docs;
    if (mine.length) throw new HttpsError('failed-precondition', `Drop off ${(mine[0].data() as Assignment).vehicleName} first, with its photos.`);
    const wref = await useHandoverPhotos(tx, org, walkId);
    if (van.assignedTo?.assignmentId) tx.update(aCol.doc(van.assignedTo.assignmentId), closeWith(who, 'taken over', walkId));
    const now = Date.now();
    const aref = aCol.doc();
    const a: Assignment & { createdAt: number } = {
      vehicleId, vehicleName: van.name, plate: van.plate || '', driverId: who.uid, driverName: who.name, stationId: van.stationId || null,
      start: now, end: null, startedBy: who.uid, startedByName: who.name, endedBy: null, endedByName: null, endReason: null, createdAt: now,
      startWalkId: walkId, endWalkId: null,
    };
    tx.set(aref, a);
    tx.update(vref, { assignedTo: { assignmentId: aref.id, driverId: who.uid, driverName: who.name, since: now } });
    tx.update(wref, { handover: { kind: 'pickup', assignmentId: aref.id } });
    return { assignmentId: aref.id, tookOverFrom: van.assignedTo?.driverName || null };
  });
});

/** The driver hands back the van they have, with its drop-off photos. */
export const dropOffVan = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = await guard(req);
  const vehicleId = String(req.data?.vehicleId || '');
  const walkId = String(req.data?.walkId || '');
  await checkHandoverPhotos(who, vehicleId, walkId);
  await db().runTransaction(async (tx) => {
    const { org, vref, van } = await selfService(tx, who, vehicleId);
    if (van.assignedTo?.driverId !== who.uid) throw new HttpsError('failed-precondition', 'You don\'t have this van.');
    const wref = await useHandoverPhotos(tx, org, walkId);
    tx.update(org.collection('assignments').doc(van.assignedTo.assignmentId), closeWith(who, 'dropped off', walkId));
    tx.update(vref, { assignedTo: null });
    tx.update(wref, { handover: { kind: 'dropoff', assignmentId: van.assignedTo.assignmentId } });
  });
  return { ok: true };
});
