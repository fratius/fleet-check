import { N_, t } from './i18n';
import type { Check, CmpGap, CmpSummary } from './types';

/**
 * The automatic damage comparison (functions/src/compare.ts): after every walk-around taken with the camera, each
 * photo is compared with the newest earlier photo of the same frame of the van. What the AI calls new damage, or
 * can't decide, becomes a damage check for the station's fleet managers to review; new damage also notifies them.
 */

/** Why a frame wasn't compared (shown with t()). */
export const NOT_COMPARED: Record<CmpGap['why'], string> = {
  first: N_('no earlier photo'), missing: N_('earlier photo deleted'), unreadable: N_('photo couldn\'t be opened'),
  'not comparable': N_('photos too different'), 'other vehicle': N_('another vehicle in the photo'), failed: N_('the AI didn\'t answer'),
};
/** Frames the comparison couldn't compare, with why: "Rear (no earlier photo); Front (photos too different)". */
export const gapList = (gaps: CmpGap[]) => gaps.map((g) => t('{frame} ({why})', { frame: t(g.label), why: t(NOT_COMPARED[g.why]) })).join('; ');

/** A run marked running for longer than this died (the server's limit is 9 minutes): staff can run it again. */
export const CMP_STALE_MS = 15 * 60_000;
/** Did the comparison stop without an answer (failed, or still "running" long after it should have finished)? */
export const cmpStuck = (c: CmpSummary | null | undefined, now = Date.now()) => !!c && (c.status === 'failed' || (c.status === 'running' && now - c.at > CMP_STALE_MS));

/**
 * A pick-up or drop-off (product owner, 2026-11-22): the driver who took the photos hears the result, takes close-ups
 * of the spots the AI found, and the check then goes to the fleet managers (functions/src/index.ts sendCompareCheck).
 * Where the comparison's check stands, for that driver:
 *   closeups  close-ups to take (until closeupBy)
 *   damage    a close-up shows damage, or a spot without one that the AI called damage: the manager is reviewing it
 *   clean     every spot has close-ups and none shows damage: the manager confirms
 *   sent      with the manager otherwise (spots the AI wasn't sure about, without close-ups)
 *   reviewed  the manager decided
 */
export type CloseupState = 'closeups' | 'damage' | 'clean' | 'sent' | 'reviewed';
type CheckLike = Pick<Check, 'status' | 'spots'>;
/** Spots that count as damage for the manager, as the server counts them when the check is sent. */
export const cmpDamage = (k: CheckLike) => k.spots.filter((p) => p.verdict?.verdict === 'damage'
  || ((!p.verdict || p.verdict.verdict === 'skipped' || p.verdict.verdict === 'unclear') && p.cmp?.verdict === 'damage')).length;
export function closeupState(k: CheckLike): CloseupState {
  if (k.status === 'reviewed') return 'reviewed';
  if (k.status === 'checking') return 'closeups';
  if (cmpDamage(k)) return 'damage';
  return k.spots.length && k.spots.every((p) => p.closeups?.length && p.verdict && p.verdict.verdict !== 'damage' && p.verdict.verdict !== 'unclear' && p.verdict.verdict !== 'skipped')
    ? 'clean' : 'sent';
}
