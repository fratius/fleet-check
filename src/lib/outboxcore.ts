/**
 * Uploads that wait on the phone until they get through (the "outbox"): the walk-around photos and the videos,
 * with what they're for (a pick-up, a drop-off, a handover's missing proof, a walk-around). Saved on the phone as
 * soon as the person taps the button, so nothing has to be done again when the connection drops, the app is
 * closed or the phone restarts. Each one goes through three steps, each done once: the files to storage, the
 * walk-around record (photos only), then the server step (the pick-up or drop-off). A step that fails because
 * there's no connection is tried again by itself; one the server refuses stops and says why.
 *
 * This file is the logic only, without Firebase or the phone's storage (those are `Ops`, see outbox.ts), so it can
 * be tested in Node (tests/outbox.test.mjs). No imports on purpose.
 */

export type HandoverKind = 'pickup' | 'dropoff';
/** The server step after the upload. */
export type Then =
  | { fn: 'pickUpVan' | 'dropOffVan' }
  | { fn: 'addHandoverPhotos' | 'addHandoverVideo'; assignmentId: string; kind: HandoverKind }
  | { fn: 'addVanVideo' };

/** One file waiting to go to storage. `key` finds it on the phone; `tried` = an upload was started (maybe finished). */
export interface OutFile { key: string; path: string; mime: string; size: number | null; done?: boolean; tried?: boolean }

export interface Job {
  /** The walk-around's or the video's id. */
  id: string;
  type: 'walk' | 'video';
  /** What it's for: the photos or video of a pick-up or drop-off, or a walk-around. */
  what: 'pickup' | 'dropoff' | 'walkaround';
  orgId: string;
  uid: string;
  vehicleId: string;
  vehicleName: string;
  /** For proof added to a handover afterwards (a van a manager gave the driver, a missing drop-off). */
  assignmentId: string | null;
  then: Then | null;
  createdAt: number;
  files: OutFile[];
  /** The walk-around record, written once its photos are up. */
  walk?: Record<string, unknown> | null;
  walkTried?: boolean;
  walkSaved?: boolean;
  serverTried?: boolean;
  serverDone?: boolean;
  /** Shown on the van's page when it's done. */
  doneText?: string | null;
  status: 'queued' | 'failed';
  /** Why it stopped (in the person's language). */
  error?: string | null;
}

/** What's happening right now (not saved). */
export interface Live { sent: number; total: number; step: 'upload' | 'save' | 'server' | null; waiting: boolean }

/** No connection (try again whenever), the server was slow or busy (a few times), or anything else (stop). */
export type ErrKind = 'offline' | 'flaky' | null;

export interface Ops {
  /** Puts one file in storage. `again`: an earlier try may have finished it already. */
  upload(job: Job, f: OutFile, again: boolean, onBytes: (sent: number) => void, onStall: (stalled: boolean) => void): Promise<void>;
  /** Writes the walk-around record. `again`: an earlier try may have written it. */
  saveWalk(job: Job, again: boolean, onStall: (stalled: boolean) => void): Promise<void>;
  /** The pick-up, drop-off or handover step. The server answers a repeat of a step that went through with success. */
  server(job: Job): Promise<void>;
  /** After it all went through: the video's playback copy, the message on the van's page. */
  after?(job: Job): void;
  /** Saves the list (the jobs, not the files). */
  persist(jobs: Job[]): Promise<void>;
  /** Deletes a job's files from the phone. */
  dropFiles(job: Job): Promise<void>;
  errKind(e: unknown): ErrKind;
  message(e: unknown): string;
  /** Waits, or less when the connection may be back. */
  nap(ms: number): Promise<void>;
}

/** How long to wait before trying again: 2, 4, 8, 16, then every 30 seconds. */
export const backoff = (n: number) => Math.min(30_000, 2000 * 2 ** Math.max(0, n));
/** A slow or busy server is tried this many times, then the job stops with its reason (it can be tried again). */
export const FLAKY_TRIES = 5;

class Stopped extends Error { constructor() { super('stopped'); } }

export class Outbox {
  jobs: Job[] = [];
  live = new Map<string, Live>();
  /** Jobs that went through in this session (so a screen waiting for one knows). */
  done = new Set<string>();
  private subs = new Set<() => void>();
  private running = false;
  private again = false;
  private uid: string | null = null;
  private stopped = new Set<string>();
  version = 0;
  private ops: Ops;

  constructor(ops: Ops) { this.ops = ops; }

  subscribe(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private emit() { this.version++; this.subs.forEach((f) => f()); }
  private save() { return this.ops.persist(this.jobs.map((j) => ({ ...j, files: j.files.map((f) => ({ ...f })) }))).catch(() => {}); }

  /** The saved list, read when the app starts. */
  load(jobs: Job[]) {
    const have = new Set(this.jobs.map((j) => j.id));
    for (const j of jobs) if (j && j.id && !have.has(j.id)) this.jobs.push(j);
    this.emit();
  }

  /** Adds a job (its files are already kept on the phone) and starts it. */
  async add(job: Job) {
    this.jobs.push(job);
    this.emit();
    await this.save();
    this.kick();
  }

  /** A job that stopped: try it again. */
  retry(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || j.status !== 'failed') return;
    j.status = 'queued';
    j.error = null;
    this.emit();
    this.save();
    this.kick();
  }

