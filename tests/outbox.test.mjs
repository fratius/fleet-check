// The outbox's logic (src/lib/outboxcore.ts): uploads that wait on the phone and try again by themselves.
// Run: node --test tests/outbox.test.mjs (Node 22 runs the TypeScript file as it is).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FLAKY_TRIES, Outbox } from '../src/lib/outboxcore.ts';

const offline = () => Object.assign(new Error('Network request failed'), { kind: 'offline' });
const flaky = () => Object.assign(new Error('deadline-exceeded'), { kind: 'flaky' });
const refused = (m) => Object.assign(new Error(m), { kind: null });

/** Fake storage, Firestore and server: `plan` says which calls fail how. */
function world(plan = {}) {
  const w = {
    stored: new Set(), walks: new Set(), server: [], persisted: [], dropped: [], after: [], naps: 0, uploads: [], saves: [],
    fail: { upload: [...(plan.upload || [])], save: [...(plan.save || [])], server: [...(plan.server || [])] },
  };
  w.ops = {
    async upload(j, f, again, onBytes) {
      w.uploads.push({ path: f.path, again });
      const e = w.fail.upload.shift();
      if (e) throw e();
      onBytes(f.size || 1);
      w.stored.add(f.path);
    },
    async saveWalk(j, again) {
      w.saves.push({ id: j.id, again });
      const e = w.fail.save.shift();
      if (e) throw e();
      w.walks.add(j.id);
    },
    async server(j) {
      const e = w.fail.server.shift();
      if (e) throw e();
      w.server.push(`${j.then.fn}:${j.id}`);
    },
    after(j) { w.after.push(j.id); },
    async persist(jobs) { w.persisted.push(JSON.parse(JSON.stringify(jobs))); },
    async dropFiles(j) { w.dropped.push(j.id); },
    errKind: (e) => e.kind ?? null,
    message: (e) => e.message,
    async nap() { w.naps++; await new Promise((r) => setTimeout(r, 1)); },
  };
  return w;
}

const walkJob = (id, over = {}) => ({
  id, type: 'walk', what: 'pickup', orgId: 'o1', uid: 'u1', vehicleId: 'v1', vehicleName: 'Van 1', assignmentId: null,
  then: { fn: 'pickUpVan' }, createdAt: 1, status: 'queued', walk: { vehicleId: 'v1', photos: [] },
  files: [1, 2, 3, 4].map((n) => ({ key: `${id}/0${n}.jpg`, path: `orgs/o1/walkarounds/${id}/0${n}.jpg`, mime: 'image/jpeg', size: 100 })),
  ...over,
});

/** Waits until the outbox has nothing running. */
async function settle(ob, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 5));
    if (!ob.running && ![...ob.live.values()].some((l) => l.step && l.waiting)) {
      await new Promise((r) => setTimeout(r, 20));
      if (!ob.running) return;
    }
  }
}

test('uploads the photos, writes the walk-around, then picks up the van, and forgets the job', async () => {
  const w = world();
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(walkJob('w1'));
  await settle(ob);
  assert.equal(w.stored.size, 4);
  assert.ok(w.walks.has('w1'));
  assert.deepEqual(w.server, ['pickUpVan:w1']);
  assert.equal(ob.jobs.length, 0);
  assert.ok(ob.done.has('w1'));
  assert.deepEqual(w.dropped, ['w1']);
  assert.deepEqual(w.after, ['w1']);
  assert.deepEqual(w.persisted.at(-1), []);
});

test('no connection: waits and tries again by itself, nothing is asked again', async () => {
  const w = world({ upload: [offline, offline, offline], save: [offline], server: [offline, offline] });
  const ob = new Outbox(w.ops);
  const seen = [];
  ob.subscribe(() => { const l = ob.live.get('w2'); if (l) seen.push(l.waiting); });
  ob.start('u1');
  await ob.add(walkJob('w2'));
  await settle(ob);
  assert.equal(w.stored.size, 4);
  assert.deepEqual(w.server, ['pickUpVan:w2']);
  assert.ok(w.naps >= 6);
  assert.ok(seen.includes(true), 'it said it was waiting for the connection');
  assert.equal(ob.jobs.length, 0);
});

test('after the app was closed half way: only what is missing is done again, carefully', async () => {
  // Saved on the phone: two photos up, a third started, the walk-around write started.
  const saved = walkJob('w3');
  saved.files[0].done = true; saved.files[0].tried = true;
  saved.files[1].done = true; saved.files[1].tried = true;
  saved.files[2].tried = true;
  saved.walkTried = false;
  const w = world();
  const ob = new Outbox(w.ops);
  ob.load([saved]);
  ob.start('u1');
  await settle(ob);
  assert.deepEqual(w.uploads, [{ path: saved.files[2].path, again: true }, { path: saved.files[3].path, again: false }]);
  assert.deepEqual(w.server, ['pickUpVan:w3']);

  const s2 = walkJob('w4');
  s2.files.forEach((f) => { f.done = true; f.tried = true; });
  s2.walkTried = true;
  const w2 = world();
  const ob2 = new Outbox(w2.ops);
  ob2.load([s2]);
  ob2.start('u1');
  await settle(ob2);
  assert.deepEqual(w2.uploads, []);
  assert.deepEqual(w2.saves, [{ id: 'w4', again: true }]);
  assert.deepEqual(w2.server, ['pickUpVan:w4']);
});

