import { useEffect, useRef, useState } from 'react';

/**
 * One-time messages for the page you go back to, for example "You picked up eSprinter 02" after the camera
 * closes. The page reads and clears its message once.
 *
 * A message can carry a tag for what it is about (a handover, a change waiting on the phone). The page says whether
 * that is still so; once it isn't, the message goes, so "Ali has QUEST 4 now" doesn't stay after the van was retired,
 * moved or given to someone else (blind test, 26 Nov 2026, cause 3b).
 */
type Msg = { text: string; tag?: string; at: number };
const msgs = new Map<string, Msg>();
const subs = new Set<() => void>();
/** How long a tagged message shows before the page's data first agrees with it (the data can be a moment behind). */
const LAG = 10_000;

export function flash(key: string, text: string, tag?: string) {
  msgs.set(key, { text, tag, at: Date.now() });
  subs.forEach((f) => f());
}

/**
 * `holds(tag, at)`: whether what a tagged message (shown since `at`) says is still so: true, false (it isn't any more,
 * for example the van was retired or a change to it was made since: the message goes at once), or null (the page
 * can't tell: until it first agreed, the message shows for a moment; after that, it goes). Untagged messages stay as
 * long as the page.
 */
export function useFlash(key: string, holds?: (tag: string, at: number) => boolean | null): string | null {
  const [m, setM] = useState<Msg | null>(null);
  // Whether the page's data agreed with the message once: after that, the first time it doesn't, the message goes.
  const seen = useRef(false);
  const gone = useRef(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const take = () => {
      const x = msgs.get(key);
      if (x) { msgs.delete(key); seen.current = false; gone.current = false; setM(x); }
    };
    subs.add(take);
    take();
    return () => { subs.delete(take); };
  }, [key]);
  // Looked at again when the wait for the data is over.
  useEffect(() => {
    if (!m?.tag) return;
    const id = setTimeout(() => setTick((n) => n + 1), Math.max(0, LAG - (Date.now() - m.at)) + 50);
    return () => clearTimeout(id);
  }, [m]);
  if (!m) return null;
  if (!m.tag || !holds) return m.text;
  if (gone.current) return null;
  const r = holds(m.tag, m.at);
  if (r === true) { seen.current = true; return m.text; }
  if (r === false || seen.current || Date.now() - m.at >= LAG) { gone.current = true; return null; }
  return m.text;
}
