#!/usr/bin/env bash
# The blind tester's run, inside `firebase emulators:exec` (the Blind QA workflow). Serves the web build, seeds the
# test world (qa/seed.mjs), then hands a browser to an AI tester that has never seen the code and can't: Claude
# Code with no built-in tools at all (no files, no shell), only a browser (Playwright MCP) that may reach the web
# app and the emulators, started in a folder with nothing but its photos. It gets qa/TESTER.md, the accounts and
# qa/FEATURES.md, and the focus. Its report and screenshots end up in $QA_DIR.
#
# Needs: APP_DIR (the web build for the emulators), QA_DIR (an empty folder outside the repo), QA_ANTHROPIC_KEY (the
# tester's Claude key; not called ANTHROPIC_API_KEY, so the functions emulator never sees it and keeps its made-up AI
# answers instead of calling the real AI).
# Optional: QA_FOCUS (plain words: what changed), QA_MODEL, QA_BUDGET_USD, QA_ACTIONS (rough number of browser
# actions to plan for), ANTHROPIC_CUSTOM_HEADERS.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
: "${APP_DIR:?APP_DIR must be the web build for the emulators}" "${QA_DIR:?QA_DIR must be an empty folder outside the repo}"
case "$QA_DIR" in "$REPO"*) echo "QA_DIR must be outside the repo: the tester's folder holds no code." >&2; exit 1;; esac
mkdir -p "$QA_DIR/shots"
export APP_URL="http://127.0.0.1:${QA_PORT:-8099}"

APP_DIR="$APP_DIR" node "$REPO/qa/serve.mjs" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "$APP_URL/" > /dev/null && break; sleep 1; done

QA_DIR="$QA_DIR" node "$REPO/qa/seed.mjs"

# Before paying for the tester: do the basics work? The same check Deploy runs on the live project
# (scripts/live-check.mjs): sign in, upload a photo, read it back, list the vans, ask the AI.
if ! node "$REPO/scripts/live-check.mjs" --emulators > "$QA_DIR/preflight.log" 2>&1; then
  cat "$QA_DIR/preflight.log"
  { printf '# Blind QA report\n\nVerdict: COULD NOT TEST\n\nThe basics failed on the emulators before the tester started, so it was not started:\n\n```\n'
    tail -n 25 "$QA_DIR/preflight.log"; printf '```\n'; } > "$QA_DIR/report.md"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || cat "$QA_DIR/report.md" >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi

# The browser: phone-sized Chrome (the runner's own) with a fake camera, allowed to reach only the web app and the
# emulators. File access stays inside $QA_DIR (Playwright MCP's default); file:// pages are blocked.
cat > "$QA_DIR/browser.json" << JSON
{
  "browser": {
    "browserName": "chromium",
    "isolated": true,
    "launchOptions": {
      "channel": "${QA_CHROME_CHANNEL:-chrome}",
      "headless": true,
      "args": ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
    },
    "contextOptions": {
      "viewport": { "width": 390, "height": 844 },
      "deviceScaleFactor": 2,
      "isMobile": true,
      "hasTouch": true,
      "locale": "en-GB",
      "timezoneId": "Europe/Berlin",
      "permissions": ["camera", "microphone"]
    }
  },
  "capabilities": ["core", "core-navigation", "core-tabs", "core-input", "network"],
  "network": {
    "allowedOrigins": ["$APP_URL", "http://127.0.0.1:9099", "http://127.0.0.1:8080", "http://127.0.0.1:5001", "http://127.0.0.1:9199"]
  },
  "outputDir": "$QA_DIR/shots",
  "timeouts": { "action": 10000, "navigation": 60000 }
}
JSON
cat > "$QA_DIR/mcp.json" << JSON
{ "mcpServers": { "browser": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.86", "--config", "$QA_DIR/browser.json"] } } }
JSON

# What the tester may do: look, click, type, choose photos, screenshots, tabs, console and network, the connection.
# Not: run code in the browser or in Node, record, or read and write files.
TOOLS=(navigate navigate_back snapshot find click type fill_form press_key select_option hover drag file_upload
  handle_dialog take_screenshot wait_for tabs resize console_messages network_requests network_request
  network_state_set emulate_media close)
ALLOWED=$(printf 'mcp__browser__browser_%s,' "${TOOLS[@]}")
# Playwright MCP offers these whatever its settings say, so they're taken away here: running code in Node or the
# page (that could read files or reach the emulators' admin side), faking the server's answers, dropping files.
NOT=(run_code_unsafe evaluate route route_list unroute drop)
DISALLOWED=$(printf 'mcp__browser__browser_%s,' "${NOT[@]}")

# The prompt: the brief, the accounts, the map and the focus. Nothing else.
{
  cat "$REPO/qa/TESTER.md"
  printf '\n\n---\n\n'
  cat "$QA_DIR/accounts.md"
  printf '\n\n---\n\n'
  cat "$REPO/qa/FEATURES.md"
  printf '\n\n---\n\n# Focus for this run\n\n%s\n' "${QA_FOCUS:-None given: test the whole app, starting with section 1 of the map.}"
  printf '\n# Budget\n\nPlan for about %s browser actions. When you have used about four fifths of them, stop testing and write the report.\n' "${QA_ACTIONS:-150}"
} > "$QA_DIR/prompt.md"

# The tester's own folder: only its photos, the browser's settings and what it writes (screenshots).
cd "$QA_DIR"
set +e
: "${QA_ANTHROPIC_KEY:?QA_ANTHROPIC_KEY must be set to the tester Claude key}"
ANTHROPIC_API_KEY="$QA_ANTHROPIC_KEY" claude -p "Do the QA run described below. Work only through the browser tools.

$(cat "$QA_DIR/prompt.md")" \
  --bare --tools "" --strict-mcp-config --mcp-config "$QA_DIR/mcp.json" \
  --allowedTools "${ALLOWED%,}" --disallowedTools "${DISALLOWED%,}" --permission-mode dontAsk \
  --model "${QA_MODEL:-claude-sonnet-5-5}" --max-budget-usd "${QA_BUDGET_USD:-8}" \
  --no-session-persistence --output-format stream-json --verbose < /dev/null > "$QA_DIR/transcript.jsonl" 2> "$QA_DIR/claude.log"
CODE=$?
set -e
echo "The tester finished (exit $CODE)."
node "$REPO/qa/report.mjs" "$QA_DIR"
