import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking, Platform } from 'react-native';

/**
 * The Android test version: the app file the pilot DSPs install from fratius.com/android until Fratius is in Google
 * Play. Its updates come like every store app's (the "production" channel), but a new app version (new native
 * packages, a new SDK: scripts/native.mjs) needs a new download, which Google Play would otherwise do by itself. So
 * the app asks the website which version the newest file is (/downloads/android.json, written when the website is
 * deployed: scripts/website-apk.sh) and shows "Download" when the phone runs an older one.
 *
 * Only the Android app outside Expo Go asks. Today every such app is the test version; once Fratius is in Google
 * Play, the website's page and file are deleted (store/README.md, "Android test version"), the question gets no
 * answer and nothing shows. The web build uses apk.web.ts.
 */
export const APK_PAGE = 'https://fratius.com/android';
const INFO = 'https://fratius.com/downloads/android.json';
const EVERY = 6 * 3600_000;

/** Is this the Android app installed from a file or a store (not Expo Go, not the web)? */
export const isApk = () => Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  && !!(Constants.expoConfig?.extra as { store?: boolean } | undefined)?.store;

/** The version of the app's native part ("1.0.0"): its updates' runtime, which the store builds tie to the version. */
export const nativeVersion = () => Updates.runtimeVersion || null;

/** -1, 0 or 1 for two versions like "1.0.0" and "1.1.0". */
export function compareVersions(a: string, b: string) {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0), y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

let newer: string | null = null;
let askedAt = 0;
let later = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

async function ask() {
  const mine = nativeVersion();
  if (!isApk() || !mine || Date.now() - askedAt < EVERY) return;
  askedAt = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 15_000);
  try {
    const r = await fetch(INFO, { cache: 'no-store', signal: stop.signal });
    // No file (not yet, or no longer once Fratius is in Google Play): nothing to offer.
    const v = r.ok ? String(((await r.json()) as { version?: string }).version || '') : '';
    const next = v && compareVersions(mine, v) < 0 ? v : null;
    if (next !== newer) { newer = next; changed(); }
  } catch {
    // No connection: ask again the next time the app comes to the front.
    askedAt = 0;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The newer version to download, or null. Asked when the app starts and when it comes back to the front, at most
 * every 6 hours; "Later" hides it until the app is started again.
 */
export function useNewerApk(): string | null {
  useEffect(() => {
    if (!isApk()) return;
    ask();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') ask(); });
    return () => sub.remove();
  }, []);
  return useSyncExternalStore(subscribe, shown);
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const shown = () => (later ? null : newer);

export function apkLater() { later = true; changed(); }
export function openApkPage() { Linking.openURL(APK_PAGE).catch(() => {}); }
