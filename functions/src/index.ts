import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { logger, setGlobalOptions } from 'firebase-functions';
import { onCall, type CallableRequest } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import webpush from 'web-push';

import { ask } from './claude';
import { createDemo, deleteDemo } from './demo';
import { fit, markBox, refCrop, type Sent } from './images';
import { MODELS, TIERS, addUsage, noUsage, round, type Tier, type Usage } from './models';
import { CLASS_IDS, DAMAGE_TYPES, VERDICTS, dashPrompt, dashSchema, findPrompt, findSchema, identifyPrompt, identifySchema, spotPrompt, spotSchema } from './prompts';
import { damageLogFor, modelOf, planReading, tourNumbers, type Fuel, type Refuel, type TourDoc, type TourEnd } from './fleetlog';
import { DRIVER_FIELDS, VAN_FIELDS, cleanFields, docPrompt, docSchema } from './documents';
import { makePlayback, probe } from './video';
import { N_, fail, langOf, tr } from './i18n';
import {
  BUY_KINDS, cardDigits, said, type Said, cardPrompt, cardSchema, cardVerdict, cleanCard, cleanReceipt, doneMessage, expired, fuelLitres, purchaseFlags,
  receiptPrompt, receiptSchema, type BuyKind, type CardRead, type Flag, type Receipt,
} from './purchases';

initializeApp();
// Same region as the Firestore database and Storage bucket (US), so photos don't cross the Atlantic twice.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
/** The key pair for phone notifications (web push), made once by the Deploy workflow: {publicKey, privateKey}. */
const WEBPUSH_KEYS = defineSecret('WEBPUSH_KEYS');
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

/**
 * The app creator viewing the app as an owner, fleet manager or driver of one company (set in the Account tab, on
 * their profile). Only counts with the creator claim; then they get exactly that role's access, here and in the rules.
 */
export interface ViewAs { org: string; role: Role; st: string | null }
async function viewAsOf(uid: string): Promise<ViewAs | null> {
  const v = (await db().doc(`users/${uid}`).get()).data()?.viewAs as { org?: unknown; role?: unknown; st?: unknown } | null | undefined;
  if (!v || typeof v.org !== 'string') return null;
  const role: Role = v.role === 'owner' ? 'owner' : v.role === 'manager' ? 'manager' : 'driver';
  return { org: v.org, role, st: role !== 'owner' && typeof v.st === 'string' ? v.st : null };
}

/** Signed in, a member of the company (or the app creator), a known model tier. */
async function guard(req: CallableRequest<{ orgId?: unknown; tier?: unknown }>): Promise<Who> {
  const uid = req.auth?.uid;
  if (!uid) throw fail('unauthenticated', 'Sign in again, then try again.');
  const orgId = String(req.data?.orgId || '');
  if (!ID.test(orgId)) throw fail('invalid-argument', 'Unknown company.');
  const tier = (TIERS.includes(req.data?.tier as Tier) ? req.data.tier : 'default') as Tier;
  const creator = req.auth?.token?.creator === true;
  const tokenName = String(req.auth?.token?.name || req.auth?.token?.email || '').split('@')[0];
  if (creator) {
    const va = await viewAsOf(uid);
    if (va) {
      if (va.org !== orgId) throw fail('permission-denied', 'You\'re viewing another company as someone else. Switch back to yourself in the Account tab first.');
      const real = (await db().doc(`orgs/${orgId}/members/${uid}`).get()).data() as { name?: string } | undefined;
      return { uid, name: real?.name || tokenName || 'App creator', orgId, tier, role: va.role, stationIds: va.st ? [va.st] : [], creator: false };
    }
  }
  const m = await db().doc(`orgs/${orgId}/members/${uid}`).get();
  if (!m.exists) {
    if (creator) return { uid, name: tokenName || 'App creator', orgId, tier, role: 'owner', stationIds: [], creator };
    throw fail('permission-denied', 'Your account isn\'t a member of this company.');
  }
  const d = m.data() as { role?: string; stationIds?: string[]; name?: string };
  const role: Role = creator || d.role === 'owner' || d.role === 'admin' ? 'owner' : d.role === 'manager' ? 'manager' : 'driver';
  return { uid, name: d.name || tokenName, orgId, tier, role, stationIds: Array.isArray(d.stationIds) ? d.stationIds : [], creator };
}
/** Can this person work at this station? Owners and the app creator can work everywhere. */
function needStation(w: Who, stationId: string | undefined | null, message: string = N_('This van belongs to another station.')) {
  if (w.role === 'owner') return;
  if (!stationId || !w.stationIds.includes(stationId)) throw fail('permission-denied', message);
}
function needStaff(w: Who) {
  if (w.role === 'driver') throw fail('permission-denied', 'Only fleet managers and owners can do this.');
}
function checkPath(p: unknown, prefix: string): string {
  const s = String(p || '');
  if (!s.startsWith(prefix) || s.includes('..') || s.length > 300) throw fail('invalid-argument', 'A photo path is outside this company.');
  return s;
}
async function download(path: string): Promise<Buffer> {
  try { const [b] = await bucket().file(path).download(); return b; } catch {
    throw fail('not-found', 'A photo is missing from storage. Upload it again.');
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
  if (!ID.test(scanId)) throw fail('invalid-argument', 'Unknown scan.');
  const raw = Array.isArray(req.data?.paths) ? req.data.paths : [];
  if (!raw.length || raw.length > 3) throw fail('invalid-argument', 'Send 1 to 3 photos.');
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
  // AI speed and cost are for the app creator only (type scans are read only by them, see the rules).
  const shown = who.creator ? scan : { ...scan, ms: null, inTok: null, outTok: null, cost: null };
  return { scan: { ...shown, id: scanId }, reason: scan.reason, issues, alternatives };
});

/**
 * AI speed and cost of a damage check, kept apart from the check (orgs/{org}/checkUsage/{checkId}) because only
 * the app creator may see them: everyone at the station reads the check itself. Written only here.
 */
const usageRef = (orgId: string, checkId: string) => db().doc(`orgs/${orgId}/checkUsage/${checkId}`);

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
  if (!ID.test(walkId)) throw fail('invalid-argument', 'Unknown walk-around.');
  const walk = await db().doc(`orgs/${orgId}/walkarounds/${walkId}`).get();
  if (!walk.exists) throw fail('not-found', 'This walk-around was deleted.');
  const w = walk.data() as { vehicleId: string; vehicleName: string; cls: string; stationId?: string; photos: { n: number; label: string; path?: string }[] };
  needStation(who, w.stationId);
  const photos = (w.photos || []).filter((p) => p.path).slice(0, 30);
  if (!photos.length) throw fail('failed-precondition', 'This walk-around has no uploaded photos.');

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
    tier, model: MODELS[tier].id, photos: photos.length, spots, notVisible: [...notVisible].slice(0, 6), missedNote: '',
  };
  const b = db().batch();
  b.set(ref, check);
  b.set(usageRef(orgId, ref.id), {
    checkId: ref.id, stationId: check.stationId, createdAt: check.createdAt, tier, model: check.model,
    pass1: usage, pass2: null, serverMs: Date.now() - t0, prepMs, spotMs: {},
  });
  await b.commit();
  return { checkId: ref.id, spots, notVisible: check.notVisible, model: check.model, ...(who.creator ? { usage } : {}) };
});

/* ---------- 3. checkSpot: decide one spot from the driver's close-ups ---------- */
export const checkSpot = onCall(opts(180), async (req) => {
  const who = await guard(req);
  const { orgId, tier } = who;
  const checkId = String(req.data?.checkId || '');
  if (!ID.test(checkId)) throw fail('invalid-argument', 'Unknown check.');
  const j = Number(req.data?.spot);
  const raw = Array.isArray(req.data?.closeups) ? req.data.closeups : [];
  if (!raw.length || raw.length > 2) throw fail('invalid-argument', 'Send 1 or 2 close-ups.');
  const closeups = raw.map((p: unknown) => checkPath(p, `orgs/${orgId}/checks/${checkId}/`));
  const cref = db().doc(`orgs/${orgId}/checks/${checkId}`);
  const snap = await cref.get();
  if (!snap.exists) throw fail('not-found', 'This check was deleted.');
  const k = snap.data() as { vehicleName: string; cls: string; spots: Spot[]; stationId?: string; status?: string };
  needStation(who, k.stationId);
  if (k.status === 'reviewed') throw fail('failed-precondition', 'A manager has already reviewed this check.');
  const spot = k.spots?.[j];
  if (!Number.isInteger(j) || !spot) throw fail('invalid-argument', 'Unknown spot.');
  if (!spot.refPath) throw fail('failed-precondition', 'The marked photo for this spot is missing.');

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
    confidence: round(clamp01(o.confidence)), reason: str(o.reason, 300) || '', closeupBox: cb,
  };
  const markPath = cb ? await save(`orgs/${orgId}/checks/${checkId}/mark${j + 1}_${Date.now().toString(36)}.jpg`, await markBox(closeBufs[0], cb)) : null;

  const uref = usageRef(orgId, checkId);
  await db().runTransaction(async (tx) => {
    const [cur, u] = await Promise.all([tx.get(cref), tx.get(uref)]);
    const d = cur.data() as { spots: Spot[] };
    const prev = (u.data() as { pass2?: Usage | null } | undefined)?.pass2 || noUsage();
    const next = d.spots.slice();
    next[j] = { ...next[j], closeups, verdict, markPath, feedback: null };
    tx.update(cref, { spots: next, updatedAt: FieldValue.serverTimestamp() });
    tx.set(uref, { checkId, pass2: addUsage(prev, a.usage), spotMs: { [j]: a.usage.ms } }, { merge: true });
  });
  return { verdict, model: a.model, ...(who.creator ? { usage: a.usage, ms: a.usage.ms } : {}) };
});

