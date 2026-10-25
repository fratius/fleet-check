/**
 * Translations. The English text is the key: t('Start scanning') shows the translation of "Start scanning" in the
 * chosen language, or the English when there is none. Translations are in public/i18n/<code>.json (served with the
 * web app, fetched by the phone app and kept on the phone); `npm run i18n` lists the texts and what each language is
 * missing.
 *
 * Rules (see AGENTS.md):
 * - Whole sentences, with {placeholders} for what changes: t('Started {when} at {km}', { when, km }). Never build a
 *   sentence from translated pieces.
 * - Counts: tp(n, '{n} photo', '{n} photos'). The key is the English plural; each language has its own forms.
 * - Text kept in a constant at the top of a file: mark it with N_('...') and translate it where it's shown, t(label).
 *   Never call t() at the top level of a file: it would run once, in English, before the language is loaded.
 * - Not translated: what people type, names of vans, stations and people, and what the AI wrote.
 */

export type PluralCat = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type Vars = Record<string, string | number | null | undefined>;
export type Entry = string | Partial<Record<PluralCat, string>>;
export type Dict = Record<string, Entry>;

export interface Lang { code: string; name: string; english: string; rtl?: boolean }
/** The languages the app is translated into, by their own name. */
export const LANGS: Lang[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'ro', name: 'Română', english: 'Romanian' },
  { code: 'bg', name: 'Български', english: 'Bulgarian' },
  { code: 'cs', name: 'Čeština', english: 'Czech' },
  { code: 'sk', name: 'Slovenčina', english: 'Slovak' },
  { code: 'hu', name: 'Magyar', english: 'Hungarian' },
  { code: 'hr', name: 'Hrvatski', english: 'Croatian' },
  { code: 'sr', name: 'Srpski', english: 'Serbian' },
  { code: 'sl', name: 'Slovenščina', english: 'Slovenian' },
  { code: 'sq', name: 'Shqip', english: 'Albanian' },
  { code: 'el', name: 'Ελληνικά', english: 'Greek' },
  { code: 'lt', name: 'Lietuvių', english: 'Lithuanian' },
  { code: 'lv', name: 'Latviešu', english: 'Latvian' },
  { code: 'et', name: 'Eesti', english: 'Estonian' },
  { code: 'fi', name: 'Suomi', english: 'Finnish' },
  { code: 'sv', name: 'Svenska', english: 'Swedish' },
  { code: 'da', name: 'Dansk', english: 'Danish' },
  { code: 'nb', name: 'Norsk', english: 'Norwegian' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'uk', name: 'Українська', english: 'Ukrainian' },
  { code: 'ar', name: 'العربية', english: 'Arabic', rtl: true },
  { code: 'fa', name: 'فارسی', english: 'Persian', rtl: true },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
];
export const LANG_CODES = LANGS.map((l) => l.code);
/** Codes phones use for the same languages. */
const ALIAS: Record<string, string> = { no: 'nb', nn: 'nb', bs: 'hr', me: 'sr', cnr: 'sr', mo: 'ro', ua: 'uk', iw: 'en' };
/** A supported code for a language tag ("de-AT" → "de", "no" → "nb"), or null. */
export function supported(tag: string | null | undefined): string | null {
  const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
  const code = ALIAS[base] || base;
  return LANG_CODES.includes(code) ? code : null;
}

let current = 'en';
let dict: Dict = {};

/** The language shown now. */
export const lang = () => current;
export const isRtl = () => !!LANGS.find((l) => l.code === current)?.rtl;
/** For dates and numbers (toLocaleString). Serbian is translated in the Latin script. */
export const loc = () => (current === 'sr' ? 'sr-Latn' : current);
/** Switches the texts. The app remounts its screens after this (see lang.tsx). */
export function applyDict(code: string, d: Dict) { current = code; dict = d; }

/** Marks a text for translation where it can't be translated yet; translate it with t() where it is shown. */
export const N_ = <S extends string>(s: S): S => s;

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v && v[k] != null ? String(v[k]) : m)) : s);

/** The text in the chosen language, with {placeholders} filled in. */
export function t(s: string, v?: Vars): string {
  const e = dict[s];
  const out = typeof e === 'string' ? e || s : e && typeof e === 'object' ? e.other || s : s;
  return fill(out, v);
}

