/**
 * What a van is called: its number plate (the app's src/lib/vans.ts holds the same rule). A DSP runs tens of the
 * same model, so the plate tells them apart (product owner, 2026-11-02). Vans saved without a plate go by their name.
 * Records the server writes keep this in vehicleName, so notifications, the Data tab and Excel show the plate.
 */
export function vanName(v: { plate?: string | null; name?: string | null } | null | undefined): string {
  if (!v) return '';
  return String(v.plate || '').trim() || String(v.name || '').trim();
}