/* ---------- 4. submitCheck: the driver is done with close-ups and sends the check to the manager ---------- */
export const submitCheck = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  const checkId = String(req.data?.checkId || '');
  if (!ID.test(checkId)) throw fail('invalid-argument', 'Unknown check.');
  const note = typeof req.data?.missedNote === 'string' ? req.data.missedNote.trim().slice(0, 500) : '';
  const cref = db().doc(`orgs/${who.orgId}/checks/${checkId}`);
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(cref);
    if (!cur.exists) throw fail('not-found', 'This check was deleted.');
    const d = cur.data() as { spots: Spot[]; stationId?: string; status?: string };
    needStation(who, d.stationId);
    if (d.status === 'reviewed') throw fail('failed-precondition', 'A manager has already reviewed this check.');
    const skipped = { verdict: 'skipped', type: null, sizeCm: null, severity: null, confidence: null, reason: '', closeupBox: null };
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
  if (who.role !== 'owner') throw fail('permission-denied', 'Only the fleet owner can do this.');
  const org = db().doc(`orgs/${who.orgId}`);
  const o = await org.get();
  if (!o.exists) throw fail('not-found', 'Unknown company.');
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
  if (!role || !ID.test(stationId)) throw fail('invalid-argument', 'Pick a role and a station.');
  // Owners invite fleet managers and drivers; managers invite drivers to their own station.
  if (role === 'manager' && who.role !== 'owner') throw fail('permission-denied', 'Only the fleet owner can invite fleet managers.');
  needStaff(who);
  needStation(who, stationId, N_('You can only invite drivers to your own station.'));
  const [org, station] = await Promise.all([db().doc(`orgs/${who.orgId}`).get(), db().doc(`orgs/${who.orgId}/stations/${stationId}`).get()]);
  if (!org.exists || !station.exists) throw fail('not-found', 'Unknown station.');
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
  if (!uid) throw fail('unauthenticated', 'Sign in or create an account first.');
  const token = String(req.data?.token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw fail('invalid-argument', 'This invite link isn\'t complete. Ask for a new one.');
  const email = String(req.auth?.token?.email || '');
  const d = (req.data?.details || {}) as Record<string, unknown>;
  const firstName = clean(d.firstName, 40), lastName = clean(d.lastName, 40);
  const phone = clean(d.phone, 30), transporterId = clean(d.transporterId, 20).toUpperCase();
  const name = [firstName, lastName].filter(Boolean).join(' ') || String(req.auth?.token?.name || email.split('@')[0] || 'New member');
  if (!firstName || !lastName) throw fail('invalid-argument', 'Enter your first and last name.');
  if (phone && !/^[+0-9 ()/-]{6,30}$/.test(phone)) throw fail('invalid-argument', 'That phone number doesn\'t look right.');
  const iref = db().doc(`invites/${token}`);
  const out = await db().runTransaction(async (tx) => {
    const snap = await tx.get(iref);
    if (!snap.exists) throw fail('not-found', 'This invite link doesn\'t exist or was cancelled. Ask for a new one.');
    const i = snap.data() as { orgId: string; orgName: string; role: string; stationId: string; stationName: string; expiresAt: number; usedBy: string | null };
    if (i.usedBy === uid) return { orgId: i.orgId, orgName: i.orgName, role: i.role, stationName: i.stationName, already: true };
    if (i.usedBy) throw fail('failed-precondition', 'This invite link was already used. Each link works for one person; ask for a new one.');
    if (Date.now() > i.expiresAt) throw fail('deadline-exceeded', 'This invite link has expired. Links work for 24 hours; ask for a new one.');
    const mref = db().doc(`orgs/${i.orgId}/members/${uid}`);
    const m = await tx.get(mref);
    if (m.exists) throw fail('already-exists', 'You\'re already in {company}. Ask the fleet owner to change your role or station.', { company: i.orgName });
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
  if (!uid) throw fail('unauthenticated', 'Sign in again, then try again.');
  const email = String(req.auth?.token?.email || '');
  const name = String(req.auth?.token?.name || email.split('@')[0] || 'You');
  return createDemo(uid, name, email, req.data?.fresh === true);
});

export const deleteDemoCompany = onCall({ timeoutSeconds: 120 }, async (req) => {
  const who = await guard(req);
  if (who.role !== 'owner') throw fail('permission-denied', 'Only the owner can remove the demo company.');
  const org = await db().doc(`orgs/${who.orgId}`).get();
  if (!org.exists || org.data()?.demo !== true) throw fail('failed-precondition', 'Only a demo company can be removed this way.');
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
  /** Or a video instead of photos (see section 10). */
  startVideoId?: string | null; endVideoId?: string | null;
  /** Given by someone else (a manager or owner): the driver is asked for pick-up photos or a video (section 11). */
  pickupRequested?: boolean;
}
/** Proof at a handover: the photos of a walk-around, or a video. */
interface Media { walkId: string | null; videoId: string | null }
const NO_MEDIA: Media = { walkId: null, videoId: null };
const closeWith = (who: Who, reason: EndReason, media: Media = NO_MEDIA) =>
  ({ end: Date.now(), endedBy: who.uid, endedByName: who.name, endReason: reason, endWalkId: media.walkId, endVideoId: media.videoId });

/**
 * Gives a van to a driver (or a manager) of its station, or ends its assignment when `driverId` is null. The driver
 * is told on their phone and asked for pick-up photos or a video (section 11).
 */
export const assignVan = onCall({ timeoutSeconds: 30, secrets: [WEBPUSH_KEYS] }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const vehicleId = String(req.data?.vehicleId || '');
  const driverId = req.data?.driverId ? String(req.data.driverId) : null;
  if (!ID.test(vehicleId) || (driverId && !/^[A-Za-z0-9_-]{1,128}$/.test(driverId))) throw fail('invalid-argument', 'Unknown van or driver.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  const aCol = org.collection('assignments');
  const r = await db().runTransaction(async (tx) => {
    const v = await tx.get(vref);
    if (!v.exists) throw fail('not-found', 'This van was removed.');
    const van = v.data() as { name: string; plate?: string; stationId?: string; retired?: boolean; assignedTo?: { assignmentId: string; driverId: string } | null };
    needStation(who, van.stationId);
    if (van.retired && driverId) throw fail('failed-precondition', 'This van is retired. Bring it back first.');
    let person: { name: string; role: string; stationIds?: string[] } | null = null;
    let personOpen: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (driverId) {
      const m = await tx.get(org.collection('members').doc(driverId));
      if (!m.exists) throw fail('not-found', 'This person isn\'t in the company any more.');
      person = m.data() as { name: string; role: string; stationIds?: string[] };
      if (!['driver', 'manager'].includes(person.role)) throw fail('invalid-argument', 'Vans go to drivers or fleet managers.');
      if (!van.stationId || !(person.stationIds || []).includes(van.stationId)) throw fail('failed-precondition', '{name} works at another station. Move the van or the person first.', { name: person.name });
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
    if (!driverId || !person) { tx.update(vref, { assignedTo: null }); return { assignmentId: null as string | null }; }
    const now = Date.now();
    const aref = aCol.doc();
    const a: Assignment & { createdAt: number } = {
      vehicleId, vehicleName: van.name, plate: van.plate || '', driverId, driverName: person.name, stationId: van.stationId || null,
      start: now, end: null, startedBy: who.uid, startedByName: who.name, endedBy: null, endedByName: null, endReason: null, createdAt: now,
      startWalkId: null, endWalkId: null, startVideoId: null, endVideoId: null, pickupRequested: driverId !== who.uid,
    };
    tx.set(aref, a);
    tx.update(vref, { assignedTo: { assignmentId: aref.id, driverId, driverName: person.name, since: now } });
    return { assignmentId: aref.id as string | null, vanName: van.name, plate: van.plate || '' };
  });
  // Tell the driver on their phone (best effort: the van is theirs either way, and the app shows it too).
  let notified = 0;
  if (driverId && r.assignmentId && !('unchanged' in r) && driverId !== who.uid && 'vanName' in r) {
    const van = `${r.vanName}${r.plate ? ` (${r.plate})` : ''}`;
    notified = await notify(driverId, (lang) => ({
      title: tr(lang, '{van} is yours', { van: r.vanName }),
      body: tr(lang, '{name} gave you {van}. Before you drive, take the pick-up video or photos.', { name: who.name, van }),
      url: `/vehicle/${vehicleId}`, tag: `van-${vehicleId}`,
    })).catch(() => 0);
  }
  return { assignmentId: r.assignmentId, notified };
});

/** Retires a van (or brings it back). Vans are never deleted: their walk-arounds, checks and history stay. */
export const retireVan = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const vehicleId = String(req.data?.vehicleId || '');
  const restore = req.data?.restore === true;
  if (!ID.test(vehicleId)) throw fail('invalid-argument', 'Unknown van.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  await db().runTransaction(async (tx) => {
    const v = await tx.get(vref);
    if (!v.exists) throw fail('not-found', 'Unknown van.');
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
  if (!ID.test(vehicleId) || !ID.test(stationId)) throw fail('invalid-argument', 'Unknown van or station.');
  if (who.role !== 'owner') throw fail('permission-denied', 'Only the fleet owner moves vans between stations.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  await db().runTransaction(async (tx) => {
    const [v, st] = await Promise.all([tx.get(vref), tx.get(org.collection('stations').doc(stationId))]);
    if (!v.exists || !st.exists) throw fail('not-found', 'Unknown van or station.');
    const van = v.data() as { stationId?: string; assignedTo?: { assignmentId: string } | null };
    if (van.stationId === stationId) return;
    const dref = org.collection('vehicleDetails').doc(vehicleId);
    const details = await tx.get(dref);
    if (van.assignedTo?.assignmentId) tx.update(org.collection('assignments').doc(van.assignedTo.assignmentId), closeWith(who, 'van moved'));
    tx.update(vref, { stationId, assignedTo: null });
    // Its contract, costs and deadlines go with it, so the new station's managers see them (and the old one's don't).
    if (details.exists) tx.update(dref, { stationId });
  });
  return { ok: true };
});

/** Removes someone from the company. Their van becomes free; their history stays. */
export const removePerson = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const uid = String(req.data?.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw fail('invalid-argument', 'Unknown person.');
  if (uid === who.uid) throw fail('failed-precondition', 'You can\'t remove yourself here.');
  const org = db().doc(`orgs/${who.orgId}`);
  const mref = org.collection('members').doc(uid);
  await db().runTransaction(async (tx) => {
    const m = await tx.get(mref);
    if (!m.exists) return;
    const p = m.data() as { role: string; stationIds?: string[] };
    // Owners remove anyone; managers remove drivers of their station.
    if (who.role !== 'owner' && !(p.role === 'driver' && (p.stationIds || []).some((s) => who.stationIds.includes(s)))) {
      throw fail('permission-denied', 'Fleet managers can only remove drivers of their station.');
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
  if (who.role !== 'owner') throw fail('permission-denied', 'Only the fleet owner changes roles and stations.');
  const uid = String(req.data?.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw fail('invalid-argument', 'Unknown person.');
  if (uid === who.uid) throw fail('failed-precondition', 'You can\'t change your own role or station.');
  const role = req.data?.role == null ? null : String(req.data.role);
  const stationId = req.data?.stationId == null ? null : String(req.data.stationId);
  if (role && !['owner', 'manager', 'driver'].includes(role)) throw fail('invalid-argument', 'Unknown role.');
  if (stationId && !ID.test(stationId)) throw fail('invalid-argument', 'Unknown station.');
  if (!role && !stationId) return { ok: true };
  const org = db().doc(`orgs/${who.orgId}`);
  const mref = org.collection('members').doc(uid);
  await db().runTransaction(async (tx) => {
    const m = await tx.get(mref);
    if (!m.exists) throw fail('not-found', 'This person isn\'t in the company any more.');
    if (stationId && !(await tx.get(org.collection('stations').doc(stationId))).exists) throw fail('not-found', 'Unknown station.');
    const p = m.data() as { role: string; stationIds?: string[] };
    const nextRole = role || (p.role === 'admin' ? 'owner' : p.role);
    const nextStations = stationId ? [stationId] : p.stationIds || [];
    const open = (await tx.get(org.collection('assignments').where('driverId', '==', uid).where('end', '==', null))).docs;
    // Their driver record goes with them, so the new station's managers keep it (and the old one's don't see it).
    const rref = org.collection('driverRecords').doc(uid);
    const rec = await tx.get(rref);
    if (rec.exists && nextStations[0] && rec.data()?.stationId !== nextStations[0]) tx.update(rref, { stationId: nextStations[0] });
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
  if (!ID.test(stationId)) throw fail('invalid-argument', 'Unknown station.');
  needStation(who, stationId, N_('Fleet managers can only change this for their station.'));
  const ref = db().doc(`orgs/${who.orgId}/stations/${stationId}`);
  if (!(await ref.get()).exists) throw fail('not-found', 'Unknown station.');
  await ref.update({ selfAssign: req.data?.on === true, selfAssignBy: who.name, selfAssignAt: Date.now() });
  return { ok: true };
});

/** Reads the van and checks this person may pick it up or drop it off at its station right now. */
async function selfService(tx: FirebaseFirestore.Transaction, who: Who, vehicleId: string) {
  if (!['driver', 'manager'].includes(who.role)) throw fail('permission-denied', 'Only drivers and fleet managers pick up vans.');
  if (!ID.test(vehicleId)) throw fail('invalid-argument', 'Unknown van.');
  const org = db().doc(`orgs/${who.orgId}`);
  const vref = org.collection('vehicles').doc(vehicleId);
  const v = await tx.get(vref);
  if (!v.exists) throw fail('not-found', 'Unknown van.');
  const van = v.data() as { name: string; plate?: string; stationId?: string; retired?: boolean; assignedTo?: { assignmentId: string; driverId: string; driverName: string } | null };
  needStation(who, van.stationId);
  const st = await tx.get(org.collection('stations').doc(van.stationId!));
  if (st.data()?.selfAssign !== true) throw fail('failed-precondition', 'At this station your fleet manager gives out the vans. Ask them, or ask them to let drivers pick up vans themselves.');
  return { org, vref, van };
}

// A pick-up or drop-off needs a full walk-around of that van, taken with the camera by this person just now:
// every photo of the van's frame set, none skipped, uploaded in the last two hours, used for one handover only.
const HANDOVER_MAX_AGE = 2 * 3600_000;
interface WalkDoc { vehicleId: string; createdBy: string | null; source: string; frames: number; taken: number; skipped: number; photos: { path?: string }[]; handover?: unknown }
async function checkHandoverPhotos(who: Who, vehicleId: string, walkId: string) {
  if (!ID.test(walkId)) throw fail('invalid-argument', 'Take the photos of the van first.');
  const w = await db().doc(`orgs/${who.orgId}/walkarounds/${walkId}`).get();
  const d = w.data() as WalkDoc | undefined;
  if (!d || d.vehicleId !== vehicleId || d.createdBy !== who.uid) throw fail('failed-precondition', 'These photos aren\'t yours or aren\'t of this van.');
  if (d.handover) throw fail('failed-precondition', 'These photos were already used. Take new ones.');
  if (d.source !== 'camera' || d.skipped > 0 || d.frames < 1 || d.taken < d.frames || (d.photos || []).length < d.frames) {
    throw fail('failed-precondition', 'Every photo of the walk-around is needed, taken with the camera. Take the missing ones.');
  }
  const prefix = `orgs/${who.orgId}/walkarounds/${walkId}/`;
  const files = await Promise.all(d.photos.map(async (p) => {
    if (!p.path || !p.path.startsWith(prefix)) return null;
    try { const [m] = await bucket().file(p.path).getMetadata(); return m; } catch { return null; }
  }));
  if (files.some((m) => !m || Date.now() - new Date(String(m.timeCreated)).getTime() > HANDOVER_MAX_AGE)) {
    throw fail('failed-precondition', 'Some photos didn\'t finish uploading or are more than two hours old. Take them again.');
  }
}
/** In the transaction: the walk-around is still unused; mark it as this handover's photos. */
async function useHandoverPhotos(tx: FirebaseFirestore.Transaction, org: FirebaseFirestore.DocumentReference, walkId: string) {
  const ref = org.collection('walkarounds').doc(walkId);
  const w = await tx.get(ref);
  if ((w.data() as WalkDoc | undefined)?.handover) throw fail('failed-precondition', 'These photos were already used. Take new ones.');
  return ref;
}

/** The photos or the video given for a handover, checked before anything changes. */
async function checkMedia(who: Who, vehicleId: string, data: { walkId?: unknown; videoId?: unknown }): Promise<{ media: Media; video: VideoCheck | null }> {
  const videoId = data?.videoId ? String(data.videoId) : '';
  if (videoId) return { media: { walkId: null, videoId }, video: await checkHandoverVideo(who, videoId) };
  const walkId = String(data?.walkId || '');
  await checkHandoverPhotos(who, vehicleId, walkId);
  return { media: { walkId, videoId: null }, video: null };
}
/** In the transaction: the photos or video aren't used yet. Returns how to mark them as this handover's proof. */
async function useMedia(tx: FirebaseFirestore.Transaction, org: FirebaseFirestore.DocumentReference, who: Who, m: { media: Media; video: VideoCheck | null },
  van: { id: string; name: string; stationId?: string }) {
  if (m.media.walkId) {
    const wref = await useHandoverPhotos(tx, org, m.media.walkId);
    return (kind: 'pickup' | 'dropoff', assignmentId: string) => tx.update(wref, { handover: { kind, assignmentId } });
  }
  const vref = org.collection('videos').doc(m.media.videoId!);
  if ((await tx.get(vref)).exists) throw fail('failed-precondition', 'This video was already used. Record a new one.');
  return (kind: 'pickup' | 'dropoff', assignmentId: string) => tx.create(vref, videoDoc(who, van, m.video!, kind, assignmentId, false));
}

/**
 * The driver takes this van, with pick-up photos or a video. A van someone else still has in the app (they didn't
 * drop it off) is taken over: their assignment ends with this proof. A driver who has another van drops that off first.
 */
export const pickUpVan = onCall({ timeoutSeconds: 120, memory: '2GiB' }, async (req) => {
  const who = await guard(req);
  const vehicleId = String(req.data?.vehicleId || '');
  const m = await checkMedia(who, vehicleId, req.data);
  return db().runTransaction(async (tx) => {
    const { org, vref, van } = await selfService(tx, who, vehicleId);
    if (van.retired) throw fail('failed-precondition', 'This van is retired.');
    if (van.assignedTo?.driverId === who.uid) return { assignmentId: van.assignedTo.assignmentId, unchanged: true };
    const aCol = org.collection('assignments');
    const mine = (await tx.get(aCol.where('driverId', '==', who.uid).where('end', '==', null))).docs;
    if (mine.length) throw fail('failed-precondition', 'Drop off {van} first, with its photos or a video.', { van: (mine[0].data() as Assignment).vehicleName });
    const mark = await useMedia(tx, org, who, m, { id: vehicleId, name: van.name, stationId: van.stationId });
    if (van.assignedTo?.assignmentId) tx.update(aCol.doc(van.assignedTo.assignmentId), closeWith(who, 'taken over', m.media));
    const now = Date.now();
    const aref = aCol.doc();
    const a: Assignment & { createdAt: number } = {
      vehicleId, vehicleName: van.name, plate: van.plate || '', driverId: who.uid, driverName: who.name, stationId: van.stationId || null,
      start: now, end: null, startedBy: who.uid, startedByName: who.name, endedBy: null, endedByName: null, endReason: null, createdAt: now,
      startWalkId: m.media.walkId, endWalkId: null, startVideoId: m.media.videoId, endVideoId: null,
    };
    tx.set(aref, a);
    tx.update(vref, { assignedTo: { assignmentId: aref.id, driverId: who.uid, driverName: who.name, since: now } });
    mark('pickup', aref.id);
    return { assignmentId: aref.id, tookOverFrom: van.assignedTo?.driverName || null };
  });
});

/** The driver hands back the van they have, with drop-off photos or a video. */
export const dropOffVan = onCall({ timeoutSeconds: 120, memory: '2GiB' }, async (req) => {
  const who = await guard(req);
  const vehicleId = String(req.data?.vehicleId || '');
  const m = await checkMedia(who, vehicleId, req.data);
  await db().runTransaction(async (tx) => {
    const { org, vref, van } = await selfService(tx, who, vehicleId);
    if (van.assignedTo?.driverId !== who.uid) throw fail('failed-precondition', 'You don\'t have this van.');
    const mark = await useMedia(tx, org, who, m, { id: vehicleId, name: van.name, stationId: van.stationId });
    tx.update(org.collection('assignments').doc(van.assignedTo.assignmentId), closeWith(who, 'dropped off', m.media));
    tx.update(vref, { assignedTo: null });
    mark('dropoff', van.assignedTo.assignmentId);
  });
  return { ok: true };
});

/* ---------- 10. Videos ---------- */
// An alternative to the photos: one video walking around the van, at pick-up and at drop-off, or any time as a
// walk-around (addVanVideo). The phone uploads the
// original to orgs/{org}/videos/{uploader}/{videoId}/original.*; the server checks it is this person's, recent and
// long enough, writes the video record, and later makes a playback copy (processVideo). Video records are written
// only by the server.

const VIDEO_MIN_MS = 8_000, VIDEO_MAX_MS = 5 * 60_000;
interface VideoCheck { path: string; size: number; contentType: string; durationMs: number; recordedAt: number | null; device: string | null; width: number; height: number; hdr: boolean }

/** Downloads a video to a temporary file, runs fn with its path, then deletes it. */
async function withLocal<T>(path: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'v-'));
  const file = join(dir, path.split('/').pop() || 'video');
  try {
    await bucket().file(path).download({ destination: file });
    return await fn(file);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The uploaded video (for a handover or a walk-around): this person's, uploaded and recorded in the last two hours, 8 seconds to 5 minutes long. */
async function checkHandoverVideo(who: Who, videoId: string): Promise<VideoCheck> {
  if (!ID.test(videoId)) throw fail('invalid-argument', 'Record the video of the van first.');
  const prefix = `orgs/${who.orgId}/videos/${who.uid}/${videoId}/`;
  const [files] = await bucket().getFiles({ prefix });
  const f = files.find((x) => /\/original\.[A-Za-z0-9]{2,5}$/.test(x.name));
  if (!f) throw fail('failed-precondition', 'The video didn\'t finish uploading. Try again.');
  const meta = f.metadata;
  const size = Number(meta.size || 0), contentType = String(meta.contentType || '');
  if (!contentType.startsWith('video/')) throw fail('failed-precondition', 'That file isn\'t a video.');
  if (Date.now() - new Date(String(meta.timeCreated)).getTime() > HANDOVER_MAX_AGE) throw fail('failed-precondition', 'This video was uploaded more than two hours ago. Record a new one.');
  const p = await withLocal(f.name, (file) => probe(file));
  if (!p.hasVideo || !p.durationMs) throw fail('failed-precondition', 'This video can\'t be read. Record it again.');
  if (p.durationMs < VIDEO_MIN_MS) throw fail('failed-precondition', 'The video is {s} seconds long. Walk all the way around the van: at least {min} seconds.', { s: Math.round(p.durationMs / 1000), min: VIDEO_MIN_MS / 1000 });
  if (p.durationMs > VIDEO_MAX_MS) throw fail('failed-precondition', 'The video is longer than 5 minutes. One walk around the van is enough.');
  // Phones write when they recorded it. Allow some clock difference; not every phone or browser writes it.
  if (p.recordedAt && Date.now() - p.recordedAt > HANDOVER_MAX_AGE + 10 * 60_000) {
    throw fail('failed-precondition', 'This video was recorded more than two hours ago. Record a new one at the van.');
  }
  return { path: f.name, size, contentType, durationMs: p.durationMs, recordedAt: p.recordedAt, device: p.device, width: p.width, height: p.height, hdr: p.hdr };
}

type VideoKind = 'pickup' | 'dropoff' | 'walkaround';
function videoDoc(who: Who, van: { id: string; name: string; stationId?: string }, v: VideoCheck, kind: VideoKind, assignmentId: string | null, late: boolean) {
  return {
    vehicleId: van.id, vehicleName: van.name, stationId: van.stationId || null, kind, assignmentId, late,
    by: who.uid, byName: who.name, createdAt: Date.now(), recordedAt: v.recordedAt, durationMs: v.durationMs,
    path: v.path, size: v.size, contentType: v.contentType, device: v.device, width: v.width, height: v.height, hdr: v.hdr,
    status: 'uploaded', playPath: null, posterPath: null, error: null,
  };
}

/**
 * Adds a missing pick-up or drop-off video to a handover after the fact (for example the manager films the van
 * when the driver left without a drop-off video). The handover itself doesn't change: the video points to it.
 */
export const addHandoverVideo = onCall({ timeoutSeconds: 120, memory: '2GiB' }, async (req) => {
  const who = await guard(req);
  const assignmentId = String(req.data?.assignmentId || '');
  const kind = req.data?.kind === 'dropoff' ? 'dropoff' : req.data?.kind === 'pickup' ? 'pickup' : null;
  const videoId = String(req.data?.videoId || '');
  if (!ID.test(assignmentId) || !kind) throw fail('invalid-argument', 'Unknown handover.');
  const org = db().doc(`orgs/${who.orgId}`);
  const aref = org.collection('assignments').doc(assignmentId);
  const a = (await aref.get()).data() as Assignment | undefined;
  if (!a) throw fail('not-found', 'Unknown handover.');
  // The station's staff, or the driver for their own handover.
  if (a.driverId !== who.uid) { needStaff(who); needStation(who, a.stationId, N_('This handover belongs to another station.')); }
  if (kind === 'dropoff' && a.end == null) throw fail('failed-precondition', 'The van hasn\'t been dropped off yet. Drop it off with the video instead.');
  if ((kind === 'pickup' ? a.startWalkId || a.startVideoId : a.endWalkId || a.endVideoId)) throw fail('failed-precondition', kind === 'pickup' ? 'This pick-up already has photos or a video.' : 'This drop-off already has photos or a video.');
  const v = await checkHandoverVideo(who, videoId);
  await db().runTransaction(async (tx) => {
    const vref = org.collection('videos').doc(videoId);
    const used = await tx.get(vref);
    if (used.exists) throw fail('failed-precondition', 'This video was already used. Record a new one.');
    await noProofYet(tx, org, assignmentId, kind);
    tx.create(vref, videoDoc(who, { id: a.vehicleId, name: a.vehicleName, stationId: a.stationId || undefined }, v, kind, assignmentId, isLate(who, a, kind)));
  });
  return { ok: true };
});

/**
 * Was this proof added late? A driver filming the van a manager gave them is the normal pick-up, not late. Anything
 * else added after the handover (a drop-off video later, or a manager's video) is marked as added later.
 */
function isLate(who: Who, a: Assignment, kind: 'pickup' | 'dropoff') {
  return !(kind === 'pickup' && a.driverId === who.uid && a.startedBy !== a.driverId);
}
/** In the transaction: nobody added photos or a video for this end of the handover yet. */
async function noProofYet(tx: FirebaseFirestore.Transaction, org: FirebaseFirestore.DocumentReference, assignmentId: string, kind: 'pickup' | 'dropoff') {
  const [vids, walks] = await Promise.all([
    tx.get(org.collection('videos').where('assignmentId', '==', assignmentId).where('kind', '==', kind).limit(1)),
    tx.get(org.collection('walkarounds').where('handover.assignmentId', '==', assignmentId).where('handover.kind', '==', kind).limit(1)),
  ]);
  if (!vids.empty || !walks.empty) throw fail('failed-precondition', 'Someone already added photos or a video for this.');
}

/**
 * The same with photos: a full walk-around taken with the camera by this person in the last two hours (the driver
 * of the handover, or the station's staff). The walk-around is marked as this handover's photos; the handover
 * itself doesn't change.
 */
export const addHandoverPhotos = onCall({ timeoutSeconds: 60 }, async (req) => {
  const who = await guard(req);
  const assignmentId = String(req.data?.assignmentId || '');
  const kind = req.data?.kind === 'dropoff' ? 'dropoff' : req.data?.kind === 'pickup' ? 'pickup' : null;
  const walkId = String(req.data?.walkId || '');
  if (!ID.test(assignmentId) || !kind) throw fail('invalid-argument', 'Unknown handover.');
  const org = db().doc(`orgs/${who.orgId}`);
  const a = (await org.collection('assignments').doc(assignmentId).get()).data() as Assignment | undefined;
  if (!a) throw fail('not-found', 'Unknown handover.');
  if (a.driverId !== who.uid) { needStaff(who); needStation(who, a.stationId, N_('This handover belongs to another station.')); }
  if (kind === 'dropoff' && a.end == null) throw fail('failed-precondition', 'The van hasn\'t been dropped off yet. Drop it off with the photos instead.');
  if ((kind === 'pickup' ? a.startWalkId || a.startVideoId : a.endWalkId || a.endVideoId)) throw fail('failed-precondition', kind === 'pickup' ? 'This pick-up already has photos or a video.' : 'This drop-off already has photos or a video.');
  await checkHandoverPhotos(who, a.vehicleId, walkId);
  await db().runTransaction(async (tx) => {
    const wref = await useHandoverPhotos(tx, org, walkId);
    await noProofYet(tx, org, assignmentId, kind);
    tx.update(wref, { handover: { kind, assignmentId, late: isLate(who, a, kind) } });
  });
  return { ok: true };
});

/**
 * A walk-around video of a van, outside any handover: anyone who can scan the van (its station's drivers and fleet
 * managers, the owners) can film it at any time, the same way they'd take the walk-around photos. It's kept with
 * the van; if a driver has the van at that moment, the video notes their handover for context. It doesn't pick up
 * or drop off anything.
 */
export const addVanVideo = onCall({ timeoutSeconds: 120, memory: '2GiB' }, async (req) => {
  const who = await guard(req);
  const vehicleId = String(req.data?.vehicleId || '');
  const videoId = String(req.data?.videoId || '');
  if (!ID.test(vehicleId)) throw fail('invalid-argument', 'Unknown van.');
  const org = db().doc(`orgs/${who.orgId}`);
  const van = (await org.collection('vehicles').doc(vehicleId).get()).data() as { name: string; stationId?: string; retired?: boolean; assignedTo?: { assignmentId: string } | null } | undefined;
  if (!van) throw fail('not-found', 'Unknown van.');
  needStation(who, van.stationId);
  if (van.retired) throw fail('failed-precondition', 'This van is retired.');
  const v = await checkHandoverVideo(who, videoId);
  await db().runTransaction(async (tx) => {
    const vref = org.collection('videos').doc(videoId);
    if ((await tx.get(vref)).exists) throw fail('failed-precondition', 'This video was already used. Record a new one.');
    tx.create(vref, videoDoc(who, { id: vehicleId, name: van.name, stationId: van.stationId }, v, 'walkaround', van.assignedTo?.assignmentId || null, false));
  });
  return { ok: true };
});

/**
 * Makes the playback copy and poster of a video. The app starts it right after a handover; anyone who opens a
 * video that isn't ready starts it again, so it gets done even if the phone went offline. Safe to run twice.
 */
export const processVideo = onCall({ timeoutSeconds: 540, memory: '4GiB', cpu: 4, concurrency: 1 }, async (req) => {
  const who = await guard(req);
  const videoId = String(req.data?.videoId || '');
  if (!ID.test(videoId)) throw fail('invalid-argument', 'Unknown video.');
  const ref = db().doc(`orgs/${who.orgId}/videos/${videoId}`);
  const go = await db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as { stationId: string | null; by: string; status: string; processingAt?: number } | undefined;
    if (!d) throw fail('not-found', 'Unknown video.');
    if (d.by !== who.uid) needStation(who, d.stationId, N_('This video belongs to another station.'));
    if (d.status === 'ready') return false;
    if (d.status === 'processing' && Date.now() - (d.processingAt || 0) < 10 * 60_000) return false;
    tx.update(ref, { status: 'processing', processingAt: Date.now() });
    return true;
  });
  if (!go) return { started: false };
  const d = (await ref.get()).data() as { path: string; hdr?: boolean };
  const base = d.path.replace(/original\.[A-Za-z0-9]+$/, '');
  try {
    await withLocal(d.path, async (file) => {
      const out = file.replace(/[^/]+$/, 'play.mp4'), jpg = file.replace(/[^/]+$/, 'poster.jpg');
      const pr = await probe(file);
      await makePlayback(file, out, jpg, pr.hdr || !!d.hdr);
      const playSize = (await fsp.stat(out)).size;
      await Promise.all([
        bucket().upload(out, { destination: `${base}play.mp4`, contentType: 'video/mp4', resumable: false }),
        bucket().upload(jpg, { destination: `${base}poster.jpg`, contentType: 'image/jpeg', resumable: false }),
      ]);
      await ref.update({ status: 'ready', playPath: `${base}play.mp4`, posterPath: `${base}poster.jpg`, playSize, readyAt: Date.now(), error: null });
    });
  } catch (e) {
    await ref.update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 300) });
    throw fail('internal', 'Couldn\'t convert the video. The original is kept.');
  }
  return { started: true };
});

/* ---------- 11. Phone notifications ---------- */
// Through the browser's push service: the web app (on iPhones only when it's on the home screen, iOS 16.4 or
// later), after the person turned notifications on in the Account tab. Each phone or browser is one
// users/{uid}/push/{id} record. Expo Go can't receive them. Only real push services are used; the emulator tests
// receive them on this computer.
const PUSH_SERVICES = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const pushAllowed = (endpoint: string) => PUSH_SERVICES.test(endpoint)
  || (process.env.FUNCTIONS_EMULATOR === 'true' && /^http:\/\/127\.0\.0\.1:\d+\//.test(endpoint));

/** Sends a notification to every phone this person turned notifications on for. Returns how many took it. */
type Note = { title: string; body: string; url: string; tag?: string };
/** Sends a notification to every phone this person turned notifications on for, in their language (see langOf). */
async function notify(uid: string, make: Note | ((lang: string) => Note)): Promise<number> {
  let keys: { publicKey?: string; privateKey?: string } = {};
  try { keys = JSON.parse(WEBPUSH_KEYS.value() || '{}'); } catch { return 0; }
  if (!keys.publicKey || !keys.privateKey) return 0;
  const subs = await db().collection(`users/${uid}/push`).limit(10).get();
  if (!subs.size) return 0;
  const msg = typeof make === 'function' ? make(await langOf(uid)) : make;
  const project = process.env.GCLOUD_PROJECT || 'fleet-check';
  const sent = await Promise.all(subs.docs.map(async (d) => {
    const s = d.data() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth || !pushAllowed(s.endpoint)) return 0;
    try {
      const r = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, JSON.stringify(msg), {
        vapidDetails: { subject: `https://${project}.web.app`, publicKey: keys.publicKey!, privateKey: keys.privateKey! },
        TTL: 12 * 3600, urgency: 'high',
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers || {})) if (k.toLowerCase() !== 'content-length') headers[k] = String(v);
      const res = await fetch(r.endpoint, { method: r.method, headers, body: new Uint8Array(r.body as Buffer), signal: AbortSignal.timeout(8000) });
      // The phone turned notifications off or the browser dropped the subscription: forget it.
      if (res.status === 404 || res.status === 410) { await d.ref.delete().catch(() => {}); return 0; }
      return res.ok ? 1 : 0;
    } catch { return 0; }
  }));
  return sent.reduce((n: number, x) => n + x, 0);
}

