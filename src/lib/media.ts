import { loc } from './i18n';

/**
 * How long photos and videos are kept (the same rule as functions/src/media.ts): 30 days; 90 days from when they
 * were taken when damage was approved in a check of them or an owner or manager marked them as damage. The records
 * stay for good. Demo companies keep their (drawn) pictures.
 */
export const KEEP_DAYS = 30;
export const DAMAGE_DAYS = 90;
const DAY_MS = 86_400_000;
/** The day the rule started: older photos and videos count from it (functions/src/media.ts RULE_START). */
const RULE_START = Date.UTC(2026, 9, 28);
const since = (createdAt: number) => Math.max(createdAt, RULE_START);

/** Until when a record's photos or video are kept. */
export function keptUntil(createdAt: number, keepUntil?: number | null): number {
  return Math.max(keepUntil || 0, since(createdAt) + KEEP_DAYS * DAY_MS);
}
/** Are they deleted by now (or will be at tonight's clean-up)? Never in a demo company. */
export function mediaGone(createdAt: number, keepUntil: number | null | undefined, demo: boolean, now = Date.now()): boolean {
  return !demo && now > keptUntil(createdAt, keepUntil);
}
/** When a record's photos would be kept until if marked now. */
export const damageUntil = (createdAt: number) => since(createdAt) + DAMAGE_DAYS * DAY_MS;
export const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
