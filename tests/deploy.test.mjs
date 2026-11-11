// What only the live project needs, and the emulators don't: so no other test can see it missing.
// Run: node --test tests/deploy.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
