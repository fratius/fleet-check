/**
 * A van's damage record, built from its reviewed damage checks.
 *
 * - One damage is the first approved sighting of it. Later checks that find the same damage again link to it
 *   (`known` on the manager's decision), so a dent seen in ten walk-arounds is one damage, not ten.
 * - When it happened: between the last walk-around before the one where it was found, and that one.
 * - Who: the drivers who had the van in that time, from the van's assignment history. This is who had the van,
 *   not proof of who caused it; the before and after photos are the proof.
 */
import { buildFrames, makeSpec, type Spec } from './frames';
import { N_ } from './i18n';
import type { Assignment, Check, Photo, Vehicle, Walkaround } from './types';
import { frameOfPhoto, locateByPanel, locateInFrame, type Pos } from './van3d';

export const damageKey = (checkId: string, spot: number | null, manual: number | null) => (spot != null ? `${checkId}:${spot}` : `${checkId}:m${manual}`);

export interface Sighting { key: string; check: Check; spot: number | null; manual: number | null }
export interface Damage {
  key: string;
  /** 1 is the oldest damage on this van. Numbers don't change when new damage is added. */
  no: number;
  panel: string;
  type: string;
  sizeCm: number | null;
  severity: string | null;
  /** The manager's note when approving it. */
  note: string;
  aiReason: string | null;
  /** Added by the manager in the review (the AI didn't mark it). */
  manual: boolean;
  first: Sighting;
  later: Sighting[];
  /** When the photos that show it were taken. */
  foundAt: number;
  foundBy: string;
  approvedBy: string;
  approvedAt: number | null;
  pos: Pos;
  /** The photos it was found in, and the van's walk-around just before. */
  afterWalk: Walkaround | null;
  beforeWalk: Walkaround | null;
  /** The photo of the after walk-around it was found in, and the same frame in the before one. */
  afterPhoto: Photo | null;
  beforePhoto: Photo | null;
  /** The spot box in the photo (0..1), when the AI marked it. */
  box: [number, number, number, number] | null;
  refPath: string | null;
  markPath: string | null;
  closeups: string[];
  /** It happened after `from` (the walk-around before; null when there are no earlier photos) and before `to`. */
  from: number | null;
  to: number;
}

const usable = (w: Walkaround) => (w.photos || []).filter((p) => p.path || p.uri);

/** The frame photo that shows a position best, for damage without a box (added by the manager). */
function photoForPos(sp: Spec, w: Walkaround | null, pos: Pos): Photo | null {
  if (!w) return null;
  const frames = buildFrames(sp);
  const [x] = pos.p, n = pos.n;
  let f = null as (typeof frames)[number] | null;
  if (Math.abs(n[2]) > 0.7) {
    const side = n[2] > 0 ? 'left' : 'right';
    const segs = frames.filter((fr) => fr.kind === 'side' && fr.side === side);
    f = segs.sort((a, b) => Math.abs((a.seg![1] + a.seg![2]) / 2 - x / sp.L) - Math.abs((b.seg![1] + b.seg![2]) / 2 - x / sp.L))[0] || null;
  } else if (n[0] < -0.5) f = frames.find((fr) => fr.kind === 'front') || null;
  else if (n[0] > 0.5) f = frames.find((fr) => fr.kind === 'rear') || null;
  if (!f) return null;
  const photos = usable(w);
  return photos.find((p) => p.label === f!.label) || (w.frames === frames.length ? photos.find((p) => p.n === f!.n) || null : null);
}
/** The same frame in another walk-around: by label, or by number when both used the same frame set. */
function sameFrame(w: Walkaround | null, photo: Photo | null, ref: Walkaround | null): Photo | null {
  if (!w || !photo) return null;
  const photos = usable(w);
  return photos.find((p) => p.label === photo.label) || (ref && w.frames === ref.frames ? photos.find((p) => p.n === photo.n) || null : null);
}

/**
 * All damage on a van, newest first. `checks` and `walks` are the van's (any order); checks that aren't
 * reviewed are ignored.
 */
