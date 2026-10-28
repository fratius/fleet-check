import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getDownloadURL, getMetadata, ref, uploadBytesResumable, type StorageReference } from 'firebase/storage';

import { fb } from './firebase';
import { onWake, retrying, setWaiting } from './net';

/** Longest edge sent to storage and to the AI. Claude's high-resolution tier reads up to 2576 px. */
export const MAX_EDGE = 2400;

export interface Prepared { uri: string; w: number; h: number }

/** Resizes to at most MAX_EDGE on the long side and re-encodes as JPEG. */
export async function prepare(uri: string, w: number, h: number, maxEdge = MAX_EDGE, compress = 0.85): Promise<Prepared> {
  const ctx = ImageManipulator.manipulate(uri);
  if (w && h && Math.max(w, h) > maxEdge) {
    if (w >= h) ctx.resize({ width: maxEdge, height: null });
    else ctx.resize({ width: null, height: maxEdge });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: out.uri, w: out.width, h: out.height };
}

/**
 * Uploads a local image to Firebase Storage. Without a connection it waits and tries again by itself until it's
 * up (the strip above the tab bar says so), so nobody has to take the photo again.
 */
export async function upload(uri: string, path: string, onProgress?: (f: number) => void): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  let tried = false;
  const key = `u:${path}`;
  await retrying(async () => {
    const again = tried;
    tried = true;
    await putBlob(blob, path, 'image/jpeg', { again, onBytes: (sent, total) => onProgress?.(total ? sent / total : 0), onStall: (on) => setWaiting(key, on) });
  }).finally(() => setWaiting(key, false));
  return path;
}

/** No bytes moved for this long: the connection is probably gone. */
const STALL_MS = 8000;
/** Then the request is tried again this often (instead of the SDK's own wait of up to a minute). */
const KICK_MS = 15_000;
/** And after this long without any progress, the upload starts over (the SDK can get stuck without a sign-in token). */
const RESTART_MS = 60_000;

/**
 * Puts a file in storage, resuming where it stopped when the connection comes and goes. `again`: an earlier try
 * may already have finished it (storage only creates files, see storage.rules, so a second upload of the same path
 * is refused; then it's checked whether the file is there). Reports bytes, and whether it's stuck.
 */
export async function putBlob(blob: Blob, path: string, contentType: string, o: {
  again?: boolean; onBytes?: (sent: number, total: number) => void; onStall?: (stalled: boolean) => void;
} = {}): Promise<void> {
  const f = fb();
  if (!f) throw new Error('Firebase is not configured');
  const r = ref(f.storage, path);
  if (o.again && await isThere(r)) return;
  try {
    await putOnce(r, blob, contentType, o);
  } catch (e) {
    if ((e as { code?: string })?.code === 'storage/unauthorized' && await isThere(r)) return;
    throw e;
  }
}
async function isThere(r: StorageReference) {
  try { await getMetadata(r); return true; } catch (e) {
    if ((e as { code?: string })?.code === 'storage/object-not-found') return false;
    throw e;
  }
}
function putOnce(r: StorageReference, blob: Blob, contentType: string, o: { onBytes?: (sent: number, total: number) => void; onStall?: (stalled: boolean) => void }) {
  return new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(r, blob, { contentType });
    let bytes = -1, moved = Date.now(), kicked = Date.now(), stalled = false, over = false;
    const stall = (on: boolean) => { if (on !== stalled) { stalled = on; o.onStall?.(on); } };
    // The SDK waits up to a minute between its own tries; retry the stuck request sooner, keeping what's uploaded.
    const kick = () => {
      kicked = Date.now();
      if (task.snapshot.state === 'running' && task.pause()) task.resume();
    };
    const timer = setInterval(() => {
      const idle = Date.now() - moved;
      if (idle > STALL_MS) stall(true);
      if (idle > RESTART_MS) { finish(); task.cancel(); reject(Object.assign(new Error('Upload stalled'), { net: 'offline' })); return; }
      if (idle > KICK_MS && Date.now() - kicked > KICK_MS) kick();
    }, 2000);
    const offWake = onWake(() => { if (Date.now() - moved > 2000) kick(); });
    const finish = () => { over = true; clearInterval(timer); offWake(); stall(false); };
    task.on('state_changed', (s) => {
      if (over) return;
      if (s.bytesTransferred !== bytes) { bytes = s.bytesTransferred; moved = Date.now(); stall(false); }
      o.onBytes?.(s.bytesTransferred, s.totalBytes);
    }, (e) => { if (!over) { finish(); reject(e); } }, () => { if (!over) { finish(); resolve(); } });
  });
}

const urlCache = new Map<string, Promise<string>>();
/** Paths the storage says aren't there (deleted after 30 or 90 days, see lib/media.ts). */
const goneCache = new Set<string>();
/** A displayable URL for a stored path, or the local uri as is. */
export function photoUrl(p: { uri?: string; path?: string } | string | null | undefined): Promise<string | null> {
  return photoLookup(p).then((u) => (u === GONE ? null : u));
}
export const GONE = 'gone';
/** Like photoUrl, but says GONE when the file was deleted (rather than not loading for another reason). */
export function photoLookup(p: { uri?: string; path?: string } | string | null | undefined): Promise<string | null> {
  if (!p) return Promise.resolve(null);
  if (typeof p === 'string') p = /^(file|data|blob|https?|content|ph|assets-library):/.test(p) ? { uri: p } : { path: p };
  if (p.uri) return Promise.resolve(p.uri);
  const f = fb();
  if (!p.path || !f) return Promise.resolve(null);
  const path = p.path;
  if (goneCache.has(path)) return Promise.resolve(GONE);
  let u = urlCache.get(path);
  if (!u) {
    u = getDownloadURL(ref(f.storage, path));
    urlCache.set(path, u);
    u.catch(() => urlCache.delete(path));
  }
  return u.catch((e: { code?: string }) => {
    if (e?.code === 'storage/object-not-found') { goneCache.add(path); return GONE; }
    return null;
  });
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
