/** The Android test version's "new version" question is for the Android app only (apk.ts). */
export const APK_PAGE = 'https://fratius.com/android';
export const isApk = () => false;
export const nativeVersion = (): string | null => null;
export function compareVersions(a: string, b: string) {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0), y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}
export function useNewerApk(): string | null { return null; }
export function apkLater() {}
export function openApkPage() {}
