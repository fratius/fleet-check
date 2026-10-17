import { newId, prepare, upload } from './images';
import { LOCAL_STATION, type Store } from './store';
import type { Photo, Vehicle, Walkaround } from './types';

export interface LocalShot { n: number; label: string; uri: string; w: number; h: number; takenAt: number; retakes?: number }

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

/**
 * Saves a walk-around. With Firebase the photos are resized to 2400 px, uploaded to
 * orgs/{org}/walkarounds/{id}/NN.jpg and the record is written afterwards; on a phone-only
 * setup the local file uris are kept as they are.
 */
export async function saveWalk(store: Store, v: Vehicle, uid: string | null, shots: LocalShot[], meta: {
  source: Walkaround['source']; frames: number; skipped: number; retakes: number; totalMs: number | null;
}, onProgress?: (done: number, total: number) => void): Promise<string> {
  const id = newId();
  const photos: Photo[] = shots.map((s) => ({ n: s.n, label: s.label, w: s.w, h: s.h, takenAt: s.takenAt }));
  if (store.mode === 'firebase') {
    let done = 0;
    onProgress?.(0, shots.length);
    await pool(shots, 3, async (s, i) => {
      const p = await prepare(s.uri, s.w, s.h);
      const path = await upload(p.uri, `orgs/${store.orgId}/walkarounds/${id}/${String(s.n).padStart(2, '0')}.jpg`);
      photos[i] = { ...photos[i], path, w: p.w, h: p.h };
      onProgress?.(++done, shots.length);
    });
  } else {
    shots.forEach((s, i) => { photos[i] = { ...photos[i], uri: s.uri }; });
  }
  await store.walks.add({
    vehicleId: v.id, vehicleName: v.name, cls: v.cls, stationId: v.stationId || (store.mode === 'local' ? LOCAL_STATION : undefined),
    source: meta.source, createdAt: Date.now(), createdBy: uid,
    totalMs: meta.totalMs, frames: meta.frames, taken: shots.length, skipped: meta.skipped, retakes: meta.retakes, photos,
  }, id);
  return id;
}
