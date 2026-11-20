import { DAMAGE_TYPES, className } from './prompts';

/**
 * The automatic damage comparison (product owner, 2026-11-20): after every walk-around taken with the camera (a
 * pick-up, a drop-off, or any other), each photo is compared with the newest earlier photo of the same frame of that
 * van. The quick model (Haiku) looks at every pair; only the frames where it marks something, or isn't sure, get a
 * second look by the strongest model (Opus), with close crops from the full-size photos. What Opus calls new damage,
 * or can't decide, goes to the station's fleet managers as a damage check to review (they have the final word);
 * new damage also sends them a notification. Plain functions here; the trigger is in index.ts (section 2a).
 *
 * Decisions: on for every company from the start, with a switch only the app creator turns (orgs/{org}.aiCompare;
 * AGB § 5 (4): offered before it is sold, so it can be limited or ended); a video handover has no frames and is
 * skipped (the next photo walk-around compares with the last photos before it); a trial or demo company gets
 * COMPARE_PER_VAN_DAY comparisons per van a day; each van's newest walk-around keeps its photos until a newer one is
 * taken (media.ts), so a van that stood still over the 15th still has something to compare with.
 */

/** Comparisons per van and day for trial and demo companies (product owner, 2026-11-20). Paying companies: no limit. */
export const COMPARE_PER_VAN_DAY = 2;
/** At most this many marked spots per frame go to the second look. */
export const MAX_CHANGES = 3;
/** Opus may add at most this many spots per frame that the first look didn't mark. */
export const MAX_MORE = 2;
/** At most this many photos of one walk-around are compared (a walk-around has 8 to 16 frames). */
export const MAX_FRAMES = 30;

export type Box = [number, number, number, number];
export interface WalkPhoto { n: number; label: string; path?: string; takenAt?: number }
export interface WalkLite {
  id: string; createdAt: number; source?: string; photos?: WalkPhoto[]; mediaDeletedAt?: number | null; demo?: boolean;
}
/** The earlier photo a frame is compared with. */
export interface Ref { walkId: string; n: number; label: string; path: string; at: number }

/**
 * For each photo of a walk-around, the newest earlier photo of the same frame of the van: frames are matched by their
 * name (frame names never change, src/lib/frames.ts). Only photos taken with the camera, of walk-arounds taken before
 * this one, whose files are still there. A frame the earlier walk-around skipped is compared with the newest one that
 * has it. null: nothing to compare with (the van's first walk-around, or a frame it never had).
 */
export function pickRefs(walk: WalkLite, earlier: WalkLite[]): (Ref | null)[] {
  const older = earlier
    .filter((w) => w.id !== walk.id && w.source !== 'library' && !w.mediaDeletedAt && !w.demo && w.createdAt < walk.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt);
  return (walk.photos || []).map((p) => {
    for (const w of older) {
      const q = (w.photos || []).find((x) => x.label === p.label && x.path);
      if (q) return { walkId: w.id, n: q.n, label: q.label, path: q.path!, at: typeof q.takenAt === 'number' ? q.takenAt : w.createdAt };
    }
    return null;
  });
}

/** Why a frame wasn't compared, for the walk-around and the review (shown with t() in the app). */
export type NotCompared = 'first' | 'missing' | 'unreadable' | 'not comparable' | 'other vehicle' | 'failed';

const nullable = (type: string, extra: object = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] });
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const IGNORE = `Look only at this van: its paint and panels, bumpers, glass, lights, mirrors, trim, number plates and wheels. Ignore everything around it: the ground, other vehicles, people, buildings, the sky, and reflections of those in the paint or glass.
These differences are normal and are not damage: a slightly different angle, distance, height or framing; daylight, night, flash, sun, shadows and glare; rain drops, wet paint, snow, frost, dirt, dust, mud, salt, bird droppings, leaves, stickers and paper; doors, windows or the shutter open or closed; things inside the van.
Damage stays at the same place on the panel in both photos, with edges, depth or broken paint. Reflections and shadows move with the light and the angle.
Something that is in both photos is not new, even if the light makes it look different.`;

