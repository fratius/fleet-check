// Blind test, 27 Nov 2026 (cause 3b, rounds 1 and 3): "Tap again to retire" went back to "Retire van" after 3 s, so a
// slow second tap only armed it again and nothing happened, without a word. Product owner: fix the buttons, don't
// wait longer. Every "tap again" confirmation is a ConfirmButton (components/ui.tsx): armed until confirmed or
// cancelled, with Cancel beside it, never reset by a timer.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../src/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));

test('every "tap again" confirmation is a ConfirmButton, and no confirmation resets itself on a timer', () => {
  const wrong = [];
  let n = 0;
  for (const f of files(root)) {
    const name = f.replace(root, 'src/');
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/t\('Tap again/.test(line)) { n++; if (!/armedTitle=/.test(line)) wrong.push(`${name}:${i + 1}: a "Tap again" text outside a ConfirmButton's armedTitle`); }
      if (/setTimeout\(\(\) => set(Armed|Again)\b/.test(line)) wrong.push(`${name}:${i + 1}: a confirmation reset by a timer`);
    });
  }
  assert.ok(n >= 10, `found ${n} confirmations`);
  assert.deepEqual(wrong, []);
});