  /** Removes a job and its files (a stopped one, or one the person doesn't want any more). */
  async remove(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    this.stopped.add(id);
    this.jobs = this.jobs.filter((x) => x !== j);
    this.live.delete(id);
    this.emit();
    await this.save();
    await this.ops.dropFiles(j).catch(() => {});
  }

  /** Removes everything of one person (their account was deleted). */
  async forget(uid: string) {
    for (const j of this.jobs.filter((x) => x.uid === uid)) await this.remove(j.id);
  }

  /** Runs the jobs of this person (null: nobody signed in, nothing runs). */
  start(uid: string | null) {
    this.uid = uid;
    this.kick();
  }

  /** Works through the waiting jobs, oldest first, one at a time (a drop-off before the next pick-up). */
  kick() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    (async () => {
      try {
        do {
          this.again = false;
          for (;;) {
            const uid = this.uid;
            const j = uid ? this.jobs.find((x) => x.status === 'queued' && x.uid === uid) : undefined;
            if (!j) break;
            await this.run(j);
          }
        } while (this.again);
      } finally { this.running = false; }
    })();
  }

  private liveOf(j: Job): Live {
    let l = this.live.get(j.id);
    if (!l) { l = { sent: 0, total: 0, step: null, waiting: false }; this.live.set(j.id, l); }
    return l;
  }

  /** Runs a step until it goes through: without a connection it waits and tries again, as long as it takes. */
  private async attempt<T>(j: Job, fn: () => Promise<T>): Promise<T> {
    const l = this.liveOf(j);
    let n = 0, flaky = 0;
    for (;;) {
      if (this.stopped.has(j.id) || j.uid !== this.uid) throw new Stopped();
      try {
        const out = await fn();
        if (l.waiting) { l.waiting = false; this.emit(); }
        return out;
      } catch (e) {
        if (e instanceof Stopped) throw e;
        const kind = this.ops.errKind(e);
        if (!kind || (kind === 'flaky' && ++flaky >= FLAKY_TRIES)) throw e;
        if (!l.waiting) { l.waiting = true; this.emit(); }
        await this.ops.nap(backoff(n++));
      }
    }
  }

  private async run(j: Job) {
    const l = this.liveOf(j);
    try {
      // 1. The files, three at a time.
      const sizes = (f: OutFile) => f.size || 1;
      l.total = j.files.reduce((n, f) => n + sizes(f), 0);
      l.sent = j.files.filter((f) => f.done).reduce((n, f) => n + sizes(f), 0);
      l.step = 'upload';
      this.emit();
      const todo = j.files.filter((f) => !f.done);
      const moving = new Map<OutFile, number>();
      const stalls = new Set<OutFile>();
      let failed: unknown = null;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, todo.length) }, async () => {
        while (next < todo.length && !failed) {
          const f = todo[next++];
          try {
            await this.attempt(j, async () => {
              const again = !!f.tried;
              if (!f.tried) { f.tried = true; await this.save(); }
              await this.ops.upload(j, f, again, (sent) => {
                moving.set(f, Math.min(sent, sizes(f)));
                l.sent = j.files.filter((x) => x.done).reduce((n, x) => n + sizes(x), 0) + [...moving.values()].reduce((a, b) => a + b, 0);
                if (stalls.delete(f) && !stalls.size) l.waiting = false;
                this.emit();
              }, (stalled) => {
                if (stalled) stalls.add(f); else stalls.delete(f);
                const w = stalls.size > 0;
                if (w !== l.waiting) { l.waiting = w; this.emit(); }
              });
            });
            stalls.delete(f);
            moving.delete(f);
            f.done = true;
            l.sent = j.files.filter((x) => x.done).reduce((n, x) => n + sizes(x), 0) + [...moving.values()].reduce((a, b) => a + b, 0);
            await this.save();
            this.emit();
          } catch (e) { failed = failed || e; }
        }
      }));
      if (failed) throw failed;

      // 2. The walk-around record.
      if (j.type === 'walk' && !j.walkSaved) {
        l.step = 'save'; this.emit();
        await this.attempt(j, async () => {
          const again = !!j.walkTried;
          if (!j.walkTried) { j.walkTried = true; await this.save(); }
          await this.ops.saveWalk(j, again, (stalled) => { if (stalled !== l.waiting) { l.waiting = stalled; this.emit(); } });
        });
        j.walkSaved = true;
        await this.save();
      }

      // 3. The pick-up, drop-off or handover.
      if (j.then && !j.serverDone) {
        l.step = 'server'; this.emit();
        await this.attempt(j, async () => {
          if (!j.serverTried) { j.serverTried = true; await this.save(); }
          await this.ops.server(j);
        });
        j.serverDone = true;
      }

      // Done: off the list, files deleted.
      this.jobs = this.jobs.filter((x) => x !== j);
      this.live.delete(j.id);
      this.done.add(j.id);
      await this.save();
      this.emit();
      await this.ops.dropFiles(j).catch(() => {});
      try { this.ops.after?.(j); } catch { /* only extras */ }
    } catch (e) {
      if (e instanceof Stopped) { l.waiting = false; this.emit(); return; }
      j.status = 'failed';
      j.error = this.ops.message(e);
      l.waiting = false;
      l.step = null;
      // Files that are up aren't needed on the phone any more.
      if (j.files.every((f) => f.done)) await this.ops.dropFiles(j).catch(() => {});
      await this.save();
      this.emit();
    }
  }
}