/* ---------- 12. Driver records: licence checks ---------- */
// The record itself (licence, employment, briefings, emergency contact) is kept by owners and the driver's station
// managers in the app (the rules check it). A licence check is proof, so it is added here and never changed: who
// looked at the licence, on which day, and whether it was fine.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const recordLicenceCheck = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const uid = String(req.data?.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw fail('invalid-argument', 'Unknown person.');
  if (uid === who.uid) throw fail('failed-precondition', 'Someone else has to check your own licence.');
  const day = String(req.data?.day || '');
  const t = DAY_RE.test(day) ? Date.parse(`${day}T12:00:00Z`) : NaN;
  if (!Number.isFinite(t) || t > Date.now() + 36 * 3600_000 || t < Date.now() - 366 * 86400_000) {
    throw fail('invalid-argument', 'Enter the day of the check: today or a day in the last 12 months.');
  }
  const ok = req.data?.ok !== false;
  const note = clean(req.data?.note, 300);
  if (!ok && !note) throw fail('invalid-argument', 'Say what the problem with the licence is.');
  const org = db().doc(`orgs/${who.orgId}`);
  const m = (await org.collection('members').doc(uid).get()).data() as { stationIds?: string[] } | undefined;
  if (!m) throw fail('not-found', 'This person isn\'t in the company any more.');
  const stations = m.stationIds || [];
  if (who.role !== 'owner' && !stations.some((st) => who.stationIds.includes(st))) throw fail('permission-denied', 'This person works at another station.');
  const ref = org.collection('driverRecords').doc(uid);
  const entry = { day, at: Date.now(), by: who.uid, byName: who.name, ok, note };
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) tx.update(ref, { checks: FieldValue.arrayUnion(entry), updatedAt: Date.now(), updatedByName: who.name });
    else tx.set(ref, { stationId: stations[0] || null, createdAt: Date.now(), updatedAt: Date.now(), updatedByName: who.name, checks: [entry] });
  });
  return { ok: true };
});

