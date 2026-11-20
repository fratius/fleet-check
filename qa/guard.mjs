// The checks can't be changed by the work they check (Test workflow). A branch that changes the app may not also
// change the blind tester's brief or how its run is set up, and may only ADD lines to the feature map: a line that
// changes or goes is a decision about what the app must do, so it goes in a branch of its own that changes nothing
// else, and the product owner merges it knowingly.
// Run: node qa/guard.mjs [base]   (base: the commit to compare with, default the merge base with origin/main)
import { execFileSync } from 'node:child_process';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const base = process.argv[2] || git('merge-base', 'HEAD', 'origin/main');
const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);

// What the app is: everything people use or the server runs.
const APP = [/^src\//, /^functions\/src\//, /^public\//, /^website\//, /^assets\//, /^firestore\.rules$/, /^storage\.rules$/,
  /^firestore\.indexes\.json$/, /^firebase\.json$/, /^app\.json$/, /^app\.config\.js$/, /^package(-lock)?\.json$/, /^functions\/package(-lock)?\.json$/];
// What the tester is told and how its run is set up.
const LOCKED = ['qa/TESTER.md', 'qa/run.sh', 'qa/report.mjs', 'qa/focus.mjs', 'qa/serve.mjs', 'qa/guard.mjs', 'tests/qa.test.mjs', '.claude/skills/verify/SKILL.md', '.github/workflows/blind-qa.yml'];
const MAP = 'qa/FEATURES.md';

const app = changed.filter((f) => APP.some((r) => r.test(f)));
if (!app.length) {
  console.log(`Nothing of the app changed (${changed.length} files): the tester's files may change here.`);
  process.exit(0);
}
const problems = [];
for (const f of changed.filter((f) => LOCKED.includes(f))) {
  problems.push(`${f} changed together with the app (${app.slice(0, 3).join(', ')}${app.length > 3 ? '…' : ''}). Change it in a branch of its own.`);
}
if (changed.includes(MAP)) {
  let before = '';
  try { before = git('show', `${base}:${MAP}`); } catch { /* new file: everything is added */ }
  const now = new Set(git('show', `HEAD:${MAP}`).split('\n'));
  const gone = before.split('\n').filter((l) => l.trim() && !now.has(l));
  for (const l of gone.slice(0, 10)) problems.push(`${MAP}: a line changed or went, together with the app: "${l.slice(0, 120)}"`);
  if (gone.length > 10) problems.push(`${MAP}: ${gone.length - 10} more lines changed or went.`);
}
if (!problems.length) {
  console.log(`The app changed (${app.length} files); the tester's brief and setup didn't, and the map only gained lines.`);
  process.exit(0);
}
for (const p of problems) console.log(`::error title=Tester's rules changed with the app::${p}`);
console.log('A branch that changes the app may only add lines to qa/FEATURES.md. Changing what the app must do, or the tester itself, goes in a separate branch the product owner merges on its own.');
process.exit(1);