/* ---------- First look (Haiku): one frame, before and now ---------- */
export function comparePrompt(vehicle: string, cls: string, label: string, n: number, beforeAt: number, nowAt: number) {
  return `You are the first look of a fleet app's damage comparison. Two photos show the same delivery van, ${vehicle} (${className(cls).toLowerCase()}), taken from the same spot for the walk-around frame "${label}" (photo ${n}):
Image 1 (BEFORE): taken ${when(beforeAt)}.
Image 2 (NOW): taken ${when(nowAt)}.

Find damage that is in Image 2 but not in Image 1: new scratches, scuffs, dents, chips, cracks, broken or missing parts (mirror, light, bumper, trim, plate), kerbed rims.
${IGNORE}
A stronger model takes a second look at every spot you mark, and then a fleet manager decides. Marking a doubtful spot is better than missing new damage, but don't mark ordinary differences in light, angle or dirt.

Answer:
- sameVan: false if Image 2 shows a different vehicle than Image 1, or no vehicle.
- comparable: false if the two photos can't be compared for this frame: another side of the van, the van mostly cut off, far too dark, too blurred. Then say why in issue.
- issue: one short phrase, or null.
- changes: each possible new damage in Image 2, at most ${MAX_CHANGES}, most likely first:
  - box: [x0, y0, x1, y1] around it in Image 2, as fractions of the image width and height (0 to 1, origin top left)
  - beforeBox: the same place on the van in Image 1, or null if you can't find it there
  - panel: for example "front left wing", "rear bumper, right corner", "left mirror"
  - type: one of ${DAMAGE_TYPES.join(', ')}
  - sizeCm: rough size in centimetres
  - confidence: 0 to 1 that it is new damage
  - why: one short sentence on what changed
- unsure: true if something on the van may have changed but you can't point to it (for example a panel looks different in a way you can't explain). Otherwise false.
If nothing on the van is new, return an empty list of changes and unsure false.`;
}
export const compareSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sameVan', 'comparable', 'issue', 'changes', 'unsure'],
  properties: {
    sameVan: { type: 'boolean' },
    comparable: { type: 'boolean' },
    issue: nullable('string'),
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['box', 'beforeBox', 'panel', 'type', 'sizeCm', 'confidence', 'why'],
        properties: {
          box: { type: 'array', items: { type: 'number' } },
          beforeBox: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] },
          panel: { type: 'string' },
          type: { type: 'string', enum: DAMAGE_TYPES },
          sizeCm: nullable('number'),
          confidence: { type: 'number' },
          why: { type: 'string' },
        },
      },
    },
    unsure: { type: 'boolean' },
  },
};

/* ---------- Second look (Opus): the frames the first look marked or wasn't sure about ---------- */
export const SECOND_VERDICTS = ['new', 'old', 'not_damage', 'unclear'] as const;
export type SecondVerdict = typeof SECOND_VERDICTS[number];

export function confirmPrompt(vehicle: string, cls: string, label: string, beforeAt: number, nowAt: number, spots: { panel: string; type: string; why: string }[]) {
  const crops = spots.map((s, i) => `Spot ${i + 1}: Image ${3 + i * 2} is the close crop BEFORE and Image ${4 + i * 2} the close crop NOW, the spot boxed in yellow (on BEFORE, the same place on the van as well as it could be found). Marked as a possible new ${s.type} on the ${s.panel}: ${s.why}`).join('\n');
  return `You make the decision in a fleet app's damage comparison. Two photos show the same delivery van, ${vehicle} (${className(cls).toLowerCase()}), from the same spot for the walk-around frame "${label}":
Image 1 (BEFORE): the whole frame, taken ${when(beforeAt)}.
Image 2 (NOW): the whole frame, taken ${when(nowAt)}.
${spots.length ? `A quick first look marked ${spots.length === 1 ? 'one spot' : `${spots.length} spots`} that might be new damage. The close crops come from the full-size photos:\n${crops}` : 'A quick first look wasn\'t sure whether something on the van changed. Compare the two photos yourself.'}

${IGNORE}
A fleet manager sees every spot you call new or unclear, with your reason, and decides; new damage is put on the van's record and linked to the drivers who had the van. So be strict: call a spot new only when the damage is clearly there NOW and clearly not there BEFORE.

For each marked spot (spot = its number) give:
- verdict: "new" (real damage NOW that isn't there BEFORE), "old" (it was there BEFORE), "not_damage" (dirt, water, snow, a reflection, a shadow, light or glare, a sticker, a panel gap, a design line, the angle, or not on this van) or "unclear" (the photos can't show it, a manager should look)
- type and sizeCm for new or unclear damage, otherwise null
- severity for new damage: "cosmetic" (polish or touch-up) or "repair" (bodyshop), otherwise null
- confidence: 0 to 1 that your verdict is right
- reason: one or two sentences a fleet manager can check against the photos
more: new damage you see in Image 2 that isn't in Image 1 and isn't one of the marked spots, at most ${MAX_MORE} (usually none). For each: box [x0, y0, x1, y1] in Image 2 and beforeBox in Image 1 (or null) as fractions of the image (0 to 1, origin top left), panel, type, sizeCm, severity, confidence, reason.`;
}
export const confirmSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions', 'more'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['spot', 'verdict', 'type', 'sizeCm', 'severity', 'confidence', 'reason'],
        properties: {
          spot: { type: 'integer' },
          verdict: { type: 'string', enum: [...SECOND_VERDICTS] },
          type: nullable('string', { enum: DAMAGE_TYPES }),
          sizeCm: nullable('number'),
          severity: nullable('string', { enum: ['cosmetic', 'repair'] }),
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
    more: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['box', 'beforeBox', 'panel', 'type', 'sizeCm', 'severity', 'confidence', 'reason'],
        properties: {
          box: { type: 'array', items: { type: 'number' } },
          beforeBox: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] },
          panel: { type: 'string' },
          type: { type: 'string', enum: DAMAGE_TYPES },
          sizeCm: nullable('number'),
          severity: nullable('string', { enum: ['cosmetic', 'repair'] }),
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/** A box the AI wrote, tidied: four fractions in order, at least 4% wide and high. null if it isn't a box. */
export function cleanBox(b: unknown): Box | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const c = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));
  let [x0, y0, x1, y1] = b.map(c);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const mw = 0.04;
  if (x1 - x0 < mw) { const m = (x0 + x1) / 2; x0 = Math.max(0, m - mw / 2); x1 = Math.min(1, m + mw / 2); }
  if (y1 - y0 < mw) { const m = (y0 + y1) / 2; y0 = Math.max(0, m - mw / 2); y1 = Math.min(1, m + mw / 2); }
  return [x0, y0, x1, y1];
}
/** The same box made bigger around its middle (for the BEFORE crop when the first look couldn't find the place). */
export function grow(b: Box, k: number): Box {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = ((b[2] - b[0]) * k) / 2, h = ((b[3] - b[1]) * k) / 2;
  return [Math.max(0, cx - w), Math.max(0, cy - h), Math.min(1, cx + w), Math.min(1, cy + h)];
}

