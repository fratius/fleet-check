import { loc } from './i18n';

/**
 * How long photos and videos are kept (the same rule as functions/src/media.ts): 30 days; 90 days from when they
 * were taken when damage was approved in a check of them or an owner or manager marked them as damage. The records
 * stay for good. Demo companies keep their (drawn) pictures.
 */
export const KEEP_DAYS = 30;
export const DAMAGE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Until when a record's photos or video are kept. */
export function keptUntil(createdAt: number, keepUntil?: number | null): number {
  return keepUntil && keepUntil > createdAt ? keepUntil : createdAt + KEEP_DAYS * DAY_MS;
}
/** Are they deleted by now (or will be at tonight's clean-up)? Never in a demo company. */
export function mediaGone(createdAt: number, keepUntil: number | null | undefined, demo: boolean, now = Date.now()): boolean {
  return !demo && now > keptUntil(createdAt, keepUntil);
}
/** When a record's photos would be kept until if marked now. */
export const damageUntil = (createdAt: number) => createdAt + DAMAGE_DAYS * DAY_MS;
export const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
