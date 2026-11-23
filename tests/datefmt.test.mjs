// Dates and times as people type them, and the calendar's grid (src/lib/datefmt.ts).
// Run: node --import ./tests/alias.mjs --test tests/datefmt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeDay, typeMonth, typeTime, monthGrid, pickable, wheelMinute, dayText, monthText, isoOf, readTime } from '../src/lib/datefmt.ts';
import { parseDay } from '../src/lib/fleet.ts';

/** Types the characters one by one, as a person does, through the field's formatter. */
const typeAll = (fmt, chars, start = '') => [...chars].reduce((v, ch) => fmt(v, v + ch), start);

test('A1: a date typed as digits gets its dots by itself', () => {
  assert.equal(typeAll(typeDay, '31032027'), '31.03.2027');
  assert.equal(typeAll(typeDay, '3'), '3');
  assert.equal(typeAll(typeDay, '31'), '31.');
  assert.equal(typeAll(typeDay, '310'), '31.0');
  assert.equal(typeAll(typeDay, '3103'), '31.03.');
  assert.equal(typeAll(typeDay, '310320271'), '31.03.2027', 'no fifth year digit');
  // A day 4–9 or a month 2–9 can't get a second digit: the dot comes at once.
  assert.equal(typeAll(typeDay, '5'), '5.');
  assert.equal(typeAll(typeDay, '532027'), '5.3.2027');
  assert.equal(parseDay(typeAll(typeDay, '532027')), '2027-03-05');
  // Typing the dots yourself works, also after one digit.
  assert.equal(typeAll(typeDay, '1.3.2027'), '1.3.2027');
  assert.equal(typeAll(typeDay, '01.03.2027'), '01.03.2027', 'no double dots');
  assert.equal(typeAll(typeDay, '1/3/27'), '1.3.27');
  assert.equal(parseDay(typeAll(typeDay, '1/3/27')), '2027-03-01');
  // Pasting the whole date at once.
  assert.equal(typeDay('', '31032027'), '31.03.2027');
  assert.equal(typeDay('', '31.03.2027'), '31.03.2027');
  assert.equal(typeDay('', '2027-03-31'), '2027-03-31', 'an ISO date is left as it is');
  // Deleting is never reformatted: the dot can be taken out.
  assert.equal(typeDay('31.', '31'), '31');
  assert.equal(typeDay('31.03.2027', '31.03.202'), '31.03.202');
  // Letters: left as typed (the form then says how a date looks).
  assert.equal(typeDay('3', '3x'), '3x');
});

test('A2: a time typed as digits gets its colon by itself, and the old shortcuts still work', () => {
  assert.equal(typeAll(typeTime, '0930'), '09:30');
  assert.equal(typeAll(typeTime, '1430'), '14:30');
  assert.equal(typeAll(typeTime, '930'), '9:30');
  assert.equal(typeAll(typeTime, '9'), '9:');
  assert.equal(typeAll(typeTime, '1'), '1');
  assert.equal(typeAll(typeTime, '14'), '14:');
  assert.equal(typeAll(typeTime, '14305'), '14:30', 'no third minute digit');
  assert.equal(typeAll(typeTime, '9:30'), '9:30');
  assert.equal(typeAll(typeTime, '9.30'), '9:30');
  assert.equal(typeTime('14:', '14'), '14');
  for (const [typed, time] of [['0930', '09:30'], ['930', '09:30'], ['9', '09:00'], ['1430', '14:30'], ['2359', '23:59']]) {
    assert.equal(readTime(typeAll(typeTime, typed)), time, typed);
  }
  // Two digits too big for an hour: the second one starts the minutes.
  assert.equal(typeAll(typeTime, '25'), '2:5');
});

test('A3: a month typed as digits gets its slash by itself', () => {
  assert.equal(typeAll(typeMonth, '032027'), '03/2027');
  assert.equal(typeAll(typeMonth, '3'), '3/');
  assert.equal(typeAll(typeMonth, '32027'), '3/2027');
  assert.equal(typeAll(typeMonth, '1'), '1');
  assert.equal(typeAll(typeMonth, '12'), '12/');
  assert.equal(typeAll(typeMonth, '3.2027'), '3/2027');
  assert.equal(parseDay(typeAll(typeMonth, '032027')), '2027-03-31', 'a month means its last day, as before');
  assert.equal(typeMonth('03/', '03'), '03');
});

test('A4: the calendar starts weeks on Monday and shows each month whole', () => {
  // November 2026 starts on a Sunday: six empty days first.
  const nov = monthGrid(2026, 10);
  assert.deepEqual(nov[0], [null, null, null, null, null, null, 1]);
  assert.equal(nov.flat().filter(Boolean).length, 30);
  assert.ok(nov.every((w) => w.length === 7));
  // February 2027 starts on a Monday, 28 days: exactly four weeks.
  assert.deepEqual(monthGrid(2027, 1).length, 4);
  assert.equal(monthGrid(2027, 1)[0][0], 1);
  assert.equal(monthGrid(2028, 1).flat().filter(Boolean).length, 29, 'leap year');
  assert.equal(isoOf(2027, 2, 5), '2027-03-05');
  assert.equal(dayText('2027-03-05'), '05.03.2027');
  assert.equal(monthText('2027-03-31'), '03/2027');
});

test('A5: past days for an appointment and future days for work done can\'t be picked', () => {
  assert.equal(pickable('2026-11-22', '2026-11-23'), false);
  assert.equal(pickable('2026-11-23', '2026-11-23'), true, 'today is fine');
  assert.equal(pickable('2026-11-24', null, '2026-11-23'), false);
  assert.equal(pickable('2026-11-23', null, '2026-11-23'), true);
  assert.equal(pickable('1999-01-01'), true, 'no limits');
});

test('A6: the clock wheel goes in 5-minute steps; a typed time in between shows at the nearest step', () => {
  assert.equal(wheelMinute(0), 0);
  assert.equal(wheelMinute(37), 35);
  assert.equal(wheelMinute(38), 40);
  assert.equal(wheelMinute(58), 55, 'never 60');
});
