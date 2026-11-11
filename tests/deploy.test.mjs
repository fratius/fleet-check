// What only the live project needs, and the emulators don't: so no other test can see it missing.
// Run: node --test tests/deploy.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the upload rules ask the database who belongs to a company, so Deploy lets them read it', () => {
  // storage.rules use firestore.exists() / firestore.get(). In the live project Google only answers those when the
  // Storage service account has the role below. The Firebase tools give it only to a person deploying at a
  // keyboard, never in a workflow; without it every upload and every photo is refused for everyone (it was, until
  // 11 Nov 2026). Deploy gives the role itself and stops if it can't.
  const rules = read('../storage.rules');
  if (!/firestore\.(get|exists)\(/.test(rules)) return;
  const deploy = read('../.github/workflows/deploy.yml');
  const at = deploy.indexOf('roles/firebaserules.firestoreServiceAgent');
  assert.ok(at > 0, 'Deploy must give roles/firebaserules.firestoreServiceAgent to the Storage service account');
  assert.match(deploy, /gcp-sa-firebasestorage\.iam\.gserviceaccount\.com/, 'to the Cloud Storage for Firebase service account');
  assert.match(deploy, /add-iam-policy-binding[^\n]*--role="\$ROLE"/, 'with gcloud projects add-iam-policy-binding');
  // Before the rules go out, not after.
  assert.ok(at < deploy.indexOf('deploy --only firestore,storage,functions'), 'before the rules are deployed');
});

/** The script of one Deploy step, as the runner would get it. */
function stepScript(deploy, name) {
  const at = deploy.indexOf(`- name: ${name}\n`);
  assert.ok(at > 0, `Deploy has the step "${name}"`);
  const lines = [];
  for (const l of deploy.slice(deploy.indexOf('run: |\n', at) + 7).split('\n')) {
    if (l.trim() && !l.startsWith('          ')) break;
    lines.push(l.slice(10));
  }
  return lines.join('\n');
}

test('no test calls the real AI, so Deploy asks Anthropic whether it accepts the key before anything goes out', () => {
  // The emulators answer AI requests with made-up results. A key Anthropic refuses is therefore invisible to every
  // test: on 11 Nov 2026 the key worked in several workspaces, the app named none, and every AI request in
  // production was refused. Deploy asks once (the free list of models), stops on a refusal with what to do, and
  // carries on when Anthropic just doesn't answer.
  const deploy = read('../.github/workflows/deploy.yml');
  const script = stepScript(deploy, 'Check that Anthropic accepts the AI key');
  assert.ok(deploy.indexOf('Check that Anthropic accepts the AI key') < deploy.indexOf('deploy --only firestore,storage,functions'), 'before the functions are deployed');
  const dir = mkdtempSync(join(tmpdir(), 'deploy-'));
  // A stand-in for curl: answers what the case says, and keeps what it was asked.
  writeFileSync(join(dir, 'curl'), `#!/bin/bash
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
printf '%s\\n' "$@" > "$ASKED"
[ "$ANSWER" = "none" ] && exit 28
printf '%s' "$BODY" > "$out"; printf '%s' "$ANSWER"
`, { mode: 0o755 });
  const ask = (answer, body = {}, ws = '') => {
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, ASKED: join(dir, 'asked'), KEY: 'sk-ant-test-key', WS: ws, ANSWER: String(answer), BODY: typeof body === 'string' ? body : JSON.stringify(body) };
    const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    assert.ok(!out.includes('sk-ant-test-key'), 'the key is never printed');
    return { code: r.status, out, asked: readFileSync(join(dir, 'asked'), 'utf8') };
  };
  const error = (message) => ({ type: 'error', error: { type: 'invalid_request_error', message } });
  // Accepted: nothing to do. No workspace is named unless one is set.
  let r = ask(200);
  assert.equal(r.code, 0);
  assert.match(r.asked, /api\.anthropic\.com\/v1\/models/);
  assert.doesNotMatch(r.asked, /anthropic-workspace-id/);
  // A key that works in several workspaces, none named: stop, and say both ways out.
  r = ask(400, error('This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.'));
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=AI key::/);
  assert.match(r.out, /ANTHROPIC_API_KEY/);
  assert.match(r.out, /ANTHROPIC_WORKSPACE_ID/);
  // With the variable set, the workspace is named (spaces around it don't matter).
  r = ask(200, {}, ' wrkspc_01Abc\n');
  assert.equal(r.code, 0);
  assert.match(r.asked, /anthropic-workspace-id: wrkspc_01Abc\n/);
  // Not a workspace ID, a workspace the key can't use, a key Anthropic doesn't know: stop.
  assert.equal(ask(200, {}, 'My workspace').code, 1);
  assert.equal(ask(404, error('Workspace wrkspc_01Abc not found.'), 'wrkspc_01Abc').code, 1);
  r = ask(401, error('invalid x-api-key'));
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=AI key::Anthropic refused the AI key/);
  // Anthropic busy, down or not reachable from the runner: say so and deploy anyway.
  for (const a of [429, 500, 529, 'none']) {
    r = ask(a, a === 'none' ? {} : error('Overloaded'));
    assert.equal(r.code, 0, `deploys when Anthropic answers ${a}`);
    assert.match(r.out, /::warning title=AI key::/);
  }
  assert.equal(ask(502, '<html>Bad gateway</html>').code, 0);
});

test('a key that works in several workspaces: Deploy passes the workspace to the functions, and they name it on every AI request', () => {
  const deploy = read('../.github/workflows/deploy.yml');
  const claude = read('../functions/src/claude.ts');
  // The functions send the header from their environment…
  assert.match(claude, /'anthropic-workspace-id'/);
  assert.match(claude, /env\.ANTHROPIC_WORKSPACE_ID/);
  assert.match(claude, /defaultHeaders: workspaceHeader\(\)/);
  // …which Deploy fills from the GitHub variable, before the functions go out, and empties when the variable is gone.
  const script = stepScript(deploy, 'Tell the functions which Anthropic workspace to use');
  assert.ok(deploy.indexOf('Tell the functions which Anthropic workspace to use') < deploy.indexOf('deploy --only firestore,storage,functions'));
  assert.match(deploy, /WS: \$\{\{ vars\.ANTHROPIC_WORKSPACE_ID \}\}/);
  const dir = mkdtempSync(join(tmpdir(), 'deploy-env-'));
  mkdirSync(join(dir, 'functions'));
  const file = join(dir, 'functions', '.env');
  const run = (ws) => assert.equal(spawnSync('bash', ['-c', script], { cwd: dir, env: { ...process.env, WS: ws }, encoding: 'utf8' }).status, 0);
  run('');
  assert.equal(existsSync(file), false);
  run(' wrkspc_01Abc ');
  assert.equal(readFileSync(file, 'utf8'), 'ANTHROPIC_WORKSPACE_ID=wrkspc_01Abc\n');
  writeFileSync(file, 'OTHER=1\nANTHROPIC_WORKSPACE_ID=wrkspc_old\n');
  run('wrkspc_02New');
  assert.equal(readFileSync(file, 'utf8'), 'OTHER=1\nANTHROPIC_WORKSPACE_ID=wrkspc_02New\n');
  run('');
  assert.equal(readFileSync(file, 'utf8'), 'OTHER=1\n');
});