/* ---------- 13. Dashboard photos and tours ---------- */
// Where the owner turns it on, the driver takes a photo of the dashboard at the start and at the end of each tour.
// The AI reads the odometer, the fuel or battery level and the warning lights (readDashboard); the driver checks
// and corrects the numbers and saves them (saveReading). The server then starts or ends the tour, works out the
// kilometres and, when it can, the fuel or energy used, and keeps the van's odometer up to date.

interface VanDoc {
  name: string; plate?: string; stationId?: string; retired?: boolean; make?: string | null; model?: string | null; cls?: string;
  fuel?: Fuel; tankL?: number | null; batteryKwh?: number | null;
  assignedTo?: { assignmentId: string; driverId: string; driverName: string } | null;
}
const READ_MAX_AGE = 2 * 3600_000;
const staffAt = (w: Who, stationId: string | null | undefined) => w.role === 'owner' || (w.role === 'manager' && !!stationId && w.stationIds.includes(stationId));

async function dashOn(orgId: string) {
  if ((await db().doc(`orgs/${orgId}`).get()).data()?.dashScans !== true) {
    throw fail('failed-precondition', 'Dashboard photos are off for this company. The owner turns them on in the Account tab.');
  }
}

type Q = FirebaseFirestore.Query;
type R = FirebaseFirestore.DocumentReference;
/** The van, its open tours, what saving a photo would do, and its last reading. Reads only (for transactions too). */
async function readingContext(org: R, who: Who, vehicleId: string, getQ: (q: Q) => Promise<FirebaseFirestore.QuerySnapshot>, getR: (r: R) => Promise<FirebaseFirestore.DocumentSnapshot>) {
  if (!ID.test(vehicleId)) throw fail('invalid-argument', 'Unknown van.');
  const van = (await getR(org.collection('vehicles').doc(vehicleId))).data() as VanDoc | undefined;
  if (!van) throw fail('not-found', 'Unknown van.');
  needStation(who, van.stationId);
  const openSnap = await getQ(org.collection('tours').where('vehicleId', '==', vehicleId).where('open', '==', true).limit(5));
  const open = openSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() as TourDoc }));
  const hasVan = van.assignedTo?.driverId === who.uid && !van.retired;
  const plan = planReading({ id: who.uid, name: who.name }, staffAt(who, van.stationId), hasVan,
    open.map((o) => ({ id: o.id, driverId: o.data.driverId, driverName: o.data.driverName, vehicleId, startAt: o.data.startAt })), Date.now());
  if (!plan) throw fail('permission-denied', 'You don\'t have this van. The driver who has it, or the station\'s fleet manager, takes its dashboard photo.');
  // Starting a tour ends any tour of this person still open on another van (without an end photo).
  const elsewhere = plan.startFor
    ? (await getQ(org.collection('tours').where('driverId', '==', who.uid).where('open', '==', true).limit(10))).docs.filter((d) => d.data().vehicleId !== vehicleId)
    : [];
  const l = (await getQ(org.collection('readings').where('vehicleId', '==', vehicleId).orderBy('at', 'desc').limit(1))).docs[0]?.data();
  const last = l ? { km: Number(l.odometerKm), at: Number(l.at), byName: String(l.byName || '') } : null;
  return { van, open, plan, elsewhere, last };
}

