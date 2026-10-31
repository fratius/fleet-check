import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * How long photos and videos are kept (decided by the product owner, 2026-10-31). The records themselves (who had
 * which van, walk-arounds, checks, refuels, the damage list) stay for good; only the files go.
 *
 * - Once a month, on the 15th (German time), the files of the month before are deleted (and anything older that is
 *   due): a 15-day buffer after the month has ended, so a file is kept 15 to 45 days. The first run is on
 *   15 December 2026.
 * - Never while the van is still with the driver who had it: every file of a van (walk-arounds, damage checks,
 *   videos, dashboard, refuel and receipt photos, checks for drivers) taken while an assignment of that van is open,
 *   and its pick-up proof, stays until the van is given back. After that, the assignment's end counts as the file's
 *   date, so its files go on the 15th of the month after the van was given back.
 * - Damage is kept 90 days from when it was taken, then goes at the next run:
 *   a check where the manager approved damage (its close-ups, the walk-around it was found in and the one before it,
 *   set by damageLogFor when the review is logged), and walk-around photos and videos an owner or the station's
 *   manager marked as damage (markDamage).
 *
 * A record that keeps its files 90 days carries keepUntil (ms), and on walk-arounds and videos the reasons:
 * keepMark (who marked it) and keepDamage (the checks with approved damage). A record whose files were deleted
 * carries mediaDeletedAt (set by the clean-up; the app shows "deleted on" only from it).
 */
export const DAMAGE_DAYS = 90;
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
/** Deletions happen on this day of the month (German time). */
export const DELETE_DAY = 15;
/** Proof taken this long before a handover belongs to it (the server accepts proof up to two hours old). */
export const PROOF_MS = 3 * HOUR_MS;

