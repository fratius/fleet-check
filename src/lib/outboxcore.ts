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

/** A change sent to the server: a call (with its request id inside `data.rid`) or a record written directly. */
export type Change =
  | { kind: 'call'; fn: string; data: Record<string, unknown> }
  | { kind: 'write'; op: 'set' | 'update' | 'delete'; path: string[]; data?: Record<string, unknown> | null; merge?: boolean };

export interface Job {
  /** The walk-around's or the video's id (a change: its own id). */
  id: string;
  type: 'walk' | 'video' | 'change';
  /** What it's for: the photos or video of a pick-up or drop-off, a walk-around, or a change. */
  what: 'pickup' | 'dropoff' | 'walkaround' | 'change';
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
  /** A change: what to send, and what it is in the person's words (when it was made). */
  change?: Change;
  title?: string;
  /** The person it's about (shown on their page). */
  personId?: string | null;
  /** The request id of the server step of a walk-around or video (functions/src/once.ts). */
  rid?: string;
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
  /** The pick-up, drop-off or handover step, or a change. The server answers a repeat of a step that went through with success. */
  server(job: Job, onStall: (stalled: boolean) => void): Promise<unknown>;
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
  /** Jobs this outbox finished or removed (another tab's copy of the list may still have them). */
  forgotten = new Set<string>();
  /** What the server answered to jobs that went through in this session. */
  results = new Map<string, unknown>();
  private subs = new Set<() => void>();
  private lanes = { media: false, change: false };
  private again = { media: false, change: false };
  /** Is anything being sent right now? */
  get running() { return this.lanes.media || this.lanes.change; }
  private uid: string | null = null;
  private stopped = new Set<string>();
  version = 0;
  private ops: Ops;

  constructor(ops: Ops) { this.ops = ops; }

  subscribe(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private emit() { this.version++; this.subs.forEach((f) => f()); }
  private save() { return this.ops.persist(this.jobs.map((j) => ({ ...j, files: j.files.map((f) => ({ ...f })) }))).catch(() => {}); }

  /** The saved list, read when the app starts (or added by another tab of the web app). */
  load(jobs: Job[]) {
    const have = new Set(this.jobs.map((j) => j.id));
    for (const j of jobs) if (j && j.id && !have.has(j.id) && !this.forgotten.has(j.id)) this.jobs.push(j);
    this.emit();
  }

  /** Shows the list as another tab saved it (a tab that doesn't run the jobs itself). */
  replace(jobs: Job[]) {
    if (this.running) return;
    this.jobs = jobs.filter((j) => j && j.id && !this.forgotten.has(j.id));
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
    this.forgotten.add(id);
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

  /**
   * Works through the waiting jobs, oldest first, one at a time per lane: photos and videos in one (a drop-off
   * before the next pick-up), changes in the other, so a change doesn't wait for someone's video to upload. A change
   * about a van waits for that van's photos or video sent before it (a check done after the pick-up).
   */
  kick() {
    this.runLane('media');
    this.runLane('change');
  }
  private laneOf(j: Job): 'media' | 'change' { return j.type === 'change' ? 'change' : 'media'; }
  /**
   * The next job of a lane, oldest first. A change about a van waits while that van's photos or video sent before it
   * are still going up; later changes about the same van or person wait behind it (their order stays), others go.
   */
  private next(lane: 'media' | 'change', uid: string): Job | undefined {
    const heldVans = new Set<string>(), heldPeople = new Set<string>();
    for (let i = 0; i < this.jobs.length; i++) {
      const j = this.jobs[i];
      if (j.status !== 'queued' || j.uid !== uid || this.laneOf(j) !== lane) continue;
      if (lane === 'change') {
        const waits = (j.vehicleId && (heldVans.has(j.vehicleId)
          || this.jobs.slice(0, i).some((x) => x.status === 'queued' && x.uid === uid && x.type !== 'change' && x.vehicleId === j.vehicleId)))
          || (j.personId && heldPeople.has(j.personId));
        if (waits) {
          if (j.vehicleId) heldVans.add(j.vehicleId);
          if (j.personId) heldPeople.add(j.personId);
          continue;
        }
      }
      return j;
    }
    return undefined;
  }
  private runLane(lane: 'media' | 'change') {
    if (this.lanes[lane]) { this.again[lane] = true; return; }
    this.lanes[lane] = true;
    (async () => {
      try {
        do {
          this.again[lane] = false;
          for (;;) {
            const uid = this.uid;
            const j = uid ? this.next(lane, uid) : undefined;
            if (!j) break;
            await this.run(j);
            // Its van's change may have been waiting for it.
            if (lane === 'media') this.runLane('change');
          }
        } while (this.again[lane]);
      } finally { this.lanes[lane] = false; }
    })();
  }

  /** A change already reached the server outside the runner (a record write Firestore sent): not sent again. */
  async sent(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || j.serverDone) return;
    j.serverDone = true;
    await this.save();
    this.kick();
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

      // 3. The pick-up, drop-off or handover, or the change itself.
      if ((j.then || j.change) && !j.serverDone) {
        l.step = 'server'; this.emit();
        const out = await this.attempt(j, async () => {
          // Reached the server meanwhile by another way (a record write Firestore sent itself): done.
          if (j.serverDone) return this.results.get(j.id) ?? null;
          if (!j.serverTried) { j.serverTried = true; await this.save(); }
          return this.ops.server(j, (stalled) => { if (stalled !== l.waiting) { l.waiting = stalled; this.emit(); } });
        });
        this.results.set(j.id, out);
        j.serverDone = true;
      }

      // Done: off the list, files deleted.
      this.jobs = this.jobs.filter((x) => x !== j);
      this.live.delete(j.id);
      this.done.add(j.id);
      this.forgotten.add(j.id);
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
