// Every list the app asks the database for has its index in firestore.indexes.json.
// The emulators answer any query, so the other tests can't see a missing index: it only shows in production, where
// the server refuses the list and the screen stays empty (the fleet managers' and drivers' "checks done" did, until
// 10 Nov 2026). Deploy removes indexes that aren't in the file, so the file is all there is.
// Run: node --test tests/indexes.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const indexes = JSON.parse(read('../firestore.indexes.json')).indexes;
const A = 'ASCENDING', D = 'DESCENDING', C = 'CONTAINS';
/** Is there an index on `coll` with exactly these fields, in this order? */
const has = (coll, fields) => indexes.some((ix) => ix.collectionGroup === coll && ix.queryScope === 'COLLECTION' && ix.fields.length === fields.length
  && ix.fields.every((f, i) => f.fieldPath === fields[i][0] && (f.order || f.arrayConfig) === fields[i][1]));
const name = (coll, fields) => `${coll}: ${fields.map(([f, o]) => `${f} ${o.toLowerCase()}`).join(', ')}`;

test('the session\'s lists (makeStore in src/lib/store.ts) have their indexes', () => {
  const store = read('../src/lib/store.ts');
  const from = store.indexOf('export function makeStore'), to = store.indexOf("return { mode: 'local'");
  assert.ok(from > 0 && to > from, 'makeStore was not found in src/lib/store.ts: adapt this test');
  // fsColl(orgId, 'name'[, scope[, driverId[, 'field']]]): with `scope` the list is asked by station, with `driverId`
  // by person (the field, 'driverId' unless named), both newest first (fsColl().subscribe).
  const calls = [...store.slice(from, to).matchAll(/fsColl\(orgId, '([A-Za-z]+)'(?:, (scope)(?:, (driverId)(?:, '([A-Za-z]+)')?)?)?\)/g)];
  assert.ok(calls.length >= 16, `only ${calls.length} lists found in makeStore: adapt this test`);
  const missing = [];
  for (const [, coll, scope, mine, field] of calls) {
    const byStation = [['stationId', A], ['createdAt', D]], byPerson = [[field || 'driverId', A], ['createdAt', D]];
    if (scope && !has(coll, byStation)) missing.push(name(coll, byStation));
    if (mine && !has(coll, byPerson)) missing.push(name(coll, byPerson));
  }
  assert.deepEqual(missing, [], 'add these to firestore.indexes.json');
});

test('the other lists (src/lib/people.ts, src/lib/data.ts) have their indexes', () => {
  // Kept by hand next to the queries: a new query with a filter and an order on another field needs its line here
  // and its index in the file.
  const needed = [
    // people.ts: invite links of a company
    ['invites', [['orgId', A], ['createdAt', D]]],
    // people.ts watchHistory: a van's or a person's history, for owners (all) and managers (their stations)
    ['assignments', [['vehicleId', A], ['start', D]]],
    ['assignments', [['vehicleId', A], ['stationId', A], ['start', D]]],
    ['assignments', [['driverId', A], ['start', D]]],
    ['assignments', [['driverId', A], ['stationId', A], ['start', D]]],
    // people.ts watchVanRecords: a van's walk-arounds and damage checks
    ['walkarounds', [['vehicleId', A], ['createdAt', D]]],
    ['walkarounds', [['vehicleId', A], ['stationId', A], ['createdAt', D]]],
    ['checks', [['vehicleId', A], ['createdAt', D]]],
    ['checks', [['vehicleId', A], ['stationId', A], ['createdAt', D]]],
    // people.ts watchDamageNotes: comments on a van's damage, oldest first
    ['damageNotes', [['vehicleId', A], ['createdAt', A]]],
    ['damageNotes', [['vehicleId', A], ['stationId', A], ['createdAt', A]]],
    // data.ts: the Data tab (by station) and a person's page (by person, for managers within their stations)
    ['tours', [['stationId', A], ['createdAt', D]]],
    ['tours', [['driverId', A], ['createdAt', D]]],
    ['tours', [['driverId', A], ['stationId', A], ['createdAt', D]]],
    ['assignments', [['stationId', A], ['createdAt', D]]],
    ['purchases', [['stationId', A], ['createdAt', D]]],
    ['incidents', [['stationId', A], ['day', D]]],
    ['incidents', [['driverId', A], ['createdAt', D]]],
    ['incidents', [['driverId', A], ['stationId', A], ['createdAt', D]]],
    ['damageLog', [['stationId', A], ['foundAt', D]]],
    ['damageLog', [['driverIds', C], ['foundAt', D]]],
  ];
  assert.deepEqual(needed.filter(([coll, fields]) => !has(coll, fields)).map(([coll, fields]) => name(coll, fields)), [], 'add these to firestore.indexes.json');
});
