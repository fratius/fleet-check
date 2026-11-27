// The app creator viewing a company as someone else always has the way back (product owner, 27 Nov 2026: stuck on
// "The plan has ended" of a company opened with View as, also after signing out and in, since View as is kept on the
// account). The strip with "Back to me" sits above the tab bar, so every screen shown instead of the tabs must carry it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('every screen the tabs layout shows instead of the tabs keeps "Back to me" for View as', () => {
  const layout = read('src/app/(tabs)/_layout.tsx');
  const body = layout.slice(layout.indexOf('export default function TabsLayout'));
  // Early returns: `if (…) return <Something …`, before the tabs themselves.
  const screens = [...body.matchAll(/\bif \([^)]*\) return <([A-Z]\w*)/g)].map((m) => m[1]);
  assert.ok(screens.length >= 1, 'the layout has at least the payment screen');
  const wrong = [];
  for (const name of screens) {
    const imp = layout.match(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@/([^']+)'`));
    if (!imp) { wrong.push(`${name}: not imported from the app`); continue; }
    const src = read(`src/${imp[1]}.tsx`);
    const start = src.search(new RegExp(`export function ${name}\\b`));
    const own = src.slice(start, src.indexOf('\nexport ', start + 1) === -1 ? undefined : src.indexOf('\nexport ', start + 1));
    if (!/<ViewingStrip\b/.test(own)) wrong.push(`${name} (src/${imp[1]}.tsx) has no <ViewingStrip />`);
  }
  assert.deepEqual(wrong, []);
});
