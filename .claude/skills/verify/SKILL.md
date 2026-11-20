---
name: verify
description: How to prove a change to Fratius works before calling it done, with evidence the product owner can check. The claim in plain words, the cheap checks, the scripted end-to-end tests in CI, the blind tester (an AI that has never seen the code), what to do with its findings, and the live check after Deploy. Use before opening, updating or finishing any pull request that changes the app.
---

# Verify a change

"Done" means proven, with evidence someone else can check. "It should work" and "the types pass" are not proof.
The product owner reviews evidence, not diffs: every pull request says what was verified, how, and what wasn't.

Why it's built this way (the Claude Code team's own practice, Nov 2026): end-to-end tests are the hardest to fool;
a separate grader that didn't write the work catches what the author talks itself into; and checks must stay out of
reach of the work they check.

## 1. Write the claim before the code

In the pull request body, a section **`## For the tester`**: what changes for each role, in the product owner's
words, as you'd tell a QA person. No file names, function names, collections or code: this section is the only
thing the blind tester learns about the change (qa/focus.mjs passes nothing else).

> ## For the tester
> Fleet managers can now retire a van from the van page (before, only owners could). A retired van keeps its
> history and can be brought back. Drivers still can't retire vans.

For new behaviour, **add** lines to `qa/FEATURES.md` (MUST for the product owner's rules, SHOULD for the rest), in
the section they belong to, from what the product owner asked. You may only add lines in a branch that changes the
app: changing or removing a line, or touching `qa/TESTER.md`, `qa/run.sh` and the other files `qa/guard.mjs` lists,
fails the Test workflow. That's deliberate: what the app must do isn't decided by the code that does it. If a line
is wrong or out of date, say so to the product owner and change it in a pull request of its own.

## 2. Cheap checks before pushing

```bash
npm run typecheck
npx expo export -p web
node --test tests/outbox.test.mjs tests/indexes.test.mjs tests/deploy.test.mjs tests/qa.test.mjs
node --import ./tests/alias.mjs --test tests/outline.test.mjs
```

## 3. A scripted test for the change

Every change gets a test that fails without it (say how you know: you ran it before the fix, or why it can't pass
without it):

- an access rule → `tests/rules.test.mjs` (every role, including what must fail);
- a server flow (handovers, history, joining, refuels) → `tests/history.test.mjs`;
- something on screen, offline, or that needs a real browser → `tests/offline.e2e.mjs` (Playwright on the emulators).

Claude's cloud sessions can't download the emulators: these run in CI only. Push, then watch the Test workflow:

```bash
gh api "repos/fratius/fleet-check/actions/runs?branch=$(git branch --show-current)&per_page=3" \
  --jq '.workflow_runs[] | [.name, .status, .conclusion, .html_url] | @tsv'
```

Don't say it's green until the run says so. Never skip, sleep or retry a flaky test to make it pass: find the cause,
or delete the test and write down why.

## 4. The blind tester

For anything people use (screens, roles, joining, handovers, damage, refuels, offline, languages), once the Test
workflow is green, ask for a blind run: it costs money (about $3 to $10), so once per pull request, not per push.

```bash
gh api repos/fratius/fleet-check/issues/<PR number>/labels -f 'labels[]=blind-qa'
```

The Blind QA workflow builds the app for the emulators, seeds a demo company with a sign-in per role and a rival
company (qa/seed.mjs), checks the basics work (scripts/live-check.mjs --emulators), and then an AI tester with only a
browser (no files, no shell, no code) tries to break it against qa/FEATURES.md. Its report comes back as a comment
on the pull request; screenshots and the transcript are in the run's artifact "blind-qa". The report's last lines say
whether the run was really blind; if not, the run doesn't count.

The product owner can also start it by hand: Actions > Blind QA > Run workflow, with the focus in his words.

## 5. Findings

For each finding:

1. **Reproduce it as a scripted test first** (step 3), and see it fail. A finding that becomes a test never needs an
   agent (or money) to be found again.
2. Fix it; the test passes.
3. If you think a finding is wrong (the tester misread the map, or hit a LIMIT), say why in the pull request. Never
   change qa/FEATURES.md or qa/TESTER.md to make a finding go away (the Test workflow stops that anyway).

**At most three rounds** of fix → Test → blind run. If findings are still open after the third, stop and tell the
product owner what's left, with the reports. Don't keep going on your own.

## 6. Say how it was verified

End the pull request body with:

```
## Verified
- Type checks, web build: passed
- Rules / history / offline tests: <run link>, passed (new: "<test name>")
- Blind QA: <run link>, 2 findings (F01 fixed + test "…", F02 not a bug: …)
- Not verified: <what wasn't: a real iPhone, the store app, real AI answers, payments…>
```

"Verified: none" is allowed, but it has to be written.

## 7. After the merge

Deploy runs the job **"The live app works for a real member"** (scripts/live-check.mjs): as the demo company's
fleet manager it uploads a photo, reads it back, lists the vans and asks the AI, on the live project. The emulators
can't catch a missing IAM role, index or AI key; this can. If it's red, the live app is broken now: say so first.
