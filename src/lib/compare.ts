import { N_, t } from './i18n';
import type { CmpGap, CmpSummary } from './types';

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
