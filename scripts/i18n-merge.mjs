// Builds public/i18n/<code>.json from a translator's files i18n/out/<code>*.jsonl, one line per text:
//   {"id":"1a2b3c4d","t":"translation"}   or, for a count,   {"id":"…","t":{"one":"…","few":"…","other":"…"}}
// Later lines win (fixes can be appended in another file). Then checks the language (missing, broken).
//   node scripts/i18n-merge.mjs de
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const code = process.argv[2];
if (!/^[a-z]{2,3}$/.test(code || '')) { console.error('Usage: node scripts/i18n-merge.mjs <code>'); process.exit(1); }
const keys = JSON.parse(readFileSync(join(ROOT, 'i18n/keys.json'), 'utf8'));
const byId = new Map(keys.map((k) => [k.id, k.key]));
const outDir = join(ROOT, 'i18n/out');
const file = join(ROOT, 'public/i18n', `${code}.json`);
const dict = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
let read = 0, unknown = 0, badLines = 0;
for (const f of (existsSync(outDir) ? readdirSync(outDir) : []).filter((x) => x.startsWith(`${code}.`) || x === `${code}.jsonl`).sort()) {
  for (const line of readFileSync(join(outDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { badLines++; continue; }
    const key = byId.get(o.id);
    if (!key) { unknown++; continue; }
    if (typeof o.t === 'string' || (o.t && typeof o.t === 'object')) { dict[key] = o.t; read++; }
  }
}
mkdirSync(join(ROOT, 'public/i18n'), { recursive: true });
const sorted = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
console.log(`${code}: ${read} lines read${unknown ? `, ${unknown} unknown ids` : ''}${badLines ? `, ${badLines} lines that aren't JSON` : ''}.`);
execFileSync('node', [join(ROOT, 'scripts/i18n.mjs'), `--lang=${code}`], { stdio: 'inherit' });
