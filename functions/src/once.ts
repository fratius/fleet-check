import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/https';

import { N_, fail } from './i18n';

/**
 * Calls that change something may arrive twice: the phone sends one, the answer gets lost (no or bad connection),
 * and the phone sends it again (src/lib/store.ts and src/lib/outbox.ts in the app). Each call carries an id the
 * phone made (`rid`). The first call with an id does the work and keeps its answer for a week; a repeat gets that
 * answer, and a repeat that arrives while the first one is still running waits for it. A refused call leaves
 * nothing behind, so its repeat is checked again (and refused the same way, or done if things changed).
 * Ids belong to the person (users/{uid}/requests/{rid}, server-only), so nobody can read or block someone else's.
 */

const RID = /^[A-Za-z0-9_-]{8,64}$/;
/**
 * From the function's time limit: a first call still "running" after the limit and a margin has died (the repeat
 * does it), and a repeat waits for the first one well within its own limit (then says "still working", and the
 * phone asks again a little later).
 */
export const timing = (timeoutSeconds = 60) => ({ staleMs: (timeoutSeconds + 30) * 1000, waitMs: Math.max(5, timeoutSeconds - 15) * 1000 });
/** Answers are kept this long (the daily clean-up deletes older ones). */
export const KEEP_MS = 7 * 86_400_000;

const db = () => getFirestore();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Like onCall, but a repeat of the same call (same person, same `rid`) is answered with the first call's answer. */
export function onCallOnce<T>(name: string, opts: CallableOptions, handler: (req: CallableRequest) => Promise<T>) {
  return onCall(opts, async (req) => {
    const rid = (req.data as { rid?: unknown } | null)?.rid;
    const uid = req.auth?.uid;
    if (rid == null || rid === '' || !uid) return handler(req);
    if (typeof rid !== 'string' || !RID.test(rid)) throw fail('invalid-argument', 'Unknown request.');
    return once(uid, name, rid, () => handler(req), timing(typeof opts.timeoutSeconds === 'number' ? opts.timeoutSeconds : undefined));
  });
}

export async function once<T>(uid: string, name: string, rid: string, run: () => Promise<T>, { staleMs, waitMs } = timing()): Promise<T> {
  const ref = db().doc(`users/${uid}/requests/${rid}`);
  const t0 = Date.now();
  for (;;) {
    const got = await db().runTransaction(async (tx) => {
      const d = await tx.get(ref);
      const now = Date.now();
      if (!d.exists) { tx.create(ref, { fn: name, state: 'running', at: now, until: now + KEEP_MS }); return { go: true as const }; }
      const x = d.data() as { fn: string; state: 'running' | 'done'; at: number; result?: unknown };
      if (x.fn !== name) throw fail('invalid-argument', 'Unknown request.');
      if (x.state === 'done') return { done: true as const, result: x.result };
      if (now - x.at > staleMs) { tx.update(ref, { at: now }); return { go: true as const }; }
      return { wait: true as const };
    });
    if ('done' in got) return got.result as T;
    if ('go' in got) break;
    // `wait`: the phone keeps asking (as without a connection), it's not an error to show.
    if (Date.now() - t0 > waitMs) throw fail('unavailable', N_('Still working on it. It goes through by itself.'), { wait: 1 });
    await sleep(1500);
  }
  let out: T;
  try {
    out = await run();
  } catch (e) {
    // Refused or failed: nothing kept, so the next try is checked again.
    await ref.delete().catch(() => {});
    throw e;
  }
  // Firestore keeps JSON-like values only (no undefined).
  const result = out === undefined ? null : JSON.parse(JSON.stringify(out));
  await ref.set({ fn: name, state: 'done', at: Date.now(), until: Date.now() + KEEP_MS, result }).catch(() => {});
  return out;
}

/** The daily clean-up: answers older than a week. */
export async function cleanRequests(now = Date.now(), store: Firestore = db()) {
  let n = 0;
  for (;;) {
    const old = await store.collectionGroup('requests').where('until', '<', now).limit(400).get();
    if (old.empty) return n;
    const b = store.batch();
    old.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    n += old.size;
    if (old.size < 400) return n;
  }
}