export function buildDamages(v: Vehicle, checks: Check[], walks: Walkaround[]): Damage[] {
  const sp = makeSpec(v.cls, v);
  const reviewed = checks.filter((k) => k.vehicleId === v.id && k.status === 'reviewed' && k.review)
    .sort((a, b) => a.createdAt - b.createdAt);
  const walkById = new Map(walks.map((w) => [w.id, w]));
  const byTime = walks.slice().sort((a, b) => a.createdAt - b.createdAt);
  const root = new Map<string, string>();
  const items = new Map<string, Damage>();

  const add = (k: Check, spot: number | null, manual: number | null, known: string | null | undefined) => {
    const key = damageKey(k.id, spot, manual);
    const r = known ? root.get(known) : undefined;
    if (r && items.has(r)) { items.get(r)!.later.push({ key, check: k, spot, manual }); root.set(key, r); return; }
    root.set(key, key);
    const p = spot != null ? k.spots[spot] : null;
    const m = manual != null ? k.review!.manual[manual] : null;
    const d = spot != null ? k.review!.decisions[String(spot)] : null;
    const afterWalk = walkById.get(k.walkId) || null;
    const foundAt = afterWalk?.createdAt ?? k.createdAt;
    const beforeWalk = [...byTime].reverse().find((w) => w.id !== k.walkId && w.createdAt < foundAt - 1000 && usable(w).length) || null;
    const panel = p?.panel || m?.panel || '';
    let pos: Pos;
    let afterPhoto: Photo | null = null;
    if (p) {
      afterPhoto = afterWalk ? usable(afterWalk)[p.photo] || null : null;
      const frame = frameOfPhoto(sp, afterPhoto || { n: p.photo + 1, label: p.photoLabel }, afterWalk ? afterWalk.frames : -1);
      pos = frame && afterWalk?.source !== 'library'
        ? locateInFrame(sp, frame, (p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2)
        : locateByPanel(sp, panel);
    } else {
      pos = locateByPanel(sp, panel);
      afterPhoto = photoForPos(sp, afterWalk, pos);
    }
    items.set(key, {
      key, no: 0, panel, manual: !p,
      type: (p?.verdict?.verdict === 'damage' && p.verdict.type) || p?.type || m?.type || N_('damage'),
      sizeCm: p ? p.verdict?.sizeCm ?? p.sizeCm : null,
      severity: p?.verdict?.severity || null,
      note: (d?.note || m?.note || '').trim(),
      aiReason: p?.verdict?.reason || null,
      first: { key, check: k, spot, manual }, later: [],
      foundAt, foundBy: k.createdByName || '',
      approvedBy: d?.byName || m?.byName || k.review!.byName || '', approvedAt: d?.at || m?.at || k.review!.at || null,
      pos, afterWalk, beforeWalk, afterPhoto,
      beforePhoto: sameFrame(beforeWalk, afterPhoto, afterWalk),
      box: p ? p.box : null, refPath: p?.refPath || null, markPath: p?.markPath || null, closeups: p?.closeups || [],
      from: beforeWalk?.createdAt ?? null, to: foundAt,
    });
  };

  for (const k of reviewed) {
    const r = k.review!;
    k.spots.forEach((_, i) => { const d = r.decisions?.[String(i)]; if (d?.damage) add(k, i, null, d.known); });
    (r.manual || []).forEach((m, x) => add(k, null, x, m.known));
  }
  const list = [...items.values()].sort((a, b) => a.foundAt - b.foundAt);
  list.forEach((d, i) => { d.no = i + 1; });
  return list.reverse();
}

/** Who had the van while the damage could have happened. `atFound`: who had it when it was found. */
export function whoHadIt(d: Damage, history: Assignment[], vehicleId: string) {
  const mine = history.filter((a) => a.vehicleId === vehicleId);
  const during = d.from == null ? [] : mine.filter((a) => a.start < d.to && (a.end ?? Infinity) > d.from!)
    .sort((a, b) => a.start - b.start);
  const atFound = mine.find((a) => a.start <= d.to && (a.end ?? Infinity) >= d.to) || null;
  return { during, atFound };
}

/**
 * The crop the server cut around a spot (refCrop in functions/src/images.ts), as fractions of the photo, so the
 * same part of an earlier photo can be shown next to it.
 */
export function cropRegion(box: [number, number, number, number], W: number, H: number): [number, number, number, number] {
  const bx = box[0] * W, by = box[1] * H, bw = (box[2] - box[0]) * W, bh = (box[3] - box[1]) * H;
  let cw = Math.max(bw * 3, (bh * 3 * 4) / 3, Math.min(W, H) * 0.32), ch = (cw * 3) / 4;
  cw = Math.min(cw, W); ch = Math.min(ch, H);
  const cx = Math.max(0, Math.min(W - cw, bx + bw / 2 - cw / 2)), cy = Math.max(0, Math.min(H - ch, by + bh / 2 - ch / 2));
  return [cx / W, cy / H, cw / W, ch / H];
}

/** Suggests which damage already on the van a newly approved one is (nearest on the same face, within 45 cm). */
export function likelySame(pos: Pos, damages: Damage[], excludeCheck: string): Damage[] {
  return damages
    .filter((d) => d.first.check.id !== excludeCheck && d.pos.n[0] * pos.n[0] + d.pos.n[1] * pos.n[1] + d.pos.n[2] * pos.n[2] > 0.5)
    .map((d) => ({ d, dist: Math.hypot(d.pos.p[0] - pos.p[0], d.pos.p[1] - pos.p[1], d.pos.p[2] - pos.p[2]) }))
    .filter((x) => x.dist < (pos.approx || x.d.pos.approx ? 0.9 : 0.45))
    .sort((a, b) => a.dist - b.dist)
    .map((x) => x.d);
}

/** Where a spot of a check is on the van (used by the review screen to suggest a known damage). */
export function spotPos(v: Vehicle, k: Check, spot: number, walk: Walkaround | null): Pos {
  const sp = makeSpec(v.cls, v);
  const p = k.spots[spot];
  const photo = walk ? usable(walk)[p.photo] : undefined;
  const frame = frameOfPhoto(sp, photo || { n: p.photo + 1, label: p.photoLabel }, walk ? walk.frames : -1);
  return frame && walk?.source !== 'library' ? locateInFrame(sp, frame, (p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2) : locateByPanel(sp, p.panel);
}
export const manualPos = (v: Vehicle, panel: string) => locateByPanel(makeSpec(v.cls, v), panel);
