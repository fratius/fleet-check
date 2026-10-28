import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type { ErrKind } from './outboxcore';

/**
 * Without a connection, uploads and the server steps after them are tried again by themselves instead of asking
 * the person to do it again (photos and videos are never lost). This file says which errors mean "no connection",
 * waits between tries (less when the connection may be back: the browser says it's online again, or the app comes
 * back to the front), and counts what's waiting, for the strip above the tab bar (components/uploads.tsx).
 */

// Storage errors that won't go away by trying again.
const STORAGE_FINAL = new Set([
  'storage/unauthorized', 'storage/quota-exceeded', 'storage/invalid-argument', 'storage/invalid-checksum',
  'storage/no-default-bucket', 'storage/cannot-slice-blob', 'storage/invalid-root-operation', 'storage/invalid-format',
  'storage/invalid-url', 'storage/invalid-default-bucket', 'storage/app-deleted', 'storage/project-not-found',
  'storage/bucket-not-found', 'storage/object-not-found', 'storage/unsupported-environment', 'storage/invalid-event-name',
  'storage/internal-error', 'storage/no-download-url',
]);

/** Is this error a missing connection ('offline'), a slow or busy server ('flaky'), or something else (null)? */
export function netKind(e: unknown): ErrKind {
  const x = (e || {}) as { net?: unknown; code?: unknown; message?: unknown };
  if (x.net === 'offline' || x.net === 'flaky') return x.net;
  const code = typeof x.code === 'string' ? x.code : '';
  if (code.startsWith('storage/')) return STORAGE_FINAL.has(code) ? null : 'offline';
  if (code === 'unavailable' || code === 'firestore/unavailable' || code === 'auth/network-request-failed') return 'offline';
  if (code === 'deadline-exceeded' || code === 'firestore/deadline-exceeded') return 'flaky';
  const m = typeof x.message === 'string' ? x.message : '';
  if (/network request failed|failed to fetch|load failed|networkerror|network error|client is offline|internet connection appears to be offline/i.test(m)) return 'offline';
  return null;
}

/* ---------- Waking up when the connection may be back ---------- */
const wakers = new Set<() => void>();
/** The connection may be back: tries waiting for it go now. */
export function wake() { [...wakers].forEach((f) => f()); }
export function onWake(f: () => void) { wakers.add(f); return () => { wakers.delete(f); }; }
if (Platform.OS === 'web') {
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', wake);
} else {
  AppState.addEventListener('change', (st) => { if (st === 'active') wake(); });
}
/** Waits `ms`, or less if the connection may be back. */
export function nap(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let off = () => {};
    const done = () => { clearTimeout(timer); off(); resolve(); };
    const timer = setTimeout(done, ms);
    off = onWake(() => setTimeout(done, 300));
  });
}
/** False when the browser knows it's offline; the phone app can't tell without trying. */
export const looksOnline = () => Platform.OS !== 'web' || typeof navigator === 'undefined' || navigator.onLine !== false;

/* ---------- What's waiting for the connection right now ---------- */
const waiting = new Set<string>();
const subs = new Set<() => void>();
/** Marks one upload or step as waiting for the connection (or not any more). */
export function setWaiting(key: string, on: boolean) {
  if (on === waiting.has(key)) return;
  if (on) waiting.add(key); else waiting.delete(key);
  subs.forEach((f) => f());
}
/** How many uploads or steps outside the outbox are waiting for the connection (a photo in a form, its reading). */
const subWaiting = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const waitingSize = () => waiting.size;
export function useWaitingCount() {
  return useSyncExternalStore(subWaiting, waitingSize, waitingSize);
}

let seq = 0;
/**
 * Runs `fn` until it goes through: without a connection it waits (2 s, 4 s, ... then every 30 s) and tries again,
 * for as long as it takes; a slow or busy server is tried `flaky` times. Any other error is thrown at once. Only for
 * steps that are safe to repeat (an upload, a reading, or a server step that answers a repeat with success).
 */
export async function retrying<T>(fn: () => Promise<T>, o: { flaky?: number; onWait?: (on: boolean) => void } = {}): Promise<T> {
  const key = `r${++seq}`;
  let n = 0, flaky = 0;
  try {
    for (;;) {
      try {
        const out = await fn();
        return out;
      } catch (e) {
        const kind = netKind(e);
        if (!kind || (kind === 'flaky' && ++flaky >= (o.flaky ?? 3))) throw e;
        setWaiting(key, true);
        o.onWait?.(true);
        await nap(Math.min(30_000, 2000 * 2 ** n++));
      }
    }
  } finally {
    setWaiting(key, false);
    o.onWait?.(false);
  }
}
