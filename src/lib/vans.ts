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

/** Names as people type them: small letters, no accents (ș, é, ü), single spaces. */
export const nameKey = (x: string | null | undefined) => (x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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
