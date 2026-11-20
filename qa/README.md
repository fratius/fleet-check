# Checking the work: the blind tester and the live check

Three layers, each catching what the one before can't:

| Layer | What it is | When | Catches | Costs |
|---|---|---|---|---|
| Scripted tests | Rules, history end to end, offline in a browser, all on the emulators (tests/) | Every push (Test), every Deploy | What we already know can break: 322 rule checks, 27 flows | Free |
| **Blind tester** | An AI that has never seen the code tries to break the app through a phone-sized browser, against [FEATURES.md](FEATURES.md) | On request: label `blind-qa` on a pull request, or Actions > Blind QA | What nobody thought to script: role leaks, double taps, odd input, offline mid-step, broken translations | About $3 to $10 a run (Sonnet), capped at $8 by default |
| **Live check** | As the demo company's fleet manager on the live project: upload a photo, read it back, list the vans, ask the AI ([scripts/live-check.mjs](../scripts/live-check.mjs)) | After every Deploy | What the emulators can't see: missing permissions, indexes, a refused AI key (the 11 Nov upload outage) | About $0.0005 |

## The blind tester

- **What it knows:** [TESTER.md](TESTER.md) (how to work, what counts as a finding, the report's shape), the
  accounts and probe addresses from [seed.mjs](seed.mjs), [FEATURES.md](FEATURES.md), and the pull request's
  `## For the tester` section. Nothing else: no code, no file names, no pull request text beyond that section.
- **What it can do:** only a browser (Playwright MCP, phone-sized Chrome with a fake camera) that reaches the web app
  and the emulators. Claude Code runs with no built-in tools at all (no files, no shell), in a folder outside the
  repo; running code in the page or in Node and faking server answers are taken away. Every report ends with a line
  saying whether that held for the run (the tool list it really had).
- **The world it tests in:** the emulators with the demo company (two stations, a month of history), a sign-in per
  role (app creator, owner, a manager and a driver at each station), and a rival company. All thrown away after the
  run; no test sign-in exists in the live project. The AI answers are made up on the emulators, so it judges the
  flows, not the AI.
- **What it doesn't cover:** the App Store and Google Play apps (camera screen, phone notifications), real AI
  answers, payments, emails.
- **It doesn't block merges** yet (observe mode). Make it a required check only once its findings have been right
  for a few weeks.

## The rules that keep it honest

- **The brief and the map aren't the code's to change.** A branch that changes the app can't change TESTER.md,
  the run setup or the verify skill, and may only **add** lines to FEATURES.md ([guard.mjs](guard.mjs), in the Test
  workflow). The workflow also takes TESTER.md from main.
- **Findings become scripted tests** before they're fixed, so the same bug never costs a blind run twice.
- **Three rounds**, then a person decides (the `verify` skill, `.claude/skills/verify/SKILL.md`).

## Setting it up (once)

1. Optional but recommended: a separate Anthropic key for the tester, as the secret `QA_ANTHROPIC_API_KEY`
   (Settings > Secrets and variables > Actions), so its spend shows apart from the app's AI. Without it the workflow
   uses `ANTHROPIC_API_KEY`. A key that works in several workspaces needs the variable `QA_ANTHROPIC_WORKSPACE_ID`
   (or `ANTHROPIC_WORKSPACE_ID`).
2. For the live check: a demo company in the live app (Account > Demo company, as the app creator). Without one,
   Deploy says so and skips the check.

## Running it

- On a pull request: add the label `blind-qa`. The report comes back as a comment; the label is taken off so you can
  add it again.
- By hand: Actions > Blind QA > Run workflow, pick the branch, write what changed as you'd tell a tester, pick the
  model (Opus finds more, costs about twice as much) and the most it may spend.
