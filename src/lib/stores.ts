/**
 * Where people get the phone app. Keep in step with the website (`CONFIG.stores` in website/index.html) and the
 * driver's welcome email (functions/src/joinmail.ts): once Fratius is in Google Play, set GOOGLE_PLAY in all three.
 */
export const APP_STORE = 'https://apps.apple.com/app/id6829174647';
export const GOOGLE_PLAY: string | null = null;
/** The Android test version on fratius.com, until the app is in Google Play (store/README.md). */
export const ANDROID_TEST = 'https://fratius.com/android';
export const androidUrl = () => GOOGLE_PLAY || ANDROID_TEST;

export type AppTarget = 'ios' | 'android' | 'both' | 'none';
/** Which app a web page offers: the phone's own store, both on a computer (the screens show none inside the app). */
export function appTarget(ua: string | null = typeof navigator !== 'undefined' ? navigator.userAgent : null, touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0): AppTarget {
  if (ua == null) return 'none';
  const u = ua;
  if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && touch > 1)) return 'ios';
  if (/Android/.test(u)) return 'android';
  return 'both';
}
