// The permission table (tests/permissions.mjs) against the code, without emulators (blind test, 26 Nov 2026, cause 2):
// every server action and every collection the app may write has its line, each line's level is checked in the
// action's code, and the rules tests refuse a write to every such collection. A new action or rule without a line
// fails here; tests/history.test.mjs ("the permission table") then calls every action as each person who must be
// refused.
//   node --test tests/permissions.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { ACTIONS, HANDOVER, LEVELS, WRITES } from './permissions.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const fnDir = new URL('functions/src/', root);
const src = readdirSync(fnDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(new URL(f, fnDir), 'utf8')).join('\n');

const EXPORT = /^export const (\w+) = (onCallOnce|onCall)\(/gm;
const NEXT = /^(export )?(const|async function|function) /m;
/** From a line to the next top-level declaration. */
const from = (i) => { const rest = src.slice(i + 1); const n = rest.search(NEXT); return src.slice(i, n < 0 ? undefined : i + 1 + n); };
function actionCode(name) {
  const m = new RegExp(`^export const ${name} = (onCallOnce|onCall)\\(`, 'm').exec(src);
  return m ? from(m.index) : '';
}
function helperCode(name) {
  const m = new RegExp(`^(export )?(async )?function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `the helper ${name} (named in "via") isn't in functions/src`);
  return from(m.index);
}

// How each level and flag shows in the code (functions/src/index.ts: guard, needOwner, needStaff, needStation, ...).
const GATE = {
  creator: /token\?\.creator\s*!==\s*true|token\?\.creator\s*===\s*true/,
  self: /req\.auth\?\.uid|req\.auth\.uid/,
  owner: /needOwner\(who\)|who\.role !== 'owner'/,
  staff: /needStaff\(who\)|staffAt\(/,
  member: /await guard(Only)?\(req/,
};
const STATION = /needStation\(|staffAt\(|who\.stationIds\.includes\(/;
const OWN = /needPhotoTaker\(|\.driverId !== who\.uid/;

test('every server action has a line in the permission table, and every line is a server action', () => {
  const exported = [...src.matchAll(EXPORT)].map((m) => m[1]).sort();
  const listed = Object.keys(ACTIONS).sort();
  assert.deepEqual(listed.filter((x) => !exported.includes(x)), [], 'lines in tests/permissions.mjs for actions that no longer exist');
  assert.deepEqual(exported.filter((x) => !listed.includes(x)), [], 'new server actions: add each to ACTIONS in tests/permissions.mjs (who may call it, ROLES.md)');
});

test('each action checks its level, its station and (drivers) that it is their own, as the table says', () => {
  const wrong = [];
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.ok(LEVELS.includes(a.level), `${name}: unknown level ${a.level}`);
    const code = actionCode(name) + (a.via || []).map(helperCode).join('\n');
    if (!GATE[a.level].test(code)) wrong.push(`${name}: no ${a.level} check`);
    if (a.station && !STATION.test(code)) wrong.push(`${name}: no station check`);
    if (a.own && !OWN.test(code)) wrong.push(`${name}: no check that it's the driver's own`);
    if (a.probe && !a.station) wrong.push(`${name}: a probe is for the station check`);
  }
  assert.deepEqual(wrong, []);
});

test('the driver check of walk-arounds and damage checks: the photo-taker or staff, never another driver', () => {
  const m = /function needPhotoTaker\([^)]*\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'needPhotoTaker is in functions/src/index.ts');
  assert.match(m[1], /who\.role !== 'driver'/);
  assert.match(m[1], /permission-denied/);
  // Every action on a walk-around's photos or its check goes through it.
  for (const name of ['findDamage', 'checkSpot', 'submitCheck']) assert.match(actionCode(name), /needPhotoTaker\(/, name);
});

// Collections the rules let the app write (allow create, update, write or delete), with the rules test refusing one.
const rules = read('firestore.rules');
const rulesTest = read('tests/rules.test.mjs');
function writable() {
  const out = new Set();
  const stack = []; // the match blocks we're in: [name, the depth outside it]
  let depth = 0;
  for (const raw of rules.split('\n')) {
    // Without comments and the path's wildcards (match /checks/{id}), so only the blocks' braces are counted.
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\{[^}]*\}/g, '/*');
    // The collection is the path's last named part (match /users/{uid}/push/{id}: push).
    const m = /match ((?:\/[A-Za-z]+\/\*)+)\s*\{/.exec(line);
    if (m) stack.push([m[1].split('/').filter((x) => x && x !== '*').pop(), depth]);
    if (stack.length && /allow\s+[a-z, ]*\b(create|update|write|delete)\b[a-z, ]*:/.test(line) && !/:\s*if\s+false\s*;/.test(line)) out.add(stack[stack.length - 1][0]);
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; while (stack.length && depth <= stack[stack.length - 1][1]) stack.pop(); }
    }
  }
  return [...out].sort();
}

test('every collection the app may write has a line in the table, and the rules test refuses a write to it', () => {
  const w = writable();
  assert.ok(w.length >= 10, `only ${w.length} writable collections found: ${w.join(', ')}`);
  assert.deepEqual(w.filter((c) => !(c in WRITES)), [], 'collections the rules let the app write: add each to WRITES in tests/permissions.mjs');
  assert.deepEqual(Object.keys(WRITES).filter((c) => !w.includes(c)), [], 'lines in WRITES for collections the app can no longer write');
  const untested = Object.keys(WRITES).filter((c) => {
    // An assertFails on a write (setDoc, updateDoc, deleteDoc, addDoc) to a path of that collection, written out or
    // through a helper of the rules test (const det = (db, id) => doc(db, `orgs/${O}/vehicleDetails/${id}`)).
    const path = `['\`/]${c}['\`/]`;
    const helpers = [...rulesTest.matchAll(new RegExp(`const (\\w+) = \\([^)]*\\) => doc\\([^\\n]*${path}`, 'g'))].map((m) => m[1]);
    const target = helpers.length ? `(${[`[^\\n]*${path}`, ...helpers.map((h) => `${h}\\(`)].join('|')})` : `[^\\n]*${path}`;
    return !new RegExp(`assertFails\\((setDoc|updateDoc|deleteDoc|addDoc)\\(${target}`).test(rulesTest);
  });
  assert.deepEqual(untested, [], 'collections without a refused write in tests/rules.test.mjs');
});

test('ROLES.md points to the table', () => {
  assert.match(read('ROLES.md'), /tests\/permissions\.mjs/);
});

// Blind test, 26 Nov 2026, cause 3: an out-of-date screen never ends someone else's handover by surprise.
test('every action that gives out, takes over or ends a handover checks what the screen showed, and the app sends it', () => {
  const wrong = [];
  for (const [name, h] of Object.entries(HANDOVER)) {
    const code = actionCode(name);
    if (!code) { wrong.push(`${name}: not a server action`); continue; }
    if (!/needSameHandover\(req\.data|'expect' in req\.data/.test(code)) wrong.push(`${name}: doesn't check expect`);
    if (h.takeOver && !/takeOver !== true/.test(code)) wrong.push(`${name}: doesn't ask for takeOver`);
    for (const f of h.app) {
      const app = read(f);
      const calls = [...app.matchAll(new RegExp(`'${name}', \\{[^}]*\\}`, 'g'))].map((m) => m[0]);
      if (name === 'pickUpVan') { if (!/expect: th\.expect/.test(app)) wrong.push(`${name}: ${f} doesn't send expect`); continue; }
      if (!calls.length) wrong.push(`${name}: no call in ${f}`);
      for (const c of calls) if (!/expect/.test(c)) wrong.push(`${name}: a call in ${f} without expect: ${c.slice(0, 80)}`);
    }
  }
  // Every action that ends an assignment (closeWith) is in the list.
  const ending = [...src.matchAll(EXPORT)].map((m) => m[1]).filter((n) => /closeWith\(/.test(actionCode(n)) && !['dropOffVan', 'deleteAccount'].includes(n));
  for (const n of ending) if (!(n in HANDOVER)) wrong.push(`${n} ends a handover: add it to HANDOVER`);
  assert.deepEqual(wrong, []);
});
