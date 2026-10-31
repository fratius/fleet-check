import { loc } from './i18n';

/**
 * When photos and videos are deleted (the same rule as functions/src/media.ts): once a month, on the 15th (German
 * time), the files of the month before, never while the van is still with the driver who had it (then the 15th
 * after it was given back); damage 90 days from when it was taken, then the next 15th. The first run is on
 * 15 December 2026. The records stay. Demo companies keep their (drawn) pictures.
 *
 * The app can't know when a van will be given back, so it shows the earliest date; that the files are gone it
 * takes only from the record (mediaDeletedAt, set by the clean-up).
 */
export const DAMAGE_DAYS = 90;
const DAY_MS = 86_400_000;
const DELETE_DAY = 15;

/** The German calendar date of a moment (month 1-12); without the time zone database, central European time. */
function berlinDate(ms: number): { year: number; month: number; day: number } {
  try {
    const p: Record<string, number> = {};
    for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms)) {
      if (x.type !== 'literal') p[x.type] = Number(x.value);
    }
    if (p.year && p.month && p.day) return { year: p.year, month: p.month, day: p.day };
  } catch { /* falls through */ }
  const d = new Date(ms + 3_600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
/** Noon (UTC) of a calendar day: shown as that day in every time zone people use the app in. */
const dayOf = (year: number, month0: number, day: number) => Date.UTC(year, month0, day, 12);
const FIRST_RUN = dayOf(2026, 11, DELETE_DAY);

/** The 15th that deletes a file dated `at` (the month after), never before 15 December 2026. */
export function deleteOn(at: number): number {
  const p = berlinDate(at);
  return Math.max(FIRST_RUN, dayOf(p.year, p.month, DELETE_DAY));
}
/** The earliest day a record's photos or video are deleted: later while the van is with its driver. */
export const deleteFrom = (createdAt: number, keepUntil?: number | null) => deleteOn(Math.max(createdAt, keepUntil || 0));
/** The earliest day if marked as damage now. */
export const damageDeleteFrom = (createdAt: number) => deleteOn(createdAt + DAMAGE_DAYS * DAY_MS);
/** Are they deleted? Only once the clean-up said so, and never in a demo company. */
export const mediaGone = (deletedAt: number | null | undefined, demo: boolean) => !demo && !!deletedAt;
export const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