const numIn = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const warnList = (v: unknown) => Array.from(new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim())
  .map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 40)))).slice(0, 8);
/** The AI's answer, cleaned: whole kilometres (miles converted), levels 0 to 100 with one decimal. */
function dashValues(o: Record<string, unknown>) {
  let odo = numIn(o.odometerKm, 0, 3_000_000);
  if (odo != null && o.unit === 'mi') odo = odo * 1.609344;
  const pct = (v: unknown) => { const n = numIn(v, 0, 100); return n == null ? null : Math.round(n * 10) / 10; };
  const range = numIn(o.rangeKm, 0, 2000);
  return {
    odometerKm: odo == null ? null : Math.round(odo), fuelPct: pct(o.fuelPct), batteryPct: pct(o.batteryPct),
    rangeKm: range == null ? null : Math.round(range), warnings: warnList(o.warnings),
  };
}

export const readDashboard = onCall(opts(120), async (req) => {
  const who = await guard(req);
  await dashOn(who.orgId);
  const vehicleId = String(req.data?.vehicleId || '');
  const path = checkPath(req.data?.path, `orgs/${who.orgId}/dash/${who.uid}/`);
  const org = db().doc(`orgs/${who.orgId}`);
  const ctx = await readingContext(org, who, vehicleId, (q) => q.get(), (r) => r.get());
  const img = await fit(await download(path));
  const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), who.tier, [{ image: img }], dashPrompt(ctx.van), dashSchema, 700);
  const values = dashValues(a.obj);
  const confidence = numIn(a.obj.confidence, 0, 1);
  const readable = a.obj.readable !== false && values.odometerKm != null;
  const issue = str(a.obj.issue, 200);
  const ref = org.collection('dashReads').doc();
  await ref.set({
    by: who.uid, byName: who.name, vehicleId, stationId: ctx.van.stationId || null, path, at: Date.now(), createdAt: Date.now(),
    ai: values, confidence, readable, issue, model: a.model, tier: who.tier, usage: a.usage, used: false,
  });
  return {
    readId: ref.id, values, confidence, readable, issue, will: ctx.plan.will, tourDriver: ctx.plan.tourDriver, last: ctx.last,
    endsMine: ctx.plan.ends.some((e) => e.tour.driverId === who.uid && e.how === 'photo'),
    ...(who.creator ? { usage: a.usage } : {}),
  };
});

