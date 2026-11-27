// Blind test, 26 Nov 2026, cause 4.3 and 4.4: dates, times, sentences, kept texts, names and search in every
// language. Run: node --import ./tests/alias.mjs --test tests/formats.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { LANG_CODES, TIME, again, applyDict, fmtTime, loc, source, t, tp } from '../src/lib/i18n.ts';
import { NAME_MAX, initials, nameTooLong, personMatches } from '../src/lib/vans.ts';

const LANGS = LANG_CODES.length ? LANG_CODES : [];

test('English dates are the European way round, never the US one (10/25/2026)', () => {
  applyDict('en', {});
  const d = new Date(2026, 9, 25, 15, 30);
  assert.doesNotMatch(d.toLocaleDateString(loc()), /^10\/25\/2026$/);
  assert.match(d.toLocaleDateString(loc()), /^25\/10\/2026$/);
});

test('times are 24-hour in every language: no am/pm (Hindi showed English "am")', () => {
  assert.ok(LANGS.length >= 32, `${LANGS.length} languages`);
  const d = new Date(2026, 9, 25, 15, 30);
  for (const code of LANGS) {
    applyDict(code, {});
    const parts = new Intl.DateTimeFormat(loc(), TIME).formatToParts(d);
    assert.ok(!parts.some((p) => p.type === 'dayPeriod'), `${code}: ${fmtTime(d.getTime())}`);
    assert.doesNotMatch(fmtTime(d.getTime()), /\b(am|pm)\b/i, code);
  }
});

test('a date that ends in a full stop, at the end of a sentence, gives one full stop (Hungarian "2026. 10. 25..")', () => {
  applyDict('hu', { 'Changed {day}.': 'Módosítva: {day}.' });
  assert.equal(t('Changed {day}.', { day: '2026. 10. 25.' }), 'Módosítva: 2026. 10. 25.');
  // Three dots stay three dots; a full stop in the middle stays.
  applyDict('en', {});
  assert.equal(t('Wait{x}', { x: '...' }), 'Wait...');
  assert.equal(t('{a}. Then {b}.', { a: 'Done', b: 'go' }), 'Done. Then go.');
});

test('a text kept for later (a waiting change, why it stopped) shows in the language chosen later', () => {
  applyDict('en', {});
  const title = t('Give {van} to {name}', { van: 'B-X 1', name: 'Ali' });
  const role = t('Make {name} {role}', { name: 'Ali', role: t('Fleet manager') });
  const count = tp(3, 'Add {n} van from a file', 'Add {n} vans from a file');
  const kept = [source(title), source(role), source(count)];
  assert.ok(kept.every(Boolean), 'each one is known');
  applyDict('de', {
    'Give {van} to {name}': '{van} an {name} übergeben', 'Make {name} {role}': '{name} zu {role} machen', 'Fleet manager': 'Flottenmanager',
    'Add {n} vans from a file': { one: '{n} Transporter aus einer Datei hinzufügen', other: '{n} Transporter aus einer Datei hinzufügen' },
  });
  assert.equal(again(title, kept[0]), 'B-X 1 an Ali übergeben');
  assert.equal(again(role, kept[1]), 'Ali zu Flottenmanager machen');
  assert.equal(again(count, kept[2]), '3 Transporter aus einer Datei hinzufügen');
  // A text that wasn't made by t() stays as it is.
  assert.equal(again('typed by someone', null), 'typed by someone');
});

test('search finds a name whatever way i and other letters are typed (Turkish ı and İ, Polish ł, ß)', () => {
  const p = (name) => ({ name });
  assert.ok(personMatches(p('Ali Yilmaz'), 'yılmaz'));
  assert.ok(personMatches(p('Ali Yılmaz'), 'yilmaz'));
  assert.ok(personMatches(p('Ali Yılmaz'), 'YILMAZ'));
  assert.ok(personMatches(p('İsmail Kaya'), 'ismail'));
  assert.ok(personMatches(p('Łukasz Nowak'), 'lukasz'));
  assert.ok(personMatches(p('Jörg Weiß'), 'weiss'));
  assert.ok(!personMatches(p('Ali Yilmaz'), 'yilmazz'));
});

test('initials: an emoji or a sign doesn\'t give half a character', () => {
  assert.equal(initials('😀 Emma Stone'), 'ES');
  assert.equal(initials('Emma 😀 Stone'), 'ES');
  assert.equal(initials('emma'), 'E');
  assert.equal(initials('Łukasz Nowak'), 'ŁN');
  assert.equal(initials('😀'), '?');
  assert.equal(initials(''), '?');
  for (const s of ['😀 Emma', '🚐🚐', 'Ann 👍']) assert.doesNotMatch(initials(s), /[\uD800-\uDFFF]/, s);
});

test('a first or last name over 40 characters is too long (it is refused with a message, not cut)', () => {
  assert.equal(NAME_MAX, 40);
  assert.ok(!nameTooLong('x'.repeat(40)));
  assert.ok(nameTooLong('x'.repeat(41)));
  assert.ok(!nameTooLong(`  ${'x'.repeat(40)}  `), 'spaces around don\'t count');
});

// Blind QA of cause 4, round 1: the Data tab's search missed "Yılmaz" for "yilmaz" (its own lower-casing instead of
// the app's name matching), and Arabic screens showed lists joined with a Latin "," ("محطتان, 12 فانًا").
const SRC = new URL('../src/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
const where = (re, skip = /$^/) => files(SRC).flatMap((f) => readFileSync(f, 'utf8').split('\n')
  .flatMap((l, i) => (re.test(l) && !skip.test(l) ? [`${f.slice(SRC.length)}:${i + 1}`] : [])));

test('every search box matches the way names are matched (ı and i, accents), none lower-cases on its own', () => {
  assert.deepEqual(where(/\.to(Locale)?LowerCase\(\)\.includes\(/), []);
});

test('lists shown on screen are joined with the language\'s own comma ("،" in Arabic and Persian), not a Latin ", "', () => {
  assert.deepEqual(where(/\.join\(', '\)|\}, \$\{|`, \$\{/, /system-ui/), []);
});
