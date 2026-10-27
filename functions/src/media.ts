import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * How long photos and videos are kept (decided by the product owner, 2026-10): 30 days; the ones that matter for
 * damage 90 days. The records themselves (who had which van, walk-arounds, checks, refuels, the damage list) stay
 * for good; only the files go.
 *
 * Kept 90 days (from when they were taken):
 * - a check where the manager approved damage: its close-ups, the walk-around it was found in and the walk-around
 *   before it (the "before" photos of the damage record), set by damageLogFor when the review is logged;
 * - walk-around photos and videos an owner or the station's manager marked as damage (markDamage).
 * Everything else (dashboard, receipt and van-type photos too) goes after 30 days. Every file goes after 90.
 *
 * A record that keeps its files carries keepUntil (ms; the files are kept while it's in the future), and on
 * walk-arounds and videos the reasons: keepMark (who marked it) and keepDamage (the checks with approved damage).
 */
export const KEEP_DAYS = 30;
export const DAMAGE_DAYS = 90;
export const DAY_MS = 86_400_000;
/**
 * The day the rule started (the store release). Photos and videos taken before count from this day, so nothing that
 * existed before was deleted without 30 days' notice; the first deletions are 30 days after it.
 */
export const RULE_START = Date.UTC(2026, 9, 28);
/** When a file's 30 or 90 days start: when it was taken, or the day the rule started if that's later. */
export const since = (createdAt: number) => Math.max(createdAt, RULE_START);

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

/** Until when a record's files are kept: 90 days from when they were taken while there's a reason, else none. */
export function keepUntil(createdAt: number, reasons: boolean): number | null {
  return reasons && Number.isFinite(createdAt) ? since(createdAt) + DAMAGE_DAYS * DAY_MS : null;
}

/** Are this record's photos or video gone (or due at tonight's clean-up), for the app and the functions alike. */
export function mediaGone(createdAt: number, until: number | null | undefined, now = Date.now()): boolean {
  return now > Math.max(until || 0, since(createdAt) + KEEP_DAYS * DAY_MS);
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

/** Should a file of this age go? Always after 90 days; after 30 unless its record is kept. */
export function shouldDelete(ageMs: number, kept: boolean): boolean {
  if (ageMs > DAMAGE_DAYS * DAY_MS) return true;
  return ageMs > KEEP_DAYS * DAY_MS && !kept;
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

/** Records of this company whose files are kept right now. */
async function keptKeys(orgId: string, now: number): Promise<Set<string>> {
  const org = db().doc(`orgs/${orgId}`);
  const kinds = ['walkarounds', 'checks', 'videos'] as const;
  const snaps = await Promise.all(kinds.map((k) => org.collection(k).where('keepUntil', '>', now).select().get()));
  const out = new Set<string>();
  snaps.forEach((s, i) => s.docs.forEach((d) => out.add(`${kinds[i]}/${d.id}`)));
  return out;
}

export interface CleanResult { companies: number; deleted: number; kept: number; checked: number; reviews: number }

/**
 * The daily clean-up (and the app creator's "run it now"). First follows reviews since the last run (so damage a
 * manager approved keeps its photos even if the app never logged the review), then deletes the files that are due.
 * Demo companies are left alone: their pictures are drawings and the demo is made new when needed.
 */
export async function cleanMedia(now: number, logReview: (orgId: string, checkId: string) => Promise<unknown>, onlyOrg?: string): Promise<CleanResult> {
  const state = db().doc('platform/media');
  const last = Number((await state.get()).data()?.lastRun || 0);
  const reviewsSince = last ? last - 2 * DAY_MS : now - (DAMAGE_DAYS + 1) * DAY_MS;
  const orgs = onlyOrg ? [await db().doc(`orgs/${onlyOrg}`).get()] : (await db().collection('orgs').select('demo').get()).docs;
  const res: CleanResult = { companies: 0, deleted: 0, kept: 0, checked: 0, reviews: 0 };
  for (const o of orgs) {
    if (!o.exists || o.data()?.demo === true) continue;
    res.companies++;
    const reviewed = await o.ref.collection('checks').where('review.at', '>=', reviewsSince).select('status', 'createdAt').get();
    for (const d of reviewed.docs) {
      if (d.data().status !== 'reviewed' || Number(d.data().createdAt) < now - (DAMAGE_DAYS + 1) * DAY_MS) continue;
      await logReview(o.id, d.id).catch(() => {});
      res.reviews++;
    }
    const kept = await keptKeys(o.id, now);
    let pageToken: string | undefined;
    do {
      const [files, next] = await bucket().getFiles({ prefix: `orgs/${o.id}/`, autoPaginate: false, maxResults: 1000, pageToken });
      const due = files.filter((f) => {
        res.checked++;
        const age = now - since(Date.parse(String(f.metadata.timeCreated || '')));
        if (!Number.isFinite(age)) return false;
        const rec = recordOf(f.name);
        const keep = !!rec?.key && kept.has(rec.key);
        if (shouldDelete(age, keep)) return true;
        if (keep && age > KEEP_DAYS * DAY_MS) res.kept++;
        return false;
      });
      for (let i = 0; i < due.length; i += 50) {
        await Promise.all(due.slice(i, i + 50).map((f) => f.delete({ ignoreNotFound: true }).then(() => { res.deleted++; }).catch(() => {})));
      }
      pageToken = (next as { pageToken?: string } | null)?.pageToken;
    } while (pageToken);
  }
  if (!onlyOrg) await state.set({ lastRun: now, ...res, at: FieldValue.serverTimestamp() }, { merge: true });
  return res;
}
