import { FieldValue, type DocumentReference, type WriteBatch } from 'firebase-admin/firestore';

/**
 * Drivers never see another driver's name (product owner, 2026-11-20, after the blind tester found names on the van
 * page). So the records a driver can read keep only account ids where someone else did something, and the names
 * are kept apart:
 *
 * - orgs/{org}/names/{uid}: {name, at}. Owners and fleet managers read them (to show who had a van, who took a photo,
 *   who did a check), each person their own. Written only by the server: from the members list (a trigger in
 *   index.ts, so a name change follows) and, once, from what the records said before (splitNames). Never deleted:
 *   people who left keep their name on the history.
 * - Records drivers read (vans, damage checks) carry no name of whoever did something; records that are a driver's
 *   own (their assignments, tours, refuels, the damage log lines they're in) carry no name of another driver. The
 *   names of the station's managers and owners on a driver's own things (who gave them the van, who refused a
 *   refuel, who approved a damage) stay: drivers call their managers anyway.
 *
 * splitNames moves a company's data written before that over: it fills the names in and takes them out of those
 * records. The Deploy workflow runs it once per company (functions/scripts/driver-names.cjs); the demo company runs
 * it once it's made.
 */

export const NAMES = 'names';

/** A person's name from the company's names, else its people (null when neither knows them). */
export async function nameOf(org: DocumentReference, uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  const n = (await org.collection(NAMES).doc(uid).get()).data()?.name;
  if (typeof n === 'string' && n) return n;
  const m = (await org.collection('members').doc(uid).get()).data()?.name;
  return typeof m === 'string' && m ? m : null;
}

type Doc = Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

/**
 * Once per company: the names from its records into orgs/{org}/names, then out of the records drivers read.
 * The members' current names win over what older records said. Safe to run again.
 */
export async function splitNames(org: DocumentReference, batch: () => WriteBatch): Promise<{ names: number; records: number }> {
  const [members, vans, checks, assignments, purchases, tours, readings, routineDone, videos, logs, have] = await Promise.all(
    ['members', 'vehicles', 'checks', 'assignments', 'purchases', 'tours', 'readings', 'routineDone', 'videos', 'damageLog', NAMES].map((c) => org.collection(c).get()));
  const names = new Map<string, string>();
  const note = (uid: unknown, name: unknown) => { const u = str(uid), n = str(name); if (u && n && !names.has(u)) names.set(u, n); };
  // Newest first, so a person's latest name wins over an older spelling.
  const newest = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.map((d) => d.data()).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  for (const m of members.docs) note(m.id, m.data().name);
  for (const v of vans.docs) {
    const x = v.data();
    note(x.assignedTo?.driverId, x.assignedTo?.driverName);
    note(x.dash?.by, x.dash?.byName);
    for (const r of Object.values((x.routines || {}) as Record<string, Doc>)) note(r.by, r.byName);
  }
  for (const a of newest(assignments.docs)) { note(a.driverId, a.driverName); note(a.startedBy, a.startedByName); note(a.endedBy, a.endedByName); }
  for (const k of newest(checks.docs)) note(k.createdBy, k.createdByName);
  for (const p of newest(purchases.docs)) { note(p.by, p.byName); note(p.vanDriverId, p.vanDriverName); }
  for (const t of newest(tours.docs)) { note(t.driverId, t.driverName); note(t.end?.by, t.end?.byName); }
  for (const r of newest(readings.docs)) note(r.by, r.byName);
  for (const r of newest(routineDone.docs)) note(r.by, r.byName);
  for (const v of newest(videos.docs)) note(v.by, v.byName);
  for (const l of newest(logs.docs)) for (const d of (l.drivers || []) as Doc[]) note(d.id, d.name);

  let w = batch(), n = 0, records = 0;
  const put = async (ref: DocumentReference, patch: Doc, set = false) => {
    if (set) w.set(ref, patch, { merge: true }); else w.update(ref, patch);
    if (++n >= 400) { await w.commit(); w = batch(); n = 0; }
  };
  const known = new Set(have.docs.map((d) => d.id));
  const now = Date.now();
  let added = 0;
  for (const [uid, name] of names) {
    // Names already kept stay (the trigger keeps them current); members' current names are written over them.
    if (known.has(uid) && !members.docs.some((m) => m.id === uid)) continue;
    await put(org.collection(NAMES).doc(uid), { name, at: now }, true);
    added++;
  }
  const del = FieldValue.delete();
  for (const v of vans.docs) {
    const x = v.data();
    const patch: Doc = {};
    if (x.assignedTo && 'driverName' in x.assignedTo) patch['assignedTo.driverName'] = del;
    if (x.dash && 'byName' in x.dash) patch['dash.byName'] = del;
    for (const [id, r] of Object.entries((x.routines || {}) as Record<string, Doc>)) if (r && 'byName' in r) patch[`routines.${id}.byName`] = del;
    if (Object.keys(patch).length) { await put(v.ref, patch); records++; }
  }
  for (const k of checks.docs) if ('createdByName' in k.data()) { await put(k.ref, { createdByName: del }); records++; }
  for (const a of assignments.docs) {
    const x = a.data();
    if (x.endReason === 'taken over' && x.endedByName) { await put(a.ref, { endedByName: null }); records++; }
  }
  for (const p of purchases.docs) {
    const x = p.data();
    const patch: Doc = {};
    if ('vanDriverName' in x) patch.vanDriverName = del;
    const flags = Array.isArray(x.flags) ? (x.flags as Doc[]) : [];
    if (flags.some((f) => f.key === 'van' && f.v && typeof f.v === 'object' && 'driver' in (f.v as Doc))) {
      patch.flags = flags.map((f) => (f.key === 'van' ? vanFlag(String(x.byName || '')) : f));
    }
    if (Object.keys(patch).length) { await put(p.ref, patch); records++; }
  }
  for (const t of tours.docs) if (t.data().end && 'byName' in t.data().end) { await put(t.ref, { 'end.byName': del }); records++; }
  for (const l of logs.docs) {
    const ds = (l.data().drivers || []) as Doc[];
    if (ds.some((d) => 'name' in d)) { await put(l.ref, { drivers: ds.map((d) => ({ id: d.id })) }); records++; }
  }
  if (n) await w.commit();
  return { names: added, records };
}

/** The refuel flag for someone else's van, without the name of the driver who has it (the buyer reads it). */
export function vanFlag(name: string) {
  const t = '{name} doesn\'t have this van.';
  return { key: 'van', text: t.replace('{name}', name), t, v: { name } };
}