export const saveReading = onCall({ timeoutSeconds: 30 }, async (req) => {
  const who = await guard(req);
  await dashOn(who.orgId);
  const readId = String(req.data?.readId || '');
  if (!ID.test(readId)) throw fail('invalid-argument', 'Take the dashboard photo again.');
  const v = (req.data?.values || {}) as Record<string, unknown>;
  const odometerKm = Math.round(Number(v.odometerKm));
  if (v.odometerKm == null || v.odometerKm === '' || !Number.isFinite(odometerKm) || odometerKm < 0 || odometerKm > 3_000_000) {
    throw fail('invalid-argument', 'Enter the odometer reading in km.');
  }
  const pct = (x: unknown, what: string) => {
    if (x == null || x === '') return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw fail('invalid-argument', what === 'fuel level' ? 'The fuel level is a percentage from 0 to 100.' : 'The battery level is a percentage from 0 to 100.');
    return Math.round(n * 10) / 10;
  };
  const fuelPct = pct(v.fuelPct, 'fuel level'), batteryPct = pct(v.batteryPct, 'battery level');
  const rangeKm = v.rangeKm == null || v.rangeKm === '' ? null : Math.round(Math.max(0, Math.min(2000, Number(v.rangeKm) || 0)));
  const warnings = warnList(v.warnings);
  const values = { odometerKm, fuelPct, batteryPct, rangeKm, warnings };
  const rf = req.data?.refuel as Record<string, unknown> | null | undefined;
  const amount = (x: unknown) => { const n = Number(x); return x == null || x === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(400, Math.round(n * 10) / 10); };
  const refuel: Refuel | null = rf ? { litres: amount(rf.litres), kwh: amount(rf.kwh), unknown: rf.unknown === true } : null;
  const sure = req.data?.sure === true;
  const org = db().doc(`orgs/${who.orgId}`);
  const rref = org.collection('dashReads').doc(readId);

  const out = await db().runTransaction(async (tx) => {
    const rd = (await tx.get(rref)).data() as { by: string; vehicleId: string; path: string; at: number; used?: boolean; ai: Record<string, unknown>; confidence: number | null } | undefined;
    if (!rd || rd.by !== who.uid) throw fail('not-found', 'Take the dashboard photo again.');
    if (rd.used) throw fail('failed-precondition', 'This photo is already saved.');
    if (Date.now() - rd.at > READ_MAX_AGE) throw fail('failed-precondition', 'This photo is more than two hours old. Take a new one.');
    const { van, open, plan, elsewhere, last } = await readingContext(org, who, rd.vehicleId, (q) => tx.get(q), (r) => tx.get(r));
    if (last && odometerKm < last.km && !(sure && staffAt(who, van.stationId))) {
      throw fail('failed-precondition', last.byName ? 'The odometer can\'t go down: it showed {km} km on {day} ({name}). Check the number.' : 'The odometer can\'t go down: it showed {km} km on {day}. Check the number.',
        { km: Math.round(last.km), day: new Date(last.at).toISOString().slice(0, 10), name: last.byName });
    }
    const days = last ? Math.max(1, (Date.now() - last.at) / 86400_000) : 1;
    if (last && odometerKm - last.km > Math.max(1500, 1200 * days) && !sure) {
      throw fail('out-of-range', 'That\'s {more} km more than the last reading ({km} km). Check the number, or confirm it\'s right.', { more: Math.round(odometerKm - last.km), km: Math.round(last.km) });
    }
    const detRef = org.collection('vehicleDetails').doc(rd.vehicleId);
    const det = await tx.get(detRef);

    const now = Date.now();
    const reading = org.collection('readings').doc();
    const point: TourEnd = { readingId: reading.id, at: now, km: odometerKm, fuelPct, batteryPct, by: who.uid, byName: who.name };
    const facts = { fuel: van.fuel || null, tankL: van.tankL ?? null, batteryKwh: van.batteryKwh ?? null };
    let ended: (TourDoc & { id: string }) | null = null;
    for (const e of plan.ends) {
      const t = open.find((o) => o.id === e.tour.id)!;
      const n = tourNumbers(t.data.start, point, e.how, e.how === 'photo' ? refuel : null, facts);
      const patch = { end: point, endedHow: e.how, refuel: e.how === 'photo' ? refuel : null, ...n, warnings: warnList([...(t.data.warnings || []), ...warnings]), open: false };
      tx.update(t.ref, patch);
      if (!ended) ended = { ...t.data, ...patch, id: t.id };
    }
    for (const d of elsewhere) tx.update(d.ref, { endedHow: 'none', open: false });
    let started: (TourDoc & { id: string }) | null = null;
    if (plan.startFor) {
      const tref = org.collection('tours').doc();
      const t: TourDoc = {
        driverId: plan.startFor.id, driverName: plan.startFor.name, vehicleId: rd.vehicleId, vehicleName: van.name, plate: van.plate || '',
        stationId: van.stationId || null, model: modelOf(van), cls: van.cls || null, fuel: van.fuel || null,
        assignmentId: van.assignedTo?.driverId === plan.startFor.id ? van.assignedTo.assignmentId : null,
        start: point, end: null, endedHow: null, refuel: null, km: null, hours: null, used: null, unit: null, per100: null,
        warnings, startAt: now, createdAt: now,
      };
      tx.set(tref, { ...t, open: true });
      started = { ...t, id: tref.id };
    }
    const ai = { ...(rd.ai as object), confidence: rd.confidence } as Record<string, unknown>;
    const corrected: string[] = (['odometerKm', 'fuelPct', 'batteryPct', 'rangeKm'] as const).filter((k) => (ai[k] ?? null) !== values[k]);
    if (JSON.stringify(warnList(ai.warnings).sort()) !== JSON.stringify(warnings.slice().sort())) corrected.push('warnings');
    const role = started ? 'start' : ended ? 'end' : 'none';
    tx.set(reading, {
      vehicleId: rd.vehicleId, vehicleName: van.name, stationId: van.stationId || null, by: who.uid, byName: who.name,
      driverId: started?.driverId || ended?.driverId || van.assignedTo?.driverId || null, at: now, createdAt: now, path: rd.path,
      ...values, ai, corrected, refuel: ended ? refuel : null, tourId: started?.id || ended?.id || null, endedTourId: ended?.id || null, role,
    });
    tx.update(rref, { used: true, readingId: reading.id, values, corrected });
    // The van's odometer in its record, for the mileage against the contract and the service by distance.
    const today = new Date(now).toISOString().slice(0, 10);
    if (!det.exists) tx.set(detRef, { stationId: van.stationId || null, createdAt: now, odometerKm, odometerAt: today, updatedAt: now, updatedByName: who.name });
    else if (Number(det.data()?.odometerKm ?? -1) <= odometerKm) tx.update(detRef, { odometerKm, odometerAt: today });
    return { readingId: reading.id, tourId: started?.id || ended?.id || null, role, tour: ended || started };
  });
  return out;
});

/* ---------- 14. Damage log: new damage and who had the van, for the driver numbers ---------- */
// Written from each reviewed check (see fleetlog.ts). The app asks for it right after a review is finished; the
// Data tab fills in any that are missing or out of date for the period it shows.

export const logReview = onCall({ timeoutSeconds: 40 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const checkId = String(req.data?.checkId || '');
  if (!ID.test(checkId)) throw fail('invalid-argument', 'Unknown check.');
  const k = (await db().doc(`orgs/${who.orgId}/checks/${checkId}`).get()).data() as { stationId?: string } | undefined;
  if (!k) throw fail('not-found', 'Unknown check.');
  needStation(who, k.stationId);
  await damageLogFor(who.orgId, checkId);
  return { ok: true };
});

export const syncDamageLog = onCall({ timeoutSeconds: 120 }, async (req) => {
  const who = await guard(req);
  needStaff(who);
  const since = Math.max(0, Number(req.data?.since) || 0);
  const org = db().doc(`orgs/${who.orgId}`);
  const snap = await org.collection('checks').where('createdAt', '>=', since - 86400_000).orderBy('createdAt', 'desc').limit(2000).get();
  const reviewed = snap.docs.filter((d) => {
    const x = d.data() as { stationId?: string; status?: string };
    return x.status === 'reviewed' && (who.role === 'owner' || (!!x.stationId && who.stationIds.includes(x.stationId)));
  });
  const stale: string[] = [];
  for (let i = 0; i < reviewed.length; i += 300) {
    const part = reviewed.slice(i, i + 300);
    const logs = await db().getAll(...part.map((d) => org.collection('damageLog').doc(d.id)));
    part.forEach((d, j) => {
      const at = (d.data() as { review?: { at?: number | null } }).review?.at ?? null;
      if (!logs[j].exists || (logs[j].data()?.reviewAt ?? null) !== at) stale.push(d.id);
    });
  }
  const todo = stale.slice(0, 300);
  await pool(todo, 6, (id) => damageLogFor(who.orgId, id));
  return { updated: todo.length };
});

/* ---------- 15. Records from a photo of a document ---------- */
// Owners and the station's managers photograph a van's papers (registration certificate, lease or insurance
// contract, inspection report, service invoice...) or a driver's (driving licence, employment contract, briefing
// record). The AI says what the document is and reads the details the app keeps, sorted into the record's sections
// on the phone; the person checks them before anything is saved. The photos are deleted straight after reading,
// so no copy of a licence or contract is kept. Costs are only read for owners.

export const readDocument = onCall(opts(180), async (req) => {
  const who = await guard(req);
  needStaff(who);
  const target = req.data?.target === 'driver' ? 'driver' : req.data?.target === 'van' ? 'van' : null;
  const id = String(req.data?.id || '');
  if (!target || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw fail('invalid-argument', 'Unknown van or person.');
  const raw = Array.isArray(req.data?.paths) ? req.data.paths : [];
  if (!raw.length || raw.length > 6) throw fail('invalid-argument', 'Send 1 to 6 photos of the document.');
  const paths: string[] = raw.map((p: unknown) => checkPath(p, `orgs/${who.orgId}/docs/${who.uid}/`));
  const org = db().doc(`orgs/${who.orgId}`);
  try {
    let about: string;
    if (target === 'van') {
      const van = (await org.collection('vehicles').doc(id).get()).data() as { name?: string; plate?: string; make?: string; model?: string; stationId?: string } | undefined;
      if (!van) throw fail('not-found', 'Unknown van.');
      needStation(who, van.stationId);
      about = `the van ${van.name || ''}${van.plate ? `, number plate ${van.plate}` : ''}${van.make || van.model ? `, a ${[van.make, van.model].filter(Boolean).join(' ')}` : ''}`;
    } else {
      const m = (await org.collection('members').doc(id).get()).data() as { name?: string; stationIds?: string[] } | undefined;
      if (!m) throw fail('not-found', 'This person isn\'t in the company any more.');
      if (who.role !== 'owner' && !(m.stationIds || []).some((st) => who.stationIds.includes(st))) throw fail('permission-denied', 'This person works at another station.');
      about = `the driver ${m.name || ''}`;
    }
    // Managers don't see costs: they aren't even asked for.
    const fields = (target === 'van' ? VAN_FIELDS : DRIVER_FIELDS).filter((f) => !f.owner || who.role === 'owner');
    const imgs = await pool(paths, 3, async (p) => fit(await download(p)));
    const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), who.tier, imgs.map((image, i) => ({ label: imgs.length > 1 ? `Page ${i + 1}` : undefined, image })),
      docPrompt(target, about, fields, imgs.length), docSchema(target, fields), 3000);
    const found = cleanFields(a.obj.fields, fields);
    const out = {
      kind: String(a.obj.documentType || 'other'), title: str(a.obj.title, 80), readable: a.obj.readable !== false,
      sameName: target === 'driver' ? String(a.obj.sameName || 'not shown') : null, notes: str(a.obj.notes, 200), fields: found,
    };
    // What it cost, for the app creator (no values: a lease contract's costs aren't for everyone who reads this).
    await org.collection('docReads').add({ by: who.uid, byName: who.name, target, kind: out.kind, pages: imgs.length, found: found.length,
      model: a.model, tier: who.tier, usage: a.usage, createdAt: Date.now() });
    return { ...out, ...(who.creator ? { usage: a.usage } : {}) };
  } finally {
    // No copy of the document is kept.
    await Promise.all(paths.map((p) => bucket().file(p).delete().catch(() => {})));
  }
});

/* ---------- 16. Refuel, wash and parts ---------- */
// Refuelling and washing (anyone who works at the van's station) and buying parts (owners and the station's
// managers). Each attempt is a record in orgs/{org}/purchases, written only here and never deleted, whether it
// finished, was refused or was given up. It starts with a photo of the dashboard. For refuelling and washing, the
// van's fuel card is then checked from a photo: the quick model reads the last 4 digits, and anything but a clear
// match is read again by a stronger model before the driver is stopped. The card photo is deleted straight away
// (it could be someone's own bank card); only the last 4 digits are kept. A card that isn't the van's, or no card,
// stops the driver: the station's managers get a notification and allow or refuse it. Then the receipt: the AI
// reads it, the driver confirms the numbers, and the managers get a notification with the details and anything
// that looks wrong (flags; they never block).

