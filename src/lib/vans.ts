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