/** A count: tp(3, '{n} photo', '{n} photos') → "3 photos", in each language's own plural forms. {n} is formatted. */
export function tp(n: number, one: string, other: string, v?: Vars): string {
  const vars: Vars = { n: Number.isFinite(n) ? n.toLocaleString(loc()) : String(n), ...v };
  const e = dict[other];
  if (e && typeof e === 'object') return fill(e[pluralCat(current, n)] || e.other || other, vars);
  if (typeof e === 'string' && e) return fill(e, vars);
  return fill(n === 1 ? one : other, vars);
}

/**
 * Like t(), for a sentence with parts that aren't plain text (a bold name, a link): returns the pieces in the
 * translated order, to put inside a <Text>.
 */
export function tj<N>(s: string, parts: Record<string, N | string | number>): (N | string)[] {
  const e = dict[s];
  const out = typeof e === 'string' && e ? e : s;
  const pieces: (N | string)[] = [];
  let last = 0;
  out.replace(/\{(\w+)\}/g, (m, k: string, at: number) => {
    if (at > last) pieces.push(out.slice(last, at));
    const p = parts[k];
    pieces.push(p == null ? m : typeof p === 'number' ? String(p) : p);
    last = at + m.length;
    return m;
  });
  if (last < out.length) pieces.push(out.slice(last));
  return pieces;
}

/** CLDR plural category of n in a language (Intl.PluralRules when the phone has it, else the rules below). */
export function pluralCat(code: string, n: number): PluralCat {
  try {
    const PR = (Intl as unknown as { PluralRules?: new (l: string) => { select(n: number): string } }).PluralRules;
    if (PR) return new PR(code).select(n) as PluralCat;
  } catch { /* the rules below */ }
  const i = Math.floor(Math.abs(n)), int = Number.isInteger(n), m10 = i % 10, m100 = i % 100;
  switch (code) {
    case 'vi': return 'other';
    case 'fr': case 'hi': case 'fa': return i === 0 || i === 1 ? 'one' : 'other';
    case 'pt': return i === 0 || i === 1 ? 'one' : 'other';
    case 'cs': case 'sk': return !int ? 'many' : i === 1 ? 'one' : i >= 2 && i <= 4 ? 'few' : 'other';
    case 'pl': return !int ? 'other' : i === 1 ? 'one' : m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 'few' : 'many';
    case 'ru': case 'uk':
      return !int ? 'other' : m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 'few' : 'many';
    case 'hr': case 'sr': return m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 'few' : 'other';
    case 'sl': return m100 === 1 ? 'one' : m100 === 2 ? 'two' : m100 === 3 || m100 === 4 || !int ? 'few' : 'other';
    case 'lt': return !int ? 'many' : m10 === 1 && !(m100 >= 11 && m100 <= 19) ? 'one' : m10 >= 2 && !(m100 >= 11 && m100 <= 19) ? 'few' : 'other';
    case 'lv': return m10 === 0 || (m100 >= 11 && m100 <= 19) ? 'zero' : m10 === 1 && m100 !== 11 ? 'one' : 'other';
    case 'ro': return i === 1 && int ? 'one' : !int || i === 0 || (m100 >= 2 && m100 <= 19) ? 'few' : 'other';
    case 'ar': return n === 0 ? 'zero' : n === 1 ? 'one' : n === 2 ? 'two' : m100 >= 3 && m100 <= 10 ? 'few' : m100 >= 11 && m100 <= 99 ? 'many' : 'other';
    default: return n === 1 ? 'one' : 'other';
  }
}

/** The forms each language uses (what a translation of a count must have). */
export const PLURAL_FORMS: Record<string, PluralCat[]> = {
  vi: ['other'], cs: ['one', 'few', 'many', 'other'], sk: ['one', 'few', 'many', 'other'], pl: ['one', 'few', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'], uk: ['one', 'few', 'many', 'other'], hr: ['one', 'few', 'other'], sr: ['one', 'few', 'other'],
  sl: ['one', 'two', 'few', 'other'], lt: ['one', 'few', 'many', 'other'], lv: ['zero', 'one', 'other'], ro: ['one', 'few', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'], fr: ['one', 'many', 'other'],
};
export const formsOf = (code: string): PluralCat[] => PLURAL_FORMS[code] || ['one', 'other'];
