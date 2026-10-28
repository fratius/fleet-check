import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { idbDeleteWhere, idbGet, idbPut } from './keep';

/**
 * The app opens without a connection: what this phone last saw is kept per person and company (the company and
 * role, and the data: vans, drivers' records, history...), shown until the live data arrives, and deleted when the
 * person signs out (shared phones). The phone app keeps it as a file, the web app in IndexedDB.
 */

const isWeb = Platform.OS === 'web';
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
const dir = () => new Directory(Paths.document, 'cache');
const fileOf = (key: string) => new File(Paths.document, 'cache', `${safe(key)}.json`);

/** What was saved under `key`, or null. */
export async function readCache<T>(key: string): Promise<T | null> {
  try {
    if (isWeb) return ((await idbGet<T>(`cache/${key}`)) ?? null) as T | null;
    const f = fileOf(key);
    return f.exists ? (JSON.parse(await f.text()) as T) : null;
  } catch { return null; }
}

/** Saves `value` under `key` (best effort). */
export async function writeCache(key: string, value: unknown) {
  try {
    if (isWeb) { await idbPut(`cache/${key}`, JSON.parse(JSON.stringify(value))); return; }
    const d = dir();
    d.create({ intermediates: true, idempotent: true });
    const f = fileOf(key);
    if (!f.exists) f.create();
    await f.write(JSON.stringify(value));
  } catch { /* a saved copy is only a convenience */ }
}

/** Deletes the saved copies of this person (keys start with "<uid>-<orgId>-") whose company `drop` says. */
async function dropCaches(uid: string, drop: (orgId: string) => boolean) {
  const pre = `${safe(uid)}-`;
  const orgOf = (name: string) => name.slice(pre.length).split('-')[0];
  if (isWeb) { await idbDeleteWhere((k) => k.startsWith(`cache/${pre}`) && drop(orgOf(k.slice('cache/'.length)))); return; }
  const d = dir();
  if (!d.exists) return;
  for (const f of d.list()) if (f.name.startsWith(pre) && drop(orgOf(f.name.replace(/\.json$/, '')))) f.delete();
}

/** Deletes everything saved for this person (signing out, deleting the account). */
export async function clearCaches(uid: string) {
  try {
    await AsyncStorage.removeItem(sessionKey(uid));
    await dropCaches(uid, () => true);
  } catch { /* nothing more to do */ }
}

/** Deletes what was saved for companies the person no longer belongs to (seen when the server answered). */
export async function keepCachesOf(uid: string, orgIds: string[]) {
  const keep = new Set(orgIds.map(safe));
  try { await dropCaches(uid, (o) => !keep.has(o)); } catch { /* best effort */ }
}

/** The company and role the person had open (small, so in AsyncStorage). */
export const sessionKey = (uid: string) => `fc.session.${uid}`;
export async function readSession<T>(uid: string): Promise<T | null> {
  try { return JSON.parse((await AsyncStorage.getItem(sessionKey(uid))) || 'null') as T | null; } catch { return null; }
}
export function writeSession(uid: string, value: unknown) {
  AsyncStorage.setItem(sessionKey(uid), JSON.stringify(value)).catch(() => {});
}

/** Rows from the saved copy with the ones Firestore has on the phone now laid over them (changes made offline). */
export function overlay<T extends { id: string }>(saved: T[], now: T[]): T[] {
  if (!now.length) return saved;
  const m = new Map(saved.map((r) => [r.id, r]));
  for (const r of now) m.set(r.id, r);
  // Newest first, as the live lists come.
  return [...m.values()].sort((a, b) => (Number((b as { createdAt?: number }).createdAt) || 0) - (Number((a as { createdAt?: number }).createdAt) || 0));
}