/** One spot for the fleet manager, before the photos are cut. */
export interface Found {
  frame: number; label: string; box: Box; beforeBox: Box | null; panel: string; type: string; sizeCm: number | null;
  severity: 'cosmetic' | 'repair' | null; verdict: 'damage' | 'unclear'; confidence: number; reason: string; ref: Ref;
}

/**
 * What goes to the fleet manager from one frame's second look: the marked spots Opus calls new (damage) or unclear,
 * and the ones it added. Spots it calls old or not damage are dropped (kept only in the app creator's log).
 */
export function foundIn(frame: number, label: string, ref: Ref, marked: { box: Box; beforeBox: Box | null; panel: string; type: string }[],
  answer: { decisions?: unknown; more?: unknown }): Found[] {
  const out: Found[] = [];
  const type = (v: unknown, d: string) => (DAMAGE_TYPES.includes(v as string) ? (v as string) : d);
  const num = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);
  const conf = (v: unknown) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) / 100;
  const sev = (v: unknown) => (v === 'cosmetic' || v === 'repair' ? v : null);
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : '');
  const seen = new Set<number>();
  for (const d of (Array.isArray(answer.decisions) ? answer.decisions : []) as Record<string, unknown>[]) {
    const i = Math.round(Number(d.spot)) - 1;
    const m = marked[i];
    if (!m || seen.has(i)) continue;
    seen.add(i);
    if (d.verdict !== 'new' && d.verdict !== 'unclear') continue;
    out.push({
      frame, label, box: m.box, beforeBox: m.beforeBox, panel: m.panel.slice(0, 60), type: type(d.type, m.type), sizeCm: num(d.sizeCm),
      severity: d.verdict === 'new' ? sev(d.severity) : null, verdict: d.verdict === 'new' ? 'damage' : 'unclear', confidence: conf(d.confidence), reason: text(d.reason), ref,
    });
  }
  // A marked spot the answer left out: the manager looks at it.
  marked.forEach((m, i) => {
    if (seen.has(i)) return;
    out.push({ frame, label, box: m.box, beforeBox: m.beforeBox, panel: m.panel.slice(0, 60), type: m.type, sizeCm: null, severity: null, verdict: 'unclear', confidence: 0, reason: '', ref });
  });
  for (const x of ((Array.isArray(answer.more) ? answer.more : []) as Record<string, unknown>[]).slice(0, MAX_MORE)) {
    const box = cleanBox(x.box);
    if (!box) continue;
    out.push({
      frame, label, box, beforeBox: cleanBox(x.beforeBox), panel: (text(x.panel) || 'Body panel').slice(0, 60), type: type(x.type, 'other'), sizeCm: num(x.sizeCm),
      severity: sev(x.severity), verdict: 'damage', confidence: conf(x.confidence), reason: text(x.reason), ref,
    });
  }
  return out;
}

/** At most this many spots go to the manager from one walk-around: new damage first, then the most confident. */
export const MAX_SPOTS = 8;
export function pickSpots(found: Found[]): Found[] {
  return found.slice().sort((a, b) => (a.verdict === b.verdict ? b.confidence - a.confidence : a.verdict === 'damage' ? -1 : 1)).slice(0, MAX_SPOTS);
}