type BuyStatus = 'open' | 'waiting' | 'refused' | 'done' | 'cancelled';
interface BuyDoc {
  kind: BuyKind; status: BuyStatus; vehicleId: string; vehicleName: string; plate: string | null; stationId: string | null;
  vanFuel: string | null; tankL: number | null; by: string; byName: string; role: Role; vanDriverName: string | null; notTheirVan: boolean;
  dash: { path: string; at: number; ai: ReturnType<typeof dashValues> | null; confidence: number | null; readable: boolean; issue: string | null; done: boolean };
  lastKm: number | null;
  card: { needed: boolean; expected: string | null; result: 'match' | 'mismatch' | 'unclear' | 'missing' | null; read: Omit<CardRead, 'confidence' | 'issue' | 'isCard'> | null; tries: number; why: string | null; expired: boolean | null; at: number | null };
  decision: { allow: boolean; by: string; byName: string; at: number; note: string } | null;
  receipt: { path: string; at: number; ai: Receipt } | null;
  parts: string[]; note: string | null; createdAt: number;
}
const OPEN_BUY: BuyStatus[] = ['open', 'waiting', 'refused'];
const buyPath = (w: Who) => `orgs/${w.orgId}/buys/${w.uid}/`;
const plateText = (p: { plate: string | null }) => (p.plate ? ` (${p.plate})` : '');

/** Who hears about it: the station's fleet managers, or the owners where the station has none (parts: the owners). */
async function bossesOf(orgId: string, stationId: string | null, kind: BuyKind, except: string) {
  const org = db().doc(`orgs/${orgId}`);
  type P = { uid: string; name: string; phone: string | null };
  const toP = (d: FirebaseFirestore.QueryDocumentSnapshot): P => {
    const x = d.data() as { name?: string; phone?: string };
    return { uid: d.id, name: x.name || 'Fleet manager', phone: typeof x.phone === 'string' && x.phone.trim() ? x.phone.trim() : null };
  };
  if (kind !== 'parts' && stationId) {
    const ms = (await org.collection('members').where('stationIds', 'array-contains', stationId).get()).docs
      .filter((d) => d.data().role === 'manager' && d.id !== except);
    if (ms.length) return ms.map(toP);
  }
  return (await org.collection('members').where('role', 'in', ['owner', 'admin']).get()).docs.filter((d) => d.id !== except).map(toP);
}
async function tell(people: { uid: string }[], msg: Note | ((lang: string) => Note)) {
  const n = await Promise.all(people.map((x) => notify(x.uid, msg).catch(() => 0)));
  return n.reduce((a, b) => a + b, 0);
}

async function loadBuy(org: R, id: unknown) {
  const sid = String(id || '');
  if (!ID.test(sid)) throw fail('invalid-argument', 'Unknown refuel.');
  const ref = org.collection('purchases').doc(sid);
  const snap = await ref.get();
  if (!snap.exists) throw fail('not-found', 'Unknown refuel.');
  return { ref, p: snap.data() as BuyDoc };
}
/** Only the person who started it takes its photos. */
async function myBuy(org: R, who: Who, id: unknown) {
  const x = await loadBuy(org, id);
  if (x.p.by !== who.uid) throw fail('permission-denied', 'Only the person who started it can carry on with it.');
  return x;
}
async function logBuyRead(org: R, who: Who, purchaseId: string, step: string, model: string, usage: Usage, extra: object = {}) {
  await org.collection('buyReads').add({ purchaseId, step, by: who.uid, byName: who.name, model, tier: who.tier, usage, createdAt: Date.now(), ...extra }).catch(() => {});
}

async function buyStart(who: Who, org: R, d: Record<string, unknown>) {
  const kind = BUY_KINDS.includes(d.kind as BuyKind) ? (d.kind as BuyKind) : null;
  if (!kind) throw fail('invalid-argument', 'Refuel, wash or parts?');
  if (kind === 'parts') needStaff(who);
  const vehicleId = String(d.vehicleId || '');
  if (!ID.test(vehicleId)) throw fail('invalid-argument', 'Unknown van.');
  const path = checkPath(d.path, buyPath(who));
  const van = (await org.collection('vehicles').doc(vehicleId).get()).data() as VanDoc | undefined;
  if (!van) throw fail('not-found', 'Unknown van.');
  needStation(who, van.stationId);
  if (van.retired) throw fail('failed-precondition', 'This van is retired.');
  if (kind === 'fuel' && van.fuel === 'electric') throw fail('failed-precondition', 'Electric vans are charged, not refuelled.');
  const det = (await org.collection('vehicleDetails').doc(vehicleId).get()).data() as { fuelCard?: string; odometerKm?: number } | undefined;
  const expected = kind === 'parts' ? null : cardDigits(det?.fuelCard);
  // One at a time: anything this person left half done is closed (and stays in the history).
  const now = Date.now();
  const left = (await org.collection('purchases').where('by', '==', who.uid).orderBy('createdAt', 'desc').limit(10).get()).docs
    .filter((x) => OPEN_BUY.includes(x.data().status));
  await Promise.all(left.map((x) => x.ref.update({ status: 'cancelled', cancel: { by: who.uid, byName: who.name, at: now, reason: N_('Started another one') }, updatedAt: now })));

  // The photo must be there; the AI reads it in a second call (dash) while the driver already takes the card photo.
  try { await bucket().file(path).getMetadata(); } catch { throw fail('not-found', 'The dashboard photo is missing. Take it again.'); }
  const ref = org.collection('purchases').doc();
  const dash: BuyDoc['dash'] = { path, at: now, ai: null, confidence: null, readable: false, issue: null, done: false };
  const doc: BuyDoc & Record<string, unknown> = {
    kind, status: 'open', vehicleId, vehicleName: van.name, plate: van.plate || null, stationId: van.stationId || null, model: modelOf(van),
    vanFuel: van.fuel || null, tankL: van.tankL ?? null, by: who.uid, byName: who.name, role: who.role,
    vanDriverId: van.assignedTo?.driverId || null, vanDriverName: van.assignedTo?.driverName || null,
    notTheirVan: who.role === 'driver' && !!van.assignedTo && van.assignedTo.driverId !== who.uid,
    dash, lastKm: typeof det?.odometerKm === 'number' ? det.odometerKm : null,
    card: { needed: !!expected, expected, result: null, read: null, tries: 0, why: null, expired: null, at: null },
    decision: null, receipt: null, parts: [], note: null, flags: [], corrected: [],
    odometerKm: null, fuelPct: null, litres: null, total: null, currency: null, merchant: null, cancel: null,
    createdAt: now, updatedAt: now, doneAt: null,
  };
  await ref.set(doc);
  return { id: ref.id, needsCard: !!expected, lastKm: doc.lastKm };
}

/** The AI reads the dashboard photo (odometer, fuel gauge). If it can't, the driver types the numbers at the end. */
async function buyDash(who: Who, org: R, d: Record<string, unknown>) {
  const { ref, p } = await myBuy(org, who, d.id);
  const out = (x: BuyDoc['dash']) => ({ values: x.ai, readable: x.readable, confidence: x.confidence, issue: x.issue });
  if (p.dash.done) return out(p.dash);
  const img = await fit(await download(p.dash.path));
  let dash: BuyDoc['dash'] = { ...p.dash, done: true, issue: 'The AI couldn\'t read it.' };
  try {
    const van = { name: p.vehicleName, make: null, model: (p as unknown as { model?: string | null }).model || null, fuel: p.vanFuel as VanDoc['fuel'] };
    const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), who.tier, [{ image: img }], dashPrompt(van), dashSchema, 700);
    const values = dashValues(a.obj);
    dash = { ...p.dash, done: true, ai: values, confidence: numIn(a.obj.confidence, 0, 1), readable: a.obj.readable !== false && values.odometerKm != null, issue: str(a.obj.issue, 200) };
    await logBuyRead(org, who, ref.id, 'dash', a.model, a.usage);
  } catch (e) {
    // At the pump the driver carries on: the odometer is typed in at the end instead.
    logger.warn('Dashboard not read for a refuel', { message: String((e as Error)?.message || e) });
  }
  await ref.update({ dash, updatedAt: Date.now() });
  return out(dash);
}

async function buyCard(who: Who, org: R, d: Record<string, unknown>) {
  const { ref, p } = await myBuy(org, who, d.id);
  if (p.status !== 'open' || !p.card.needed || p.card.result === 'match' || p.decision) throw fail('failed-precondition', 'The card was already checked.');
  const expected = p.card.expected!;
  const stop = async (result: 'mismatch' | 'unclear' | 'missing', why: Said, read: CardRead | null, tries: number, extra: object = {}) => {
    const now = Date.now();
    const keep = read ? { kind: read.kind, issuer: read.issuer, last4: read.last4, plate: read.plate, expiry: read.expiry } : null;
    await ref.update({ status: 'waiting', card: { ...p.card, result, read: keep, tries, why: why.text, whyT: why.t, whyV: why.v, expired: read ? expired(read.expiry, now) : null, at: now, ...extra }, updatedAt: now });
    const bosses = await bossesOf(who.orgId, p.stationId, p.kind, who.uid);
    const van = `${p.vehicleName}${plateText(p)}`;
    await tell(bosses, (lang) => ({
      title: result === 'missing' ? tr(lang, 'Stop: {van}, no fuel card', { van }) : result === 'unclear' ? tr(lang, 'Stop: {van}, card not checked', { van })
        : tr(lang, 'Stop: {van}, not the van\'s card', { van }),
      body: p.kind === 'wash' ? tr(lang, '{name} is at the car wash. {why} Allow or refuse the wash.', { name: p.byName, why: tr(lang, why.t, why.v) })
        : tr(lang, '{name} is at the pump. {why} Allow or refuse the refuel.', { name: p.byName, why: tr(lang, why.t, why.v) }),
      url: `/buy/${ref.id}`, tag: `buy-${ref.id}`,
    }));
    return { result, why: why.text, whyT: why.t, whyV: why.v, people: bosses.map(({ name, phone }) => ({ name, phone })) };
  };
  if (d.missing === true) return stop('missing', said('{name} has no fuel card for the van.', { name: p.byName }), null, p.card.tries);
  const path = checkPath(d.path, buyPath(who));
  try {
    const img = await fit(await download(path), 1600, 1600);
    const t0 = Date.now();
    const prompt = cardPrompt({ name: p.vehicleName, plate: p.plate });
    const a1 = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), 'quick', [{ image: img }], prompt, cardSchema, 300);
    let read = cleanCard(a1.obj);
    let v = cardVerdict(expected, read);
    const models = [a1.model];
    let usage = a1.usage;
    if (v.result !== 'match') {
      // Never stop a driver on one quick reading: a stronger model reads it again.
      const a2 = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), who.tier === 'complex' ? 'complex' : 'default', [{ image: img }], prompt, cardSchema, 300);
      const read2 = cleanCard(a2.obj);
      const v2 = cardVerdict(expected, read2);
      if (v2.result !== 'unclear' || v.result === 'unclear') { read = read2; v = v2; }
      models.push(a2.model);
      usage = addUsage(usage, a2.usage);
    }
    const ms = Date.now() - t0;
    await logBuyRead(org, who, ref.id, 'card', models.join(' + '), usage, { result: v.result, ms });
    const tries = p.card.tries + 1;
    if (v.result === 'unclear' && tries < 3) {
      await ref.update({ 'card.tries': tries, 'card.why': v.why.text, 'card.whyT': v.why.t, 'card.whyV': v.why.v, updatedAt: Date.now() });
      return { result: 'retake', why: v.why.text, whyT: v.why.t, whyV: v.why.v, ...(who.creator ? { ms, usage } : {}) };
    }
    if (v.result === 'match') {
      const now = Date.now();
      await ref.update({ card: { ...p.card, result: 'match', read: { kind: read.kind, issuer: read.issuer, last4: read.last4, plate: read.plate, expiry: read.expiry },
        tries, why: v.why.text, whyT: v.why.t, whyV: v.why.v, expired: expired(read.expiry, now), at: now }, updatedAt: now });
      return { result: 'match', why: v.why.text, whyT: v.why.t, whyV: v.why.v, ...(who.creator ? { ms, usage } : {}) };
    }
    return { ...(await stop(v.result, v.result === 'unclear' ? said('The card couldn\'t be read after {n} photos.', { n: tries }) : v.why, read, tries)), ...(who.creator ? { ms, usage } : {}) };
  } finally {
    // No copy of the card is kept.
    await bucket().file(path).delete().catch(() => {});
  }
}

