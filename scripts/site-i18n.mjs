#!/usr/bin/env node
/**
 * Texts of the website (website/index.html) and its translations (website/i18n/<code>.json).
 *
 *   node scripts/site-i18n.mjs            writes i18n/site-keys.json (every English text, with an id) and lists
 *                                         what each language misses
 *   node scripts/site-i18n.mjs --strict   also fails when a translation loses or invents a {placeholder} or changes
 *                                         the HTML tags in a text, or a language file is gone (CI). Missing texts
 *                                         only warn: the page shows them in English until translated.
 *
 * The page translates itself in the browser: every text node and every aria-label, placeholder, title and alt of
 * the body (outside script, style and [translate="no"]), plus every t('…') and N_('…') in its script. The English
 * text is the key, with white space collapsed, exactly as the page's translatePage() and t() look it up.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'website/index.html'), 'utf8');
const strict = process.argv.includes('--strict');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', minus: '−', ndash: '–', mdash: '—' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const letters = (s) => /\p{L}/u.test(s);

/** Removes the element that opens at index i (and everything inside it). */
function cutElement(s, i) {
  const open = s.slice(i).match(/^<([a-zA-Z][\w-]*)/);
  const tag = open[1].toLowerCase();
  const end = s.indexOf('>', i);
  if (s[end - 1] === '/') return s.slice(0, i) + s.slice(end + 1);
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = end + 1;
  let depth = 1, m;
  while ((m = re.exec(s))) {
    depth += m[1] ? -1 : 1;
    if (!depth) return s.slice(0, i) + s.slice(re.lastIndex);
  }
  throw new Error(`No closing </${tag}> for the element at ${i}`);
}

const keys = new Map(); // key -> where
const add = (k, where) => { k = norm(k); if (k && letters(k) && !keys.has(k)) keys.set(k, where); };

// 1. The body's text nodes and labels.
let body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
for (let i; (i = body.search(/<[a-zA-Z][\w-]*\b[^>]*\btranslate="no"/)) >= 0;) body = cutElement(body, i);
for (const m of body.matchAll(/<[a-zA-Z][^>]*>/g)) {
  for (const a of m[0].matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) add(decode(a[2]), `attribute ${a[1]}`);
}
for (const m of body.matchAll(/>([^<]+)</g)) add(decode(m[1]), 'page');

// 2. The script's t('…') and N_('…').
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
for (const m of script.matchAll(/\b(?:t|N_)\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g)) {
  add(Function(`return ${m[1]}`)(), 'script');
}

const list = [...keys].map(([key, where], i) => ({ id: `w${String(i + 1).padStart(3, '0')}`, key, where }));
writeFileSync(join(root, 'i18n/site-keys.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`${list.length} website texts (i18n/site-keys.json)`);

// 3. Each language.
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<\/?[a-z][^>]*>/gi)].map((m) => m[0]).sort().join('');
const dir = join(root, 'website/i18n');
const codes = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
let bad = 0;
for (const code of codes) {
  const tr = JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));
  const missing = list.filter(({ key }) => typeof tr[key] !== 'string' || !tr[key].trim());
  const broken = list.filter(({ key }) => typeof tr[key] === 'string' && (holders(tr[key]) !== holders(key) || tags(tr[key]) !== tags(key)));
  const extra = Object.keys(tr).filter((k) => !keys.has(k));
  if (broken.length) bad++;
  if (missing.length && process.env.GITHUB_ACTIONS) console.log(`::warning title=Website texts not translated::${code}: ${missing.length} texts show in English (node scripts/site-i18n.mjs)`);
  console.log(`${code}: ${missing.length} missing, ${broken.length} broken, ${extra.length} no longer used`);
  for (const { id, key } of broken) console.log(`  broken ${id}: ${JSON.stringify(key)} -> ${JSON.stringify(tr[key])}`);
  if (missing.length && missing.length <= 10) for (const { id, key } of missing) console.log(`  missing ${id}: ${JSON.stringify(key)}`);
}
if (codes.length !== 31) { console.log(`${codes.length} languages in website/i18n (expected 31 besides English)`); if (strict) bad++; }
if (strict && bad) { console.error('Website translations need fixing (see above).'); process.exit(1); }
