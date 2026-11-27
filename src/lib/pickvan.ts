import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useSession } from './session';
import { ai, failText } from './store';
import type { Vehicle } from './types';

/**
 * A van a driver picks up (blind test, 26 Nov 2026, cause 3a): drivers don't read the station's other vans, so the
 * server finds it by its plate (vanByPlate) and the camera or the video gets it from here. Kept for this session; after
 * a reload the camera asks the server again with the plate in its address.
 */
export interface PickVan { van: Vehicle; plate: string; taken: boolean; mine: boolean; expect: string | null }
const known = new Map<string, PickVan>();

export async function findVanByPlate(orgId: string, by: { plate?: string; path?: string }): Promise<PickVan> {
  const r = await ai.vanByPlate({ orgId, ...by });
  const van = { ...r, createdAt: 0, createdBy: '', scanId: null } as unknown as Vehicle;
  const p: PickVan = { van, plate: r.plate, taken: r.taken, mine: r.mine, expect: r.expect };
  known.set(r.id, p);
  return p;
}

/** The van of a pick-up by its id: the one found by its plate, or asked again with the plate (after a reload). */
export function usePickVan(id: string | null, plate: string | null): { pv: PickVan | null; err: string | null } {
  const s = useSession();
  const [pv, setPv] = useState<PickVan | null>(id ? known.get(id) || null : null);
  const [err, setErr] = useState<string | null>(null);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!id || !orgId || known.has(id) || !plate) return;
    let live = true;
    findVanByPlate(orgId, { plate }).then((p) => { if (live && p.van.id === id) setPv(p); }).catch((e) => { if (live) setErr(failText(e, 'Finding the van by its plate')); });
    return () => { live = false; };
  }, [id, orgId, plate]);
  return { pv: id ? pv || known.get(id) || null : null, err };
}

/** After a pick-up by the plate: the Vans tab, whether the plate page is under it in the stack or the page was opened alone. */
export function toVansTab() {
  if (router.canDismiss()) router.dismissTo('/'); else router.replace('/');
}