test('the server refuses: it stops with the reason, the photos stay uploaded, and trying again sends only the step', async () => {
  const w = world({ server: [() => refused('Drop off Van 9 first, with its photos or a video.')] });
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(walkJob('w5'));
  await settle(ob);
  const j = ob.jobs.find((x) => x.id === 'w5');
  assert.equal(j.status, 'failed');
  assert.equal(j.error, 'Drop off Van 9 first, with its photos or a video.');
  assert.deepEqual(w.dropped, ['w5'], 'the files are up, so they are deleted from the phone');
  assert.equal(w.uploads.length, 4);
  assert.equal(w.saves.length, 1);
  ob.retry('w5');
  await settle(ob);
  assert.equal(w.uploads.length, 4, 'no upload again');
  assert.equal(w.saves.length, 1, 'no second walk-around');
  assert.deepEqual(w.server, ['pickUpVan:w5']);
  assert.equal(ob.jobs.length, 0);
});

test('a slow server is tried a few times, then it stops (and can be tried again)', async () => {
  const w = world({ server: Array(FLAKY_TRIES).fill(flaky) });
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add({ ...walkJob('v6'), type: 'video', what: 'dropoff', then: { fn: 'dropOffVan' }, walk: null, files: [{ key: 'v6/original.mp4', path: 'orgs/o1/videos/u1/v6/original.mp4', mime: 'video/mp4', size: 1000 }] });
  await settle(ob);
  assert.equal(ob.jobs[0].status, 'failed');
  ob.retry('v6');
  await settle(ob);
  assert.deepEqual(w.server, ['dropOffVan:v6']);
  assert.deepEqual(w.saves, [], 'a video has no walk-around record');
});

test('only the signed-in person\'s jobs run, oldest first (the drop-off before the next pick-up)', async () => {
  const w = world();
  const ob = new Outbox(w.ops);
  ob.load([
    walkJob('a', { what: 'dropoff', then: { fn: 'dropOffVan' }, createdAt: 1 }),
    walkJob('b', { createdAt: 2 }),
    walkJob('c', { uid: 'someone-else', createdAt: 3 }),
  ]);
  ob.start(null);
  await settle(ob);
  assert.deepEqual(w.server, []);
  ob.start('u1');
  await settle(ob);
  assert.deepEqual(w.server, ['dropOffVan:a', 'pickUpVan:b']);
  assert.deepEqual(ob.jobs.map((j) => j.id), ['c']);
});

test('removing a waiting job stops it and deletes its files', async () => {
  const w = world({ upload: Array(100000).fill(offline) });
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(walkJob('w7'));
  await new Promise((r) => setTimeout(r, 30));
  await ob.remove('w7');
  await settle(ob);
  assert.equal(ob.jobs.length, 0);
  assert.ok(w.dropped.includes('w7'));
  assert.deepEqual(w.server, []);
  assert.ok(!ob.done.has('w7'));
});

const changeJob = (id, over = {}) => ({
  id, type: 'change', what: 'change', orgId: 'o1', uid: 'u1', vehicleId: 'v1', vehicleName: 'Van 1', assignmentId: null, then: null,
  createdAt: 1, status: 'queued', files: [], title: 'Give Van 1 to Ali',
  change: { kind: 'call', fn: 'assignVan', data: { orgId: 'o1', vehicleId: 'v1', driverId: 'ali', rid: 'rid-abc12345' } }, ...over,
});

test('a change (giving a van) waits without a connection, is sent once, and its answer is kept for the screen', async () => {
  const w = world({ server: [offline, offline] });
  w.ops.server = async (j) => {
    const e = w.fail.server.shift();
    if (e) throw e();
    w.server.push(`${j.change.fn}:${j.change.data.rid}`);
    return { assignmentId: 'a9' };
  };
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(changeJob('c1'));
  await settle(ob);
  assert.deepEqual(w.server, ['assignVan:rid-abc12345'], 'the same request id each time');
  assert.deepEqual(ob.results.get('c1'), { assignmentId: 'a9' });
  assert.equal(ob.jobs.length, 0);
  assert.deepEqual(w.uploads, [], 'a change has no files');
  assert.deepEqual(w.saves, []);
});

test('a change with a photo (a check done with its photo): the photo goes up first, then the change', async () => {
  const w = world();
  const order = [];
  const up = w.ops.upload;
  w.ops.upload = async (...a) => { order.push('photo'); return up(...a); };
  w.ops.server = async () => { order.push('change'); return { id: 'd1' }; };
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(changeJob('c2', { files: [{ key: 'c2/1.jpg', path: 'orgs/o1/routines/u1/x.jpg', mime: 'image/jpeg', size: 10 }],
    change: { kind: 'call', fn: 'routineDone', data: { orgId: 'o1', vehicleId: 'v1', routineId: 'r1', ok: true, path: 'orgs/o1/routines/u1/x.jpg', rid: 'rid-def67890' } } }));
  await settle(ob);
  assert.deepEqual(order, ['photo', 'change']);
  assert.ok(w.dropped.includes('c2'));
});

test('a refused change stops with the server\'s reason; jobs after it still go', async () => {
  const w = world();
  let n = 0;
  w.ops.server = async (j) => { if (n++ === 0) throw refused('While this was waiting to be sent, someone else changed who has Van 1.'); return { ok: true, id: j.id }; };
  const ob = new Outbox(w.ops);
  ob.start('u1');
  await ob.add(changeJob('c3'));
  await ob.add(changeJob('c4', { change: { kind: 'write', op: 'update', path: ['orgs', 'o1', 'vehicles', 'v1'], data: { name: 'Van One' } } }));
  await settle(ob);
  assert.equal(ob.jobs.find((j) => j.id === 'c3').status, 'failed');
  assert.match(ob.jobs.find((j) => j.id === 'c3').error, /someone else changed/);
  assert.deepEqual(ob.results.get('c4'), { ok: true, id: 'c4' });
});
