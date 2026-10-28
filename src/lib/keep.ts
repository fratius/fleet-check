import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Keeps the photos and videos of the outbox (lib/outbox.ts) on the phone until they're uploaded: in the app's
 * documents folder (the phone app), or in the browser's IndexedDB (the web app), so they survive the app being
 * closed. Keys are "jobId/name"; the folder is found again at run time (on iPhones its path changes with updates).
 */

const ROOT = 'outbox';
const isWeb = Platform.OS === 'web';

/* ---------- The phone app: files ---------- */
const fileOf = (key: string) => new File(Paths.document, ROOT, ...key.split('/'));
const dirOf = (jobId: string) => new Directory(Paths.document, ROOT, jobId);

/* ---------- The web app: IndexedDB, with a copy in memory for this session ---------- */
const mem = new Map<string, Blob>();
let dbp: Promise<IDBDatabase | null> | null = null;
function idb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const rq = indexedDB.open('fratius-outbox', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('files'); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return idb().then((db) => new Promise<T | null>((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const t = db.transaction('files', mode);
      const r = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(r ? (r.result as T) : null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

/**
 * Keeps a file for a job and returns its key. `uri` is a local file (the phone app: moved or copied into the
 * outbox folder) or anything `fetch` can read (the web app: blob or data URL); `blob` is used as it is.
 */
export async function keepFile(jobId: string, name: string, src: { uri: string; move?: boolean } | { blob: Blob }): Promise<string> {
  const key = `${jobId}/${name}`;
  if (!isWeb) {
    const dir = dirOf(jobId);
    dir.create({ intermediates: true, idempotent: true });
    const to = fileOf(key);
    if (to.exists) to.delete();
    if ('blob' in src) {
      to.create();
      await to.write(new Uint8Array(await src.blob.arrayBuffer()));
    } else {
      const from = new File(src.uri);
      // A recording or a resized photo is a temporary file: moved, not copied. A photo from the library is copied.
      if (src.move) await from.move(to); else await from.copy(to);
    }
    return key;
  }
  const blob = 'blob' in src ? src.blob : await (await fetch(src.uri)).blob();
  mem.set(key, blob);
  await tx('readwrite', (s) => s.put(blob, key));
  return key;
}

/** The kept file, or null when it's gone. */
export async function keptBlob(key: string): Promise<Blob | null> {
  if (!isWeb) {
    const f = fileOf(key);
    if (!f.exists) return null;
    return (await fetch(f.uri)).blob();
  }
  const m = mem.get(key);
  if (m) return m;
  const b = await tx<Blob>('readonly', (s) => s.get(key));
  return b instanceof Blob ? b : null;
}

/** The kept file's size in bytes, or null. */
export async function keptSize(key: string): Promise<number | null> {
  if (!isWeb) {
    const f = fileOf(key);
    return f.exists ? f.size : null;
  }
  return (await keptBlob(key))?.size ?? null;
}

/** A local address to show the kept photo (the phone app), or null. */
export function keptUri(key: string): string | null {
  if (isWeb) return null;
  const f = fileOf(key);
  return f.exists ? f.uri : null;
}

/** Deletes a job's files. */
export async function dropKept(jobId: string, keys: string[]) {
  if (!isWeb) {
    const d = dirOf(jobId);
    if (d.exists) d.delete();
    return;
  }
  for (const k of keys) mem.delete(k);
  await tx('readwrite', (s) => { for (const k of keys) s.delete(k); });
}

/** Deletes files of jobs that aren't on the list (the app was closed while it was saving them). */
export async function sweepKept(jobIds: Set<string>) {
  try {
    if (!isWeb) {
      const root = new Directory(Paths.document, ROOT);
      if (!root.exists) return;
      for (const d of root.list()) if (!jobIds.has(d.name)) d.delete();
      return;
    }
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const gone = (keys || []).map(String).filter((k) => !jobIds.has(k.split('/')[0]));
    if (gone.length) await tx('readwrite', (s) => { for (const k of gone) s.delete(k); });
  } catch { /* only tidying up */ }
}