async function buyDecide(who: Who, org: R, d: Record<string, unknown>) {
  const { ref } = await loadBuy(org, d.id);
  const allow = d.allow === true;
  const note = clean(d.note, 300);
  const p = await db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as BuyDoc;
    if (!staffAt(who, cur.stationId)) throw fail('permission-denied', 'Only the station\'s fleet managers and owners decide this.');
    if (cur.by === who.uid && who.role !== 'owner') throw fail('failed-precondition', 'Someone else has to allow your own.');
    if (cur.status !== 'waiting') throw fail('failed-precondition', cur.status === 'cancelled' ? 'It was cancelled.' : 'It was already decided.');
    tx.update(ref, { status: allow ? 'open' : 'refused', decision: { allow, by: who.uid, byName: who.name, at: Date.now(), note }, updatedAt: Date.now() });
    return cur;
  });
  const wash = p.kind === 'wash', van = p.vehicleName, name = who.name, quote = note ? ` "${note}"` : '';
  const notified = await tell([{ uid: p.by }], (lang) => ({
    title: allow ? (wash ? tr(lang, 'Wash allowed: {van}', { van }) : tr(lang, 'Refuel allowed: {van}', { van }))
      : wash ? tr(lang, 'Wash refused: {van}', { van }) : tr(lang, 'Refuel refused: {van}', { van }),
    body: (allow ? (wash ? tr(lang, '{name} allowed it. Wash the van, then take the photo of the receipt.', { name }) : tr(lang, '{name} allowed it. Fill up, then take the photo of the receipt.', { name }))
      : wash ? tr(lang, '{name} refused it. Don\'t wash the van: cancel it in the app.', { name }) : tr(lang, '{name} refused it. Don\'t fill up: cancel it in the app.', { name })) + quote,
    url: `/buy/${ref.id}`, tag: `buy-${ref.id}`,
  }));
  return { ok: true, notified };
}

async function buyReceipt(who: Who, org: R, d: Record<string, unknown>) {
  const { ref, p } = await myBuy(org, who, d.id);
  if (p.status !== 'open') throw fail('failed-precondition', p.status === 'waiting' ? 'Wait for your fleet manager first.' : 'This one is closed.');
  if (p.card.needed && p.card.result !== 'match' && !p.decision?.allow) throw fail('failed-precondition', 'Check the fuel card first.');
  const path = checkPath(d.path, buyPath(who));
  let parts: string[] = [], note: string | null = null;
  if (p.kind === 'parts') {
    const raw = Array.isArray(d.parts) ? d.parts : [];
    if (!raw.length || raw.length > 6) throw fail('invalid-argument', 'Take 1 to 6 photos of the parts.');
    parts = raw.map((x: unknown) => checkPath(x, buyPath(who)));
    note = clean(d.note, 1000);
    if (note.length < 5) throw fail('invalid-argument', 'Say why the parts were needed.');
  }
  const img = await fit(await download(path));
  const a = await ask<Record<string, unknown>>(ANTHROPIC_API_KEY.value(), who.tier, [{ image: img }],
    receiptPrompt(p.kind, { name: p.vehicleName, plate: p.plate, fuel: p.vanFuel }), receiptSchema, 2000);
  const r = cleanReceipt(a.obj);
  await ref.update({ receipt: { path, at: Date.now(), ai: r }, parts, note, updatedAt: Date.now() });
  await logBuyRead(org, who, ref.id, 'receipt', a.model, a.usage);
  return { receipt: r, litres: p.kind === 'fuel' ? fuelLitres(r, p.vanFuel) : null, ...(who.creator ? { usage: a.usage } : {}) };
}

async function buyFinish(who: Who, org: R, d: Record<string, unknown>) {
  const { ref, p } = await myBuy(org, who, d.id);
  if (p.status !== 'open') throw fail('failed-precondition', 'This one is closed.');
  if (!p.receipt) throw fail('failed-precondition', 'Take the photo of the receipt first.');
  const v = (d.values || {}) as Record<string, unknown>;
  const n = (x: unknown) => (x == null || x === '' ? null : Number(x));
  const odometerKm = n(v.odometerKm);
  if (odometerKm == null || !Number.isFinite(odometerKm) || odometerKm < 0 || odometerKm > 3_000_000) throw fail('invalid-argument', 'Enter the odometer reading in km.');
  const fuelPct = p.kind === 'fuel' ? n(v.fuelPct) : null;
  if (fuelPct != null && (!Number.isFinite(fuelPct) || fuelPct < 0 || fuelPct > 100)) throw fail('invalid-argument', 'The fuel level is a percentage from 0 to 100.');
  const litres = p.kind === 'fuel' ? n(v.litres) : null;
  if (p.kind === 'fuel' && (litres == null || !Number.isFinite(litres) || litres <= 0 || litres > 1000)) throw fail('invalid-argument', 'Enter the litres from the receipt.');
  const total = n(v.total);
  if (total == null || !Number.isFinite(total) || total < 0 || total >= 100_000) throw fail('invalid-argument', 'Enter the total from the receipt.');
  const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  const vals = { odometerKm: Math.round(odometerKm), fuelPct: fuelPct == null ? null : Math.round(fuelPct * 10) / 10, litres: r2(litres), total: r2(total)! };
  const ai = { odometerKm: p.dash.ai?.odometerKm ?? null, fuelPct: p.dash.ai?.fuelPct ?? null, litres: p.kind === 'fuel' ? fuelLitres(p.receipt.ai, p.vanFuel) : null, total: p.receipt.ai.total };
  const corrected = (Object.keys(vals) as (keyof typeof vals)[]).filter((k) => (k !== 'fuelPct' || p.kind === 'fuel') && (k !== 'litres' || p.kind === 'fuel') && (ai[k] ?? null) !== vals[k]);
  const flags: Flag[] = purchaseFlags({
    kind: p.kind, byName: p.byName, vanFuel: p.vanFuel, tankL: p.tankL, fuelPct: vals.fuelPct, odometerKm: vals.odometerKm, lastKm: p.lastKm,
    litres: vals.litres, total: vals.total, createdAt: p.createdAt, vanDriverName: p.vanDriverName, notTheirVan: p.notTheirVan,
    card: p.card.needed ? { needed: true, expected: p.card.expected, result: p.card.result, expired: p.card.expired, plate: p.card.read?.plate || null } : null,
    vanPlate: p.plate, decision: p.decision ? { allow: p.decision.allow, byName: p.decision.byName } : null, receipt: p.receipt.ai,
  });
  const now = Date.now();
  const currency = p.receipt.ai.currency || 'EUR';
  await ref.update({ status: 'done', doneAt: now, updatedAt: now, ...vals, currency, merchant: p.receipt.ai.merchant, flags, corrected });
  // The van's odometer in its record (only ever up).
  const detRef = org.collection('vehicleDetails').doc(p.vehicleId);
  await db().runTransaction(async (tx) => {
    const det = await tx.get(detRef);
    const today = new Date(now).toISOString().slice(0, 10);
    if (!det.exists) tx.set(detRef, { stationId: p.stationId, createdAt: now, odometerKm: vals.odometerKm, odometerAt: today, updatedAt: now, updatedByName: who.name });
    else if (Number(det.data()?.odometerKm ?? -1) <= vals.odometerKm) tx.update(detRef, { odometerKm: vals.odometerKm, odometerAt: today });
  });
  const bosses = await bossesOf(who.orgId, p.stationId, p.kind, who.uid);
  const notified = await tell(bosses, (lang) => ({ ...doneMessage(lang, { kind: p.kind, vehicleName: p.vehicleName, plate: p.plate, byName: p.byName, odometerKm: vals.odometerKm, litres: vals.litres,
    total: vals.total, currency, merchant: p.receipt!.ai.merchant, note: p.note, flags }), url: `/buy/${ref.id}`, tag: `buy-${ref.id}` }));
  return { flags, notified };
}

async function buyCancel(who: Who, org: R, d: Record<string, unknown>) {
  const { ref, p } = await loadBuy(org, d.id);
  if (p.by !== who.uid && !staffAt(who, p.stationId)) throw fail('permission-denied', 'Only the person who started it, or the station\'s fleet manager, can cancel it.');
  if (!OPEN_BUY.includes(p.status)) throw fail('failed-precondition', p.status === 'done' ? 'It\'s already finished.' : 'It\'s already cancelled.');
  const now = Date.now();
  await ref.update({ status: 'cancelled', cancel: { by: who.uid, byName: who.name, at: now, reason: clean(d.reason, 200) || null }, updatedAt: now });
  return { ok: true };
}

/** The people to call about it (the station's fleet managers, or the owners): names and phone numbers. */
async function buyContacts(who: Who, org: R, d: Record<string, unknown>) {
  const { p } = await loadBuy(org, d.id);
  if (p.by !== who.uid && !staffAt(who, p.stationId)) throw fail('permission-denied', 'Not yours.');
  return { people: (await bossesOf(who.orgId, p.stationId, p.kind, p.by)).map(({ name, phone }) => ({ name, phone })) };
}

export const purchase = onCall({ ...opts(120), secrets: [ANTHROPIC_API_KEY, WEBPUSH_KEYS] }, async (req) => {
  const who = await guard(req);
  const org = db().doc(`orgs/${who.orgId}`);
  const d = (req.data || {}) as Record<string, unknown>;
  switch (d.action) {
    case 'start': return buyStart(who, org, d);
    case 'dash': return buyDash(who, org, d);
    case 'card': return buyCard(who, org, d);
    case 'decide': return buyDecide(who, org, d);
    case 'receipt': return buyReceipt(who, org, d);
    case 'finish': return buyFinish(who, org, d);
    case 'cancel': return buyCancel(who, org, d);
    case 'contacts': return buyContacts(who, org, d);
    default: throw fail('invalid-argument', 'Unknown step.');
  }
});
