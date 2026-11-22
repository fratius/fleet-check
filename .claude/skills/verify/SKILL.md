---
name: verify
description: The loop every change to Fratius goes through, from the product owner's request to a pull request he can merge. Agree acceptance criteria with him first, code and document, a scripted test per criterion, the Test workflow, the blind tester checking his criteria (not your claims), fix and retest at most three rounds, then a hand-over with what to check on his phone. Use for any request that changes the app, from the first reply.
---

# The loop: from "I want x, y, z" to a pull request he can merge

The product owner asks for x, y, z. He wants it built, documented, checked by a tester that has never seen the code,
fixed until it does what he asked, and only then handed to him. He reviews evidence, not code. You run the whole loop
in one session and stop for him at three points only: **the criteria (step 1), after round 3 (step 6), the hand-over
(step 7)**. Everything runs on his Claude plan (this session and the tester's subscription token), never API credits.

Why it's built this way (the Claude Code team's own practice, Nov 2026): end-to-end tests are the hardest to fool;
a grader that didn't write the work catches what the author talks itself into; checks stay out of reach of the work
they check; a loop needs a stop.

## 1. Acceptance criteria first, approved by him (stop and ask)

Before any code, turn his request into numbered criteria, **A1, A2, …**, in his words, one testable thing each, as
what a person sees and does. Name the role in every one. Add what must **not** happen, and what must stay as it was.

> A1. A fleet manager can retire a van of their own station from the van page.
> A2. A driver doesn't see "Retire" and can't retire a van.
> A3. A manager can't retire a van of another station.
> A4. A retired van keeps its whole history and can be brought back.

Show them to him and ask: "Is this what you want? Anything missing or wrong?" Don't build until he says yes. His
"yes" is the definition of done: not your claim, not the code's behaviour. If he changes his mind later, the criteria
change first, and he approves them again.

Then:
- Add them to `qa/FEATURES.md` as new MUST lines in their section (add only; `qa/guard.mjs` refuses changes to
  existing lines in a branch that changes the app). If a criterion contradicts an existing line, or ROLES.md, say so
  in step 1; changing a rule is a pull request of its own.
- Open the pull request early with the section **`## For the tester`**: the approved criteria, word for word, with
  their ids. That section is all the blind tester learns about the change (`qa/focus.mjs`). No file names, functions
  or code in it.

## 2. Build, test, document

- Code the change. Follow AGENTS.md and ROLES.md.
- **One scripted test per criterion** that fails without the change: a rule → `tests/rules.test.mjs`; a server flow →
  `tests/history.test.mjs`; a screen, offline or a real browser → `tests/offline.e2e.mjs`. Name each test after its
  criterion ("A2: a driver can't retire a van").
- Document as you go, in the pull request (`## What changed`, for him: per role, what's new, what you decided and
  why, honest limits) and in the repo docs the change touches (ROLES.md, FLEET_DATA.md, AGENTS.md).
- Cheap checks before each push:

```bash
npm run typecheck
npx expo export -p web
node --test tests/outbox.test.mjs tests/indexes.test.mjs tests/deploy.test.mjs tests/qa.test.mjs
node --import ./tests/alias.mjs --test tests/outline.test.mjs
```

## 3. The Test workflow green

Push the branch (pushing a branch is not the gate; merging into main is, and only he merges). Claude's cloud
sessions can't run the emulators, so the rules, history and browser tests run in CI. Wait for them:

```bash
B=$(git branch --show-current)
gh api "repos/fratius/fleet-check/actions/runs?branch=$B&per_page=3" --jq '.workflow_runs[] | [.name, .status, .conclusion, .html_url] | @tsv'
```

Red: fix and push again (this doesn't count as a round). Never skip, sleep or retry a flaky test to make it pass.

## 4. The blind tester checks his criteria

```bash
gh api repos/fratius/fleet-check/issues/<PR>/labels -f 'labels[]=blind-qa'
```

It runs on his plan (secret `CLAUDE_CODE_OAUTH_TOKEN`), about 5 to 15 minutes. Wait for it (check the Blind QA run
every few minutes, or `send_later` yourself a check-in), then read its comment:

```bash
gh api "repos/fratius/fleet-check/issues/<PR>/comments?per_page=100" --jq '[.[] | select(.body | test("# Blind QA report"))] | last | .body'
```

The report has a verdict per criterion (PASS / FAIL / NOT TESTED), findings with steps and screenshots, and whether
the run was really blind. A run that wasn't blind doesn't count.

**Done** means: every criterion PASS, no blocker or major finding, the run blind. Then go to step 7.

## 5. Fix what failed (one round)

For each FAIL, NOT TESTED and blocker or major finding:
1. **Reproduce it as a scripted test first**, and see it fail in CI. A bug that became a test never needs the tester
   again.
2. Fix it; the test passes.
3. If you think the tester is wrong (it misread a criterion, or hit a LIMIT in the map), don't argue it away: write
   why in the pull request, and ask him in step 7. Never change qa/FEATURES.md, qa/TESTER.md or a criterion to make a
   finding go away.
4. NOT TESTED because the tester couldn't reach it (a LIMIT: phone app, real AI, payments): it goes on his phone
   list in step 7, not into another round.

Minor findings and nits: fix if quick, otherwise list them in step 7. Push, then back to step 3: that was one round.

## 6. Stop after three rounds (ask him)

If after the third blind run anything is still FAIL, or a blocker or major is open, stop. Tell him what's still
failing, what you tried, the three reports, and what you suggest (a different approach, a narrower criterion, or
accepting it). Don't start round four on your own.

## 7. Hand-over (he merges)

End the pull request with this, and send him the same in short:

```
## Verified
| Criterion | Blind tester | Scripted test |
|---|---|---|
| A1 … | PASS (run link) | "A1: …" passed |
| A2 … | PASS | "A2: …" passed |
- Rounds: 2 (round 1: A3 failed, a manager could retire another station's van: fixed, test "A3: …")
- Test workflow: <run link>, passed
- Not verified, check on your phone: <what the tester can't reach: the store app, the camera screen, notifications, real AI answers, payments>
- Open, your call: <minor findings left, tester findings you think are wrong and why>
```

Merging is his decision. After the merge, Deploy runs **"The live app works for a real member"**
(scripts/live-check.mjs) on the live project. If it's red, the live app is broken now: tell him first.
