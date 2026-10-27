import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { fb } from './firebase';

/**
 * Phone notifications in the App Store and Google Play app, through Expo's push service (which sends to Apple and
 * to Firebase Cloud Messaging). Each phone where the person turned them on is one users/{uid}/push record with its
 * Expo push token; the server sends to those as well as to the web app's (notify in the functions). Not in Expo Go,
 * which can't receive another app's notifications. The web build uses nativepush.web.ts instead.
 */
type N = typeof import('expo-notifications');
let mod: N | null | undefined;
function notifications(): N | null {
  if (mod === undefined) {
    // Expo Go warns as soon as the module is loaded, so it's only loaded in the store app.
    mod = Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : (require('expo-notifications') as N);
  }
  return mod;
}
/** Can this app get phone notifications by itself (the store app, not Expo Go)? */
export const nativePush = () => !!notifications();

const KEY = 'fc.nativePush';
interface Saved { token: string; uid: string | null }
const read = async (): Promise<Saved | null> => { try { return JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch { return null; } };
const write = (s: Saved | null) => (s ? AsyncStorage.setItem(KEY, JSON.stringify(s)) : AsyncStorage.removeItem(KEY)).catch(() => {});
const idOf = (token: string) => `expo-${token.replace(/[^A-Za-z0-9]/g, '').slice(-48)}`;

function deviceName() {
  const model = Constants.deviceName || '';
  return `${Platform.OS === 'ios' ? 'iPhone' : 'Android phone'}, Fratius app${model ? ` (${model.slice(0, 40)})` : ''}`;
}

/** Android 13 and later only ask for permission once the app has a notification channel. */
async function channel(n: N) {
  if (Platform.OS === 'android') {
    await n.setNotificationChannelAsync('default', { name: 'Fratius', importance: n.AndroidImportance.HIGH }).catch(() => {});
  }
}
async function token(n: N): Promise<string> {
  await channel(n);
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return (await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
}
async function save(uid: string, t: string) {
  await setDoc(doc(fb()!.db, 'users', uid, 'push', idOf(t)), { expo: t, platform: Platform.OS, createdAt: Date.now(), device: deviceName() });
  await write({ token: t, uid });
}

export async function nativeState(uid?: string): Promise<'on' | 'off' | 'blocked'> {
  const n = notifications();
  if (!n) return 'off';
  const p = await n.getPermissionsAsync();
  if (p.status !== 'granted') return p.canAskAgain === false ? 'blocked' : 'off';
  const s = await read();
  return s && s.uid && s.uid === uid ? 'on' : 'off';
}

/** Asks for permission (from a tap) and sends this person's notifications to this phone. */
export async function enableNative(uid: string): Promise<'on' | 'off' | 'blocked'> {
  const n = notifications();
  if (!n) return 'off';
  await channel(n);
  let p = await n.getPermissionsAsync();
  if (p.status !== 'granted') p = await n.requestPermissionsAsync();
  if (p.status !== 'granted') return p.canAskAgain === false ? 'blocked' : 'off';
  await save(uid, await token(n));
  return 'on';
}

/** Stops this person's notifications on this phone. */
export async function disableNative(uid: string) {
  const s = await read();
  if (s) await deleteDoc(doc(fb()!.db, 'users', uid, 'push', idOf(s.token))).catch(() => {});
  await write(null);
}

/** On start: if this phone has notifications on, they go to whoever is signed in now (the token can change). */
export async function refreshNative(uid: string) {
  try {
    const n = notifications();
    const s = await read();
    if (!n || !s) return;
    if ((await n.getPermissionsAsync()).status !== 'granted') return;
    const t = await token(n);
    if (s.uid && s.uid === uid && t !== s.token) await deleteDoc(doc(fb()!.db, 'users', uid, 'push', idOf(s.token))).catch(() => {});
    await save(uid, t);
  } catch { /* best effort */ }
}

/** On sign-out: this phone stops getting this person's notifications (it remembers it had them on). */
export async function forgetNative(uid: string) {
  try {
    const s = await read();
    if (!s) return;
    await deleteDoc(doc(fb()!.db, 'users', uid, 'push', idOf(s.token)));
    await write({ token: s.token, uid: null });
  } catch { /* best effort */ }
}

/** Shows notifications while the app is open, and opens the page a tapped notification points to. */
export function NotificationTaps() {
  useEffect(() => {
    const n = notifications();
    if (!n) return;
    n.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const open = (r: { notification: { request: { content: { data?: Record<string, unknown> | null } } } } | null) => {
      const url = r?.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) setTimeout(() => router.push(url as never), 50);
    };
    n.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = n.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return null;
}
