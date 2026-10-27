/** The web app gets notifications through the browser (push.ts); these are for the store app only (nativepush.ts). */
export const nativePush = () => false;
export async function nativeState(_uid?: string): Promise<'on' | 'off' | 'blocked'> { return 'off'; }
export async function enableNative(_uid: string): Promise<'on' | 'off' | 'blocked'> { return 'off'; }
export async function disableNative(_uid: string) {}
export async function refreshNative(_uid: string) {}
export async function forgetNative(_uid: string) {}
export function NotificationTaps() { return null; }
