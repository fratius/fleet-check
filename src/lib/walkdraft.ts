import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { dropKept, keepFile, keptBlob, keptUri, sweepDrafts } from './keep';
import type { PhotoQuality } from './types';
import type { LocalShot } from './walks';

/**
 * A walk-around being taken, kept on the phone photo by photo (product owner, 2026-11-26: a reload or a closed app
 * must not lose the photos, and nothing is thrown away unless the driver chooses to). Until the photos are sent
 * they're a draft: each "Use photo" keeps the photo (lib/keep.ts, under "draft-<id>") and the list of frames
 * (AsyncStorage). The draft's id is the walk-around's id when it's sent, so it can't be sent twice (lib/outbox.ts
 * queueWalk). One draft per person, company, van and kind (walk-around, pick-up, drop-off, a manager's pick-up).
 */

export type DraftSlot = { n: number; label: string; key: string; w: number; h: number; takenAt: number; retakes?: number; q?: PhotoQuality | null } | 'skip' | null;
export interface WalkDraft { id: string; slots: DraftSlot[]; retakes: number; elapsedMs: number; totalMs: number | null; savedAt: number }
export type Slot = LocalShot | 'skip' | null;

const PREFIX = 'walkDraft:';
/** A pick-up's or drop-off's photos count for two hours on the server (functions/src/index.ts, HANDOVER_MAX_AGE). */
export const HANDOVER_KEEP_MS = 2 * 60 * 60_000;
/** A walk-around's draft is kept a week. */
const WALK_KEEP_MS = 7 * 24 * 60 * 60_000;

export const draftDir = (id: string) => `draft-${id}`;
export function draftKey(o: { uid: string; orgId: string; vehicleId: string; what: 'pickup' | 'dropoff' | 'walkaround'; assignmentId?: string | null }) {
  return `${PREFIX}${o.uid}:${o.orgId}:${o.vehicleId}:${o.what}:${o.assignmentId || ''}`;
}

const keysOf = (d: WalkDraft) => d.slots.filter((x): x is Exclude<DraftSlot, 'skip' | null> => !!x && x !== 'skip').map((x) => x.key);

async function read(key: string): Promise<WalkDraft | null> {
  try {
    const d = JSON.parse((await AsyncStorage.getItem(key)) || 'null') as WalkDraft | null;
    return d && typeof d.id === 'string' && Array.isArray(d.slots) ? d : null;
  } catch { return null; }
}

/** A local address to show and send a kept photo: a file in the phone app, a blob address in the web app. */
async function uriOf(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return keptUri(key);
  const b = await keptBlob(key);
  return b ? URL.createObjectURL(b) : null;
}

/**
 * The draft for this walk-around, with its photos ready to show and send, or null. Photos that are gone, or (for a
 * pick-up or drop-off) older than the server takes, come back as missing; `dropped` counts them.
 */
export async function loadDraft(key: string, frames: number, handover: boolean): Promise<{ draft: WalkDraft; slots: Slot[]; dropped: number } | null> {
  const d = await read(key);
  if (!d) return null;
  const now = Date.now();
  if (now - d.savedAt > (handover ? HANDOVER_KEEP_MS : WALK_KEEP_MS) || d.slots.length !== frames) { await dropDraft(key, d); return null; }
  let dropped = 0;
  const slots: Slot[] = await Promise.all(d.slots.map(async (x): Promise<Slot> => {
    if (!x || x === 'skip') return x;
    const uri = handover && now - x.takenAt > HANDOVER_KEEP_MS ? null : await uriOf(x.key);
    if (!uri) { dropped++; return null; }
    const { key: _k, ...rest } = x;
    return { ...rest, uri };
  }));
  if (!slots.some((x) => x && x !== 'skip')) { await dropDraft(key, d); return null; }
  return { draft: d, slots, dropped };
}

/** Keeps one photo of the draft on the phone; returns its key. The camera's file stays where it is (the screen shows it). */
export function keepDraftPhoto(id: string, n: number, uri: string): Promise<string> {
  return keepFile(draftDir(id), `${String(n).padStart(2, '0')}.jpg`, { uri, move: false });
}

export async function saveDraft(key: string, d: WalkDraft) {
  await AsyncStorage.setItem(key, JSON.stringify({ ...d, savedAt: Date.now() }));
}

/** The draft is gone: sent (its photos are now the walk-around's in the outbox) or thrown away. */
export async function dropDraft(key: string, d?: WalkDraft | null) {
  const cur = d ?? (await read(key));
  await AsyncStorage.removeItem(key).catch(() => {});
  if (cur) await dropKept(draftDir(cur.id), keysOf(cur)).catch(() => {});
}

/** On start: drafts too old to be used go, with their photos, and photos of drafts that no longer exist go too. */
export async function pruneDrafts() {
  try {
    const all = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const live = new Set<string>();
    for (const k of all) {
      const d = await read(k);
      if (!d || Date.now() - d.savedAt > WALK_KEEP_MS) { await dropDraft(k, d); continue; }
      live.add(draftDir(d.id));
    }
    await sweepDrafts(live);
  } catch { /* only tidying up */ }
}
