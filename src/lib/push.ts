import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { fb } from './firebase';
import { t } from './i18n';
import { device } from './install';

/**
 * Phone notifications through the browser (web push). They work in the web app: on Android in Chrome, on iPhone
 * only once the app is on the home screen (iOS 16.4 or later). Not in Expo Go. Each phone where the person turned
 * them on is one users/{uid}/push record; the server sends to those (notify in the functions).
 */
export type PushState = 'native' | 'install' | 'unsupported' | 'blocked' | 'off' | 'on';

const supported = () => Platform.OS === 'web' && typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function pushState(): Promise<PushState> {
  if (Platform.OS !== 'web') return 'native';
  if (!supported()) return device() === 'ios' ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

const b64 = (s: string) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};
async function idOf(endpoint: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return Array.from(h.slice(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
}
function deviceName() {
  const ua = navigator.userAgent || '';
  const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'Browser';
  return device() === 'installed' ? `${what}, app on the home screen` : what;
}
async function save(uid: string, sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error(t('This browser gave no notification address.'));
  await setDoc(doc(fb()!.db, 'users', uid, 'push', await idOf(j.endpoint)), {
    endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, createdAt: Date.now(), device: deviceName(),
  });
}

/** Asks for permission (call it straight from a tap) and turns notifications on for this phone. */
export async function enablePush(uid: string): Promise<PushState> {
  if (!supported()) return pushState();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const [reg, cfg] = await Promise.all([registration(), getDoc(doc(fb()!.db, 'config', 'push'))]);
  const key = (cfg.data() as { vapidPublicKey?: string } | undefined)?.vapidPublicKey;
  if (!key) throw new Error(t('Notifications aren\'t set up on the server yet. Try again after the next update.'));
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key can't receive our notifications: make a new one.
  const own = sub?.options?.applicationServerKey;
  if (sub && own && btoa(String.fromCharCode(...new Uint8Array(own))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await save(uid, sub);
  return 'on';
}

/** Turns notifications off for this phone (for this person). */
export async function disablePush(uid: string) {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await deleteDoc(doc(fb()!.db, 'users', uid, 'push', await idOf(sub.endpoint))).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** On start: if this phone has notifications on, make sure they reach the person signed in now. */
export async function refreshPush(uid: string) {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await save(uid, sub);
  } catch { /* best effort */ }
}

/** On sign-out: stop sending this person's notifications to this phone. */
export async function forgetPush(uid: string) {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await deleteDoc(doc(fb()!.db, 'users', uid, 'push', await idOf(sub.endpoint)));
  } catch { /* best effort */ }
}
