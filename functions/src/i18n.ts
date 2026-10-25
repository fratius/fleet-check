import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Texts the server writes for people, in their language. The English text is the key, as in the app (src/lib/i18n.ts);
 * the translations are the app's (public/i18n/<code>.json, copied into lib/i18n when the functions are built).
 *
 * - Errors: fail('failed-precondition', 'English with {x}', { x }). The message stays English (for logs); the app
 *   shows it in the person's language from the template and values sent with it.
 * - Notifications: tr(lang, ...) with the recipient's language (langOf).
 * - Texts kept in a record for others to read (flags): store the template and values (see purchases.ts), so each
 *   reader sees their own language.
 */

export type Vars = Record<string, string | number | null | undefined>;
type Entry = string | Record<string, string>;

/** Marks a text for translation (found by scripts/i18n.mjs); returns it unchanged. */
export const N_ = <S extends string>(s: S): S => s;

export const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v && v[k] != null ? String(v[k]) : m)) : s);

/** An error for the app: the English message, with the template and values so the app can show it in any language. */
export function fail(code: FunctionsErrorCode, msg: string, v?: Vars): HttpsError {
  const vals: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(v || {})) if (x != null) vals[k] = x;
  return new HttpsError(code, fill(msg, v), { t: msg, v: vals });
}

const dicts = new Map<string, Record<string, Entry>>();
function dictOf(lang: string): Record<string, Entry> {
  if (!lang || lang === 'en') return {};
  let d = dicts.get(lang);
  if (!d) {
    try { d = JSON.parse(readFileSync(join(__dirname, 'i18n', `${lang.replace(/[^a-z]/g, '')}.json`), 'utf8')) as Record<string, Entry>; } catch { d = {}; }
    dicts.set(lang, d);
  }
  return d;
}

/** A text in a language (English when there's no translation). */
export function tr(lang: string, msg: string, v?: Vars): string {
  const e = dictOf(lang)[msg];
  return fill(typeof e === 'string' && e ? e : e && typeof e === 'object' ? e.other || msg : msg, v);
}

/** A count in a language: trp(lang, n, '{n} photo', '{n} photos'). */
export function trp(lang: string, n: number, one: string, other: string, v?: Vars): string {
  const e = dictOf(lang)[other];
  const vars = { n, ...v };
  if (e && typeof e === 'object') {
    let cat = 'other';
    try { cat = new Intl.PluralRules(lang).select(n); } catch { cat = n === 1 ? 'one' : 'other'; }
    return fill(e[cat] || e.other || other, vars);
  }
  if (typeof e === 'string' && e) return fill(e, vars);
  return fill(n === 1 ? one : other, vars);
}

/** The language a person sees the app in (what they picked, or what their phone shows), for their notifications. */
export async function langOf(uid: string): Promise<string> {
  try {
    const u = (await getFirestore().doc(`users/${uid}`).get()).data() as { lang?: string; appLang?: string } | undefined;
    return String(u?.lang || u?.appLang || 'en');
  } catch { return 'en'; }
}
