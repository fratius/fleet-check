/**
 * How a van is called in the app: by its number plate. A DSP runs tens of the same model (Sprinter, Vito,
 * Transporter), so the plate is what tells them apart (product owner, 2026-11-02). The model is a detail of the
 * van, never its name. Vans saved without a plate go by the name they were given until one is added.
 * The functions follow the same rule (vanLabel in functions/src/index.ts).
 */
type Named = { plate?: string | null; name?: string | null };

/** The plate, or the saved name for a van without one. */
export function vanName(v: Named | null | undefined): string {
  if (!v) return '';
  return (v.plate || '').trim() || (v.name || '').trim();
}

/** The van's own name or fleet number, when it has one besides its plate (shown small, after the plate). */
export function vanAlias(v: Named | null | undefined): string {
  const p = (v?.plate || '').trim(), n = (v?.name || '').trim();
  return p && n && n.toLowerCase() !== p.toLowerCase() ? n : '';
}

/** Plates written the same way, for finding a van and for spotting the same plate twice. */
export const plateKey = (p: string | null | undefined) => (p || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

/**
 * The Fleet search (product owner, 2026-11-23): a van matches when what was typed appears, in that order and
 * without gaps, in its plate or its own name or fleet number. Spaces, dashes and capitals don't count, so "314",
 * "dx314" and "B-DX 314" all find B-DX 3141.
 */
export function vanMatches(v: Named, query: string): boolean {
  const q = plateKey(query);
  if (!q) return true;
  return plateKey(v.plate).includes(q) || plateKey(v.name).includes(q);
}

// Letters that are a letter of their own, not one with an accent, but that people type as the plain one: Turkish ı
// and İ (a search for "yılmaz" found nobody: blind test, cause 4.4), Polish ł, ø, æ, œ, đ, ß.
const PLAIN: Record<string, string> = { ı: 'i', ł: 'l', đ: 'd', ð: 'd', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', þ: 'th', ħ: 'h' };
/** Names as people type them: small letters, no accents (ș, é, ü, İ), ı ł ß as i l ss, single spaces. */
export const nameKey = (x: string | null | undefined) => (x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ıłđðøæœßþħ]/g, (c) => PLAIN[c] || c).replace(/\s+/g, ' ').trim();

/** The longest first or last name (the server refuses longer ones with a message, never cuts them: cause 4.3). */
export const NAME_MAX = 40;
export const nameTooLong = (x: string | null | undefined) => (x || '').trim().length > NAME_MAX;

/**
 * Up to two initials for a person's circle: the first letter of the first two words that start with a letter or a
 * digit. An emoji or a sign is skipped, never cut in half (an emoji name broke the circle: cause 4.3).
 */
export function initials(name: string | null | undefined): string {
  const firsts = (name || '').split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0]).filter((c): c is string => !!c);
  return firsts.slice(0, 2).map((c) => c.toLocaleUpperCase()).join('') || '?';
}

/**
 * The People search (product owner, 2026-11-23): like the Fleet search, what was typed appears in that order in the
 * person's name ("ana p" finds Ana Pop and Ioana Popescu; accents and capitals don't count), their Amazon
 * Transporter ID, or their phone number (digits only).
 */
export function personMatches(p: { name?: string | null; transporterId?: string | null; phone?: string | null }, query: string): boolean {
  const q = nameKey(query);
  if (!q) return true;
  if (nameKey(p.name).includes(q)) return true;
  const k = plateKey(query);
  if (k && plateKey(p.transporterId).includes(k)) return true;
  const digits = query.replace(/\D/g, '');
  return digits.length >= 3 && digits.length === query.replace(/[\s+()/-]/g, '').length && (p.phone || '').replace(/\D/g, '').includes(digits);
}
