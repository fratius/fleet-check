// What the blind tester is told changed (Blind QA workflow): the words typed when the run was started, or the pull
// request's "## For the tester" section. Only that section: the rest of a pull request talks about code, and the
// tester must not learn the code from it. Prints the focus.
import { readFileSync } from 'node:fs';

const typed = (process.env.INPUT || '').trim();
let focus = typed;
if (!focus && process.env.GITHUB_EVENT_PATH) {
  const pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  if (pr) {
    const m = (pr.body || '').replace(/\r/g, '').match(/^##\s*For the tester\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
    focus = m && m[1].trim()
      ? m[1].trim()
      : `${pr.title}\n(The pull request has no "For the tester" section, so this is all you get: test the whole app, starting with what the title suggests.)`;
  }
}
process.stdout.write(focus.slice(0, 4000));