const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
/** The German calendar date and time of a moment (month 1-12). */
export function berlinParts(ms: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const p: Record<string, number> = {};
  for (const x of BERLIN.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}
/** Midnight German time at the start of year-month(0-based, may overflow)-day. */
export function berlinMidnight(year: number, month0: number, day: number): number {
  const guess = Date.UTC(year, month0, day);
  const p = berlinParts(guess);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (wall - guess);
}
/** The first monthly deletion: 15 December 2026 (nothing goes before it; until then everyone was told 27 November). */
export const FIRST_RUN = berlinMidnight(2026, 11, DELETE_DAY);

/**
 * Files dated before this moment are due: from the 15th, the start of this month (the month before is over and
 * its 15 days have passed); before the 15th, the start of the month before. Nothing before the first run.
 */
export function cutoff(now: number): number {
  if (now < FIRST_RUN) return -Infinity;
  const p = berlinParts(now);
  return berlinMidnight(p.year, p.month - 1 - (p.day >= DELETE_DAY ? 0 : 1), 1);
}
/** The run that deletes a file dated `at`: the 15th of the following month, never before the first run. */
export function deleteOn(at: number): number {
  const p = berlinParts(at);
  return Math.max(FIRST_RUN, berlinMidnight(p.year, p.month, DELETE_DAY));
}
/** The 15th of this month at midnight (German time): has this month's deletion run come yet? */
export function thisMonthsRun(now: number): number {
  const p = berlinParts(now);
  return berlinMidnight(p.year, p.month - 1, DELETE_DAY);
}

const db = () => getFirestore();
const bucket = () => getStorage().bucket();

interface Review { decisions?: Record<string, { damage?: boolean }>; manual?: unknown[] }
/** Did the manager approve any damage in this check (new damage or damage already on the van)? */
export function approvedDamage(k: { status?: string; spots?: unknown[]; review?: Review | null }): boolean {
  if (k.status !== 'reviewed' || !k.review) return false;
  const n = (k.spots || []).length;
  for (let i = 0; i < n; i++) if (k.review.decisions?.[String(i)]?.damage) return true;
  return (k.review.manual || []).length > 0;
}

/** Until when a record's files are kept as damage: 90 days from when they were taken while there's a reason, else none. */
export function keepUntil(createdAt: number, reasons: boolean): number | null {
  return reasons && Number.isFinite(createdAt) ? createdAt + DAMAGE_DAYS * DAY_MS : null;
}

/**
 * Which record a stored file belongs to, as "walkarounds/ID", "checks/ID" or "videos/ID"; null for files that
 * no record keeps longer (dashboard, receipt, van-type and document photos).
 *   orgs/{org}/walkarounds/{walkId}/01.jpg
 *   orgs/{org}/checks/{checkId}/spot1_1_x.jpg
 *   orgs/{org}/videos/{uploader}/{videoId}/original.mov
 */
export function recordOf(path: string): { org: string; key: string | null } | null {
  const p = path.split('/');
  if (p[0] !== 'orgs' || !p[1]) return null;
  if ((p[2] === 'walkarounds' || p[2] === 'checks') && p[3] && p.length >= 5) return { org: p[1], key: `${p[2]}/${p[3]}` };
  if (p[2] === 'videos' && p[4] && p.length >= 6) return { org: p[1], key: `videos/${p[4]}` };
  return { org: p[1], key: null };
}

/**
 * Keeps (or stops keeping) the walk-arounds of one check: the one the damage was found in and the one before it.
 * Called by damageLogFor whenever a review is logged, so a review that changes its mind is followed.
 */
export async function keepForCheck(orgId: string, checkId: string, createdAt: number, damage: boolean, walkIds: (string | null | undefined)[]) {
  const org = db().doc(`orgs/${orgId}`);
  await org.collection('checks').doc(checkId).update({ keepUntil: keepUntil(createdAt, damage) }).catch(() => {});
  const want = new Set(damage ? walkIds.filter((x): x is string => !!x) : []);
  const had = (await org.collection('walkarounds').where('keepDamage', 'array-contains', checkId).get()).docs.map((d) => d.id);
  const touch = new Set([...want, ...had]);
  await Promise.all([...touch].map((id) => db().runTransaction(async (tx) => {
    const ref = org.collection('walkarounds').doc(id);
    const w = await tx.get(ref);
    if (!w.exists) return;
    const x = w.data() as { createdAt: number; keepMark?: unknown; keepDamage?: string[] };
    const reasons = new Set(x.keepDamage || []);
    if (want.has(id)) reasons.add(checkId); else reasons.delete(checkId);
    tx.update(ref, { keepDamage: [...reasons], keepUntil: keepUntil(x.createdAt, !!x.keepMark || reasons.size > 0) });
  })));
}

/** Records of this company whose files are kept as damage past the cut-off. */
async function keptKeys(orgId: string, cut: number): Promise<Set<string>> {
  const org = db().doc(`orgs/${orgId}`);
  const kinds = ['walkarounds', 'checks', 'videos'] as const;
  const snaps = await Promise.all(kinds.map((k) => org.collection(k).where('keepUntil', '>=', cut).select().get()));
  const out = new Set<string>();
  snaps.forEach((s, i) => s.docs.forEach((d) => out.add(`${kinds[i]}/${d.id}`)));
  return out;
}

type Window = { id: string; from: number; to: number };
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/**
 * What a van's open or recently ended assignments hold back: the records (walkarounds/ID, checks/ID, videos/ID) and
 * the single photos (dashboard, refuel, receipt, parts, checks for drivers) of every van while it was with someone,
 * from shortly before the pick-up (its proof) until the van was given back. An assignment that ended before the
 * cut-off holds nothing any more.
 */
export async function heldFiles(orgId: string, cut: number): Promise<{ keys: Set<string>; paths: Set<string>; vans: number }> {
  const org = db().doc(`orgs/${orgId}`);
  const [open, ended] = await Promise.all([
    org.collection('assignments').where('end', '==', null).get(),
    Number.isFinite(cut) ? org.collection('assignments').where('end', '>=', cut).get() : Promise.resolve(null),
  ]);
  const byVan = new Map<string, Window[]>();
  for (const d of [...open.docs, ...(ended?.docs || [])]) {
    const a = d.data() as { vehicleId?: string; start?: number; end?: number | null };
    if (!a.vehicleId || !Number.isFinite(num(a.start))) continue;
    const w = { id: d.id, from: num(a.start) - PROOF_MS, to: a.end == null ? Infinity : num(a.end) + PROOF_MS };
    byVan.set(a.vehicleId, [...(byVan.get(a.vehicleId) || []), w]);
  }
  const keys = new Set<string>();
  const paths = new Set<string>();
  const within = (ws: Window[], at: number, assignmentId?: unknown) =>
    ws.some((w) => w.id === assignmentId || (at >= w.from && at <= w.to));
  for (const [vehicleId, ws] of byVan) {
    const q = (c: string) => org.collection(c).where('vehicleId', '==', vehicleId).get();
    const [walks, checks, videos, dashReads, readings, buys, done] = await Promise.all(
      ['walkarounds', 'checks', 'videos', 'dashReads', 'readings', 'purchases', 'routineDone'].map(q));
    for (const d of walks.docs) {
      const x = d.data();
      if (within(ws, num(x.createdAt), x.handover?.assignmentId)) keys.add(`walkarounds/${d.id}`);
    }
    for (const d of checks.docs) if (within(ws, num(d.data().createdAt))) keys.add(`checks/${d.id}`);
    for (const d of videos.docs) {
      const x = d.data();
      if (within(ws, num(x.createdAt), x.assignmentId)) keys.add(`videos/${d.id}`);
    }
    for (const d of [...dashReads.docs, ...readings.docs, ...done.docs]) {
      const x = d.data();
      if (typeof x.path === 'string' && within(ws, num(x.createdAt ?? x.at))) paths.add(x.path);
    }
    for (const d of buys.docs) {
      const x = d.data();
      if (!within(ws, num(x.createdAt))) continue;
      for (const p of [x.dash?.path, x.receipt?.path, ...(Array.isArray(x.parts) ? x.parts : [])]) if (typeof p === 'string') paths.add(p);
    }
  }
  return { keys, paths, vans: byVan.size };
}

export interface CleanResult { companies: number; deleted: number; kept: number; held: number; checked: number; reviews: number; cutoff: number | null }

/**
 * The monthly clean-up (run by the daily job from the 15th, and by the app creator's "run it now"). First follows
 * reviews since the last run (so damage a manager approved keeps its photos even if the app never logged the
 * review), then deletes the files dated before the cut-off that nothing holds back: not damage kept 90 days, and
 * nothing of a van while it is with a driver. Records whose files went get mediaDeletedAt.
 * Demo companies are left alone: their pictures are drawings and the demo is made new when needed.
 */
export async function cleanMedia(now: number, logReview: (orgId: string, checkId: string) => Promise<unknown>, onlyOrg?: string): Promise<CleanResult> {
  const cut = cutoff(now);
  const res: CleanResult = { companies: 0, deleted: 0, kept: 0, held: 0, checked: 0, reviews: 0, cutoff: Number.isFinite(cut) ? cut : null };
  if (!Number.isFinite(cut)) return res;
  const state = db().doc('platform/media');
  const last = Number((await state.get()).data()?.lastRun || 0);
  const reviewsSince = last ? last - 2 * DAY_MS : now - (DAMAGE_DAYS + 50) * DAY_MS;
  const orgs = onlyOrg ? [await db().doc(`orgs/${onlyOrg}`).get()] : (await db().collection('orgs').select('demo').get()).docs;
  for (const o of orgs) {
    if (!o.exists || o.data()?.demo === true) continue;
    res.companies++;
    const reviewed = await o.ref.collection('checks').where('review.at', '>=', reviewsSince).select('status', 'createdAt').get();
    for (const d of reviewed.docs) {
      if (d.data().status !== 'reviewed' || Number(d.data().createdAt) < cut - DAMAGE_DAYS * DAY_MS) continue;
      await logReview(o.id, d.id).catch(() => {});
      res.reviews++;
    }
    // Read after the reviews are followed, so a review that approved damage counts.
    const [kept, held] = await Promise.all([keptKeys(o.id, cut), heldFiles(o.id, cut)]);
    const gone = new Set<string>();
    let pageToken: string | undefined;
    do {
      const [files, next] = await bucket().getFiles({ prefix: `orgs/${o.id}/`, autoPaginate: false, maxResults: 1000, pageToken });
      const due = files.filter((f) => {
        res.checked++;
        const at = Date.parse(String(f.metadata.timeCreated || ''));
        if (!Number.isFinite(at) || at >= cut) return false;
        const key = recordOf(f.name)?.key || null;
        if ((key && held.keys.has(key)) || held.paths.has(f.name)) { res.held++; return false; }
        if (key && kept.has(key)) { res.kept++; return false; }
        if (key) gone.add(key);
        return true;
      });
      for (let i = 0; i < due.length; i += 50) {
        await Promise.all(due.slice(i, i + 50).map((f) => f.delete({ ignoreNotFound: true }).then(() => { res.deleted++; }).catch(() => {})));
      }
      pageToken = (next as { pageToken?: string } | null)?.pageToken;
    } while (pageToken);
    // The records stay; they say when their files went.
    const keys = [...gone];
    for (let i = 0; i < keys.length; i += 400) {
      const batch = db().batch();
      for (const k of keys.slice(i, i + 400)) batch.update(o.ref.collection(k.split('/')[0]).doc(k.split('/')[1]), { mediaDeletedAt: now });
      await batch.commit().catch(async () => {
        // A record that isn't there (a file without one): set the others one by one.
        await Promise.all(keys.slice(i, i + 400).map((k) => o.ref.collection(k.split('/')[0]).doc(k.split('/')[1]).update({ mediaDeletedAt: now }).catch(() => {})));
      });
    }
  }
  if (!onlyOrg) await state.set({ lastRun: now, ...res, at: FieldValue.serverTimestamp() }, { merge: true });
  return res;
}
