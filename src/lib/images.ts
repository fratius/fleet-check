import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

import { fb } from './firebase';

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

/** Uploads a local image to Firebase Storage. */
export async function upload(uri: string, path: string, onProgress?: (f: number) => void): Promise<string> {
  const f = fb();
  if (!f) throw new Error('Firebase is not configured');
  const blob = await (await fetch(uri)).blob();
  const task = uploadBytesResumable(ref(f.storage, path), blob, { contentType: 'image/jpeg' });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve());
  });
  return path;
}

const urlCache = new Map<string, Promise<string>>();
/** A displayable URL for a stored path, or the local uri as is. */
export function photoUrl(p: { uri?: string; path?: string } | string | null | undefined): Promise<string | null> {
  if (!p) return Promise.resolve(null);
  if (typeof p === 'string') p = /^(file|data|blob|https?|content|ph|assets-library):/.test(p) ? { uri: p } : { path: p };
  if (p.uri) return Promise.resolve(p.uri);
  const f = fb();
  if (!p.path || !f) return Promise.resolve(null);
  let u = urlCache.get(p.path);
  if (!u) {
    u = getDownloadURL(ref(f.storage, p.path));
    urlCache.set(p.path, u);
    u.catch(() => urlCache.delete(p.path!));
  }
  return u.catch(() => null);
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
