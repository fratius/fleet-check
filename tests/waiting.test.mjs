// Blind test, 26 Nov 2026, cause 3b (3): while a change waits on the phone (no connection), the button that made it
// isn't offered again ("Cancel the wash" was). Guard for every change: each screen that sends one also checks whether
// that change is waiting, and shows that instead of its button (useWaitingFor in src/components/uploads.tsx).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../src/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx$/.test(f) ? [join(d, f)] : []));
// Sent by itself, with no button of its own: nothing to offer twice.
const ALONE = { logReview: 'sent after a review is finished or reopened; the review itself is a record write that shows at once' };

test('every change a screen sends shows "waiting" in place of its button while it waits', () => {
  const wrong = [];
  let n = 0;
  for (const f of files(root)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/sendCall(?:<[^>]*>)?\('([A-Za-z]+)'/g)) {
      n++;
      const fn = m[1];
      if (ALONE[fn]) continue;
      if (!new RegExp(`useWaitingFor\\('${fn}'`).test(src)) wrong.push(`${f.replace(root, 'src/')}: ${fn}`);
    }
  }
  assert.ok(n >= 20, `found ${n} changes`);
  assert.deepEqual([...new Set(wrong)], []);
});
