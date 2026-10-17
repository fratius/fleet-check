import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';

import { ask } from './claude';
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
function needStation(w: Who, stationId: string | undefined | null) {
  if (w.role === 'owner') return;
  if (!stationId || !w.stationIds.includes(stationId)) throw new HttpsError('permission-denied', 'This van belongs to another station.');
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
