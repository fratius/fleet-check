import { useEffect, useState } from 'react';

/**
 * One-time messages for the page you go back to, for example "You picked up eSprinter 02" after the camera
 * closes. The page reads and clears its message once.
 */
const msgs = new Map<string, string>();
const subs = new Set<() => void>();

export function flash(key: string, text: string) {
  msgs.set(key, text);
  subs.forEach((f) => f());
}

export function useFlash(key: string): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const take = () => {
      const t = msgs.get(key);
      if (t) { msgs.delete(key); setText(t); }
    };
    subs.add(take);
    take();
    return () => { subs.delete(take); };
  }, [key]);
  return text;
}
