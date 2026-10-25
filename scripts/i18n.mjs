// The texts to translate, and what each language is missing.
//
//   node scripts/i18n.mjs            writes i18n/keys.json (every text, from the app and the functions) and reports,
//                                    per language in public/i18n/<code>.json, what is missing or broken
//   node scripts/i18n.mjs --prune    also removes translations of texts the app no longer has
//   node scripts/i18n.mjs --strict   fails when a translation is broken (a {placeholder} lost or invented)
//
// A text is found where it is passed to t(), tp(), tj() or N_() in the app, and to fail(), tr(), trp() or N_() in the
// functions: only as a plain string (a variable can't be found, so mark constants with N_()).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');

const ROOT = new URL('..', import.meta.url).pathname;
const args = new Set(process.argv.slice(2));

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules') out.push(...files(p)); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/** The plain string an argument holds, or null (a variable, an expression, a template with ${}). */
function lit(n) {
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked).join('');
  if (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') return lit(n.expression);
  return null;
}

const keys = new Map(); // key -> { one?: string, files: Set, server?: true }
const problems = [];
function add(key, file, line, extra = {}) {
  if (!key || !key.trim()) return;
  const k = keys.get(key) || { files: new Set() };
  k.files.add(`${relative(ROOT, file)}:${line}`);
  if (extra.one) k.one = extra.one;
  if (extra.server) k.server = true;
  keys.set(key, k);
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit));
    else if (v && typeof v.type === 'string') walk(v, visit);
  }
}

function scan(file, server) {
  const src = readFileSync(file, 'utf8');
  let ast;
  try { ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); } catch (e) { problems.push(`${relative(ROOT, file)}: can't parse (${e.message})`); return; }
  walk(ast.program, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return;
    const name = n.callee.name, a = n.arguments, line = n.loc.start.line;
    const need = (i) => {
      const s = lit(a[i]);
      if (s == null && a[i] && !(a[i].type === 'Identifier' || a[i].type === 'MemberExpression' || a[i].type === 'CallExpression' || a[i].type === 'ConditionalExpression' || a[i].type === 'LogicalExpression' || a[i].type === 'OptionalMemberExpression')) {
        problems.push(`${relative(ROOT, file)}:${line}: ${name}() needs a plain string (got ${a[i].type})`);
      }
      return s;
    };
    if (!server && (name === 't' || name === 'tj' || name === 'N_')) add(need(0), file, line);
    else if (!server && name === 'tp') add(need(2), file, line, { one: lit(a[1]) || undefined });
    else if (server && name === 'N_') add(need(0), file, line, { server: true });
    else if (server && name === 'fail') add(need(1), file, line, { server: true });
    else if (server && name === 'tr') add(need(1), file, line, { server: true });
    else if (server && name === 'trp') add(need(3), file, line, { server: true, one: lit(a[2]) || undefined });
  });
}

for (const f of files(join(ROOT, 'src'))) scan(f, false);
for (const f of files(join(ROOT, 'functions/src'))) scan(f, true);

const list = [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({
  key, ...(v.one ? { one: v.one } : {}), ...(v.server ? { server: true } : {}), where: [...v.files].sort(),
}));
mkdirSync(join(ROOT, 'i18n'), { recursive: true });
writeFileSync(join(ROOT, 'i18n/keys.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`${list.length} texts (${list.filter((k) => k.one).length} with a count), ${list.filter((k) => k.server).length} from the functions.`);
problems.forEach((p) => console.log(`  ! ${p}`));

// Each language: missing, broken, no longer used.
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const dir = join(ROOT, 'public/i18n');
let broken = 0;
if (existsSync(dir)) {
  const { formsOf } = await import(join(ROOT, 'scripts/plural-forms.mjs'));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const code = f.replace('.json', '');
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    let missing = 0, bad = [];
    for (const k of list) {
      const e = d[k.key];
      if (e == null || e === '') { missing++; continue; }
      const want = ph(k.key);
      if (typeof e === 'string') {
        if (k.one) { bad.push(`${k.key}: a count needs its forms (${formsOf(code).join(', ')})`); continue; }
        if (ph(e) !== want) bad.push(`${k.key} -> ${e}`);
      } else {
        for (const form of formsOf(code)) {
          if (!e[form]) bad.push(`${k.key}: form "${form}" missing`);
          else if (ph(e[form]).replace(/(^|,)n(,|$)/, '$1$2').replace(/^,|,$/g, '') !== want.replace(/(^|,)n(,|$)/, '$1$2').replace(/^,|,$/g, '')) bad.push(`${k.key} [${form}] -> ${e[form]}`);
        }
      }
    }
    const unused = Object.keys(d).filter((k) => !keys.has(k));
    if (args.has('--prune') && unused.length) {
      unused.forEach((k) => delete d[k]);
      writeFileSync(join(dir, f), JSON.stringify(d, null, 1) + '\n');
    }
    broken += bad.length;
    console.log(`${code}: ${list.length - missing}/${list.length} translated${missing ? `, ${missing} missing (English shown)` : ''}${bad.length ? `, ${bad.length} broken` : ''}${unused.length ? `, ${unused.length} no longer used${args.has('--prune') ? ' (removed)' : ''}` : ''}`);
    bad.slice(0, 8).forEach((b) => console.log(`    broken: ${b}`));
  }
}
if (args.has('--strict') && (broken || problems.length)) process.exit(1);
