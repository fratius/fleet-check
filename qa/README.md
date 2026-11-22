# Checking the work: the blind tester and the live check

Three layers, each catching what the one before can't:

| Layer | What it is | When | Catches | Costs |
|---|---|---|---|---|
| Scripted tests | Rules, history end to end, offline in a browser, all on the emulators (tests/) | Every push (Test), every Deploy | What we already know can break: 322 rule checks, 27 flows | Free |
| **Blind tester** | An AI that has never seen the code tries to break the app through a phone-sized browser, against [FEATURES.md](FEATURES.md) | Every change, in the loop of the `verify` skill (label `blind-qa`), or Actions > Blind QA | Whether the product owner's approved criteria really hold, and what nobody scripted: role leaks, double taps, odd input, offline mid-step | The product owner's Claude plan usage (5 to 15 minutes a run; $0.40 to $1 at API prices on the first 8 runs), no API credits |
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

1. On your computer: `claude setup-token` (signs in with your Claude subscription and prints a token). Save it as the
   secret `CLAUDE_CODE_OAUTH_TOKEN` (GitHub > Settings > Secrets and variables > Actions). The tester then runs on your
   plan's usage, never API credits. The token lasts about a year; make a new one when runs say it was refused.
2. For the live check: a demo company in the live app (Account > Demo company, as the app creator). Without one,
   Deploy says so and skips the check.

## Running it

- On a pull request: add the label `blind-qa`. The report comes back as a comment; the label is taken off so you can
  add it again.
- By hand: Actions > Blind QA > Run workflow, pick the branch, write what changed as you'd tell a tester, pick the
  model (Opus finds more and uses more of your plan).
