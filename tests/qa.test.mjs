// The blind tester stays blind, and the checks can't be changed by the work they check (qa/).
// Run: node --test tests/qa.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const path = (p) => new URL(p, import.meta.url).pathname;
const read = (p) => readFileSync(path(p), 'utf8');

test('the tester has a browser and nothing else: no files, no shell, no code in the page or in Node', () => {
  const run = read('../qa/run.sh');
  // No built-in tools at all, no settings or CLAUDE.md from anywhere, only the browser server from its own file.
  assert.match(run, /--bare --tools "" --strict-mcp-config --mcp-config "\$QA_DIR\/mcp\.json"/);
  assert.match(run, /--permission-mode dontAsk/);
  // Playwright MCP offers these whatever its settings say: taken away by name.
  const not = run.match(/^NOT=\(([^)]*)\)/m)[1].split(/\s+/).filter(Boolean);
  for (const t of ['run_code_unsafe', 'evaluate', 'route', 'drop']) assert.ok(not.includes(t), `${t} is taken away`);
  const allowed = run.match(/^TOOLS=\(([^)]*)\)/m)[1].split(/\s+/).filter(Boolean);
  for (const t of not) assert.ok(!allowed.includes(t), `${t} isn't allowed`);
  assert.match(run, /--disallowedTools "\$\{DISALLOWED%,\}"/);
  // It works in a folder outside the repo, and file:// pages stay blocked (Playwright MCP's default).
  assert.match(run, /case "\$QA_DIR" in "\$REPO"\*\) .*exit 1;; esac/);
  assert.match(run, /cd "\$QA_DIR"/);
  assert.doesNotMatch(run, /allowUnrestrictedFileAccess|allow-unrestricted-file-access/);
  // The web build is served without source maps.
  assert.match(read('../qa/serve.mjs'), /p\.endsWith\('\.map'\)/);
});

test('the functions on the emulators keep their made-up AI answers: the tester\'s key never reaches them', () => {
  const wf = read('../.github/workflows/blind-qa.yml');
  const step = wf.slice(wf.indexOf('- name: The blind run, on the emulators'), wf.indexOf('- name: Keep the report'));
  assert.match(step, /QA_ANTHROPIC_KEY: \$\{\{ secrets\.QA_ANTHROPIC_API_KEY \|\| secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.doesNotMatch(step, /^\s+ANTHROPIC_API_KEY:/m, 'no ANTHROPIC_API_KEY in the emulators\' environment');
  assert.match(step, /echo "ANTHROPIC_API_KEY=not-used-in-tests" > functions\/\.secret\.local/);
  assert.match(read('../qa/run.sh'), /ANTHROPIC_API_KEY="\$QA_ANTHROPIC_KEY" claude -p/);
  // The brief comes from main, so the version under test can't soften it.
  assert.match(wf, /git show origin\/main:qa\/TESTER\.md > qa\/TESTER\.md/);
});

test('the tester learns what changed only from the pull request\'s "For the tester" section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-focus-'));
  const focus = (pr, input = '') => {
    writeFileSync(join(dir, 'ev.json'), JSON.stringify({ pull_request: pr }));
    return execFileSync('node', [path('../qa/focus.mjs')], { env: { ...process.env, GITHUB_EVENT_PATH: join(dir, 'ev.json'), INPUT: input }, encoding: 'utf8' });
  };
  const body = 'Changed functions/src/index.ts and src/lib/vans.ts.\n\n## For the tester\nDrivers can rename the van they have.\n\n## How\nassignVan in index.ts';
  assert.equal(focus({ title: 'Rename', body }), 'Drivers can rename the van they have.');
  assert.match(focus({ title: 'Rename', body: 'Changed src/lib/vans.ts' }), /^Rename\n\(The pull request has no "For the tester" section/);
  assert.equal(focus({ title: 'Rename', body }, 'Typed by hand'), 'Typed by hand');
});

test('the report says when the tester could have read code (a tool other than the browser)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-report-'));
  const report = (tools, result) => {
    const lines = [{ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', tools },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: tools[0] }, { type: 'text', text: 'Looking around.' }] } },
      { type: 'result', subtype: 'success', result, total_cost_usd: 1.234, duration_ms: 600000 }];
    writeFileSync(join(dir, 'transcript.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
    const out = join(dir, 'out');
    writeFileSync(out, '');
    spawnSync('node', [path('../qa/report.mjs'), dir], { env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
    return { md: readFileSync(join(dir, 'report.md'), 'utf8'), out: readFileSync(out, 'utf8') };
  };
  const full = '# Blind QA report\n\nVerdict: ISSUES FOUND\n\n## Findings\n### F01 blocker: manager A sees Potsdam vans\n### F02 nit: typo';
  let r = report(['mcp__browser__browser_click', 'mcp__browser__browser_snapshot'], full);
  assert.match(r.md, /\*\*Blind:\*\* yes/);
  assert.match(r.md, /\$1\.23/);
  assert.match(r.out, /verdict=ISSUES FOUND\nblockers=1\n/);
  r = report(['mcp__browser__browser_click', 'Read', 'Bash'], full);
  assert.match(r.md, /\*\*Blind: NO\.\*\* The tester also had Read, Bash/);
  assert.match(r.out, /blind=false/);
  // Cut off before the report: what it last wrote, and no verdict made up.
  r = report(['mcp__browser__browser_click'], '');
  assert.match(r.md, /Verdict: NO REPORT/);
  assert.match(r.md, /> Looking around\./);
});

test('a branch that changes the app can only add lines to the map, and can\'t touch the tester', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-guard-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  mkdirSync(join(dir, 'qa'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'qa/FEATURES.md'), '# Map\n- MUST 1.1 one\n- MUST 1.2 two\n');
  writeFileSync(join(dir, 'qa/TESTER.md'), 'brief\n');
  writeFileSync(join(dir, 'src/a.ts'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const branch = (files) => {
    git('checkout', '-q', '-B', 'work', base);
    for (const [f, s] of Object.entries(files)) writeFileSync(join(dir, f), s);
    git('add', '-A');
    git('commit', '-qm', 'work');
    return spawnSync('node', [path('../qa/guard.mjs'), base], { cwd: dir, encoding: 'utf8' });
  };
  const map = '# Map\n- MUST 1.1 one\n- MUST 1.2 two\n';
  assert.equal(branch({ 'src/a.ts': 'b\n' }).status, 0, 'the app alone');
  assert.equal(branch({ 'src/a.ts': 'b\n', 'qa/FEATURES.md': map + '- MUST 1.3 three\n' }).status, 0, 'the app and a new map line');
  const brief = branch({ 'src/a.ts': 'b\n', 'qa/TESTER.md': 'softer brief\n' });
  assert.equal(brief.status, 1, 'the app and the brief');
  assert.match(brief.stdout, /qa\/TESTER\.md changed together with the app/);
  const changed = branch({ 'src/a.ts': 'b\n', 'qa/FEATURES.md': map.replace('MUST 1.2 two', 'SHOULD 1.2 two') });
  assert.equal(changed.status, 1, 'the app and a changed map line');
  assert.match(changed.stdout, /a line changed or went, together with the app: "- MUST 1\.2 two"/);
  assert.equal(branch({ 'qa/FEATURES.md': map.replace('MUST 1.2 two', 'SHOULD 1.2 two') }).status, 0, 'the map alone');
  assert.equal(branch({ 'qa/TESTER.md': 'better brief\n' }).status, 0, 'the brief alone');
});
