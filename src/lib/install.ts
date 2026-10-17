import { Platform } from 'react-native';

/**
 * Installing the web app on a phone's home screen. Chrome on Android offers an install prompt we can trigger;
 * Safari on iPhone needs the person to tap Share > Add to Home Screen.
 */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()); });
}

export function onInstallChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
export const canPromptInstall = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const r = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
  deferred = null;
  return r.outcome === 'accepted';
}

export type Device = 'native' | 'installed' | 'ios' | 'android' | 'desktop';
export function device(): Device {
  if (Platform.OS !== 'web') return 'native';
  if (typeof window === 'undefined') return 'desktop';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (standalone) return 'installed';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}
