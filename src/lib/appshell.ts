import { Platform } from 'react-native';

/**
 * The web app opens without a connection: its service worker (public/sw.js) keeps the app's own files. Registered
 * at start (the same worker shows notifications); then the page tells it which files it loaded, so the first visit
 * is kept too.
 */
export function keepAppShell() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // Not while developing (the dev server's files change all the time).
  if (__DEV__) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).then((reg) => {
    const urls = [location.origin + '/', ...performance.getEntriesByType('resource').map((r) => r.name)]
      .filter((u) => u.startsWith(location.origin));
    reg.active?.postMessage({ type: 'keep', urls });
  }).catch(() => {});
}
