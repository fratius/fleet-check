#!/usr/bin/env bash
# The Android test version on the website (fratius.com/android), for the pilot DSPs until Fratius is in Google Play.
#
# Puts the newest Android test app into website/downloads/ before the website is deployed (Deploy, "Web app" job):
#   fratius-android.apk   the app (EAS build profile "preview": an .apk on the "production" update channel)
#   android.json          its version, build number, size and date; the download page and the app read it
#                         (src/lib/apk.ts: a phone on an older version shows "Download")
# The file comes from the newest finished "preview" Android build on EAS (needs EXPO_TOKEN and eas). If that can't
# be downloaded (no token, EAS down, an expired download link), the file the website serves now is kept, so a
# deploy never takes the download away. Without either, the page says the test version isn't ready yet.
#
# When Fratius is in Google Play: delete website/android.html and this step (store/README.md, "Android test version").
#
# Usage: SITE=fratius-web scripts/website-apk.sh
set -uo pipefail

OUT=website/downloads
APK=$OUT/fratius-android.apk
INFO=$OUT/android.json
# Where the website serves it now (APK_LIVE_URL: another address, for trying this script).
LIVE="${APK_LIVE_URL:-https://${SITE:-fratius-web}.web.app}/downloads"
TMP=$(mktemp -d)
mkdir -p "$OUT"
rm -f "$APK" "$INFO"

# An Android app is a zip with the manifest in it; anything else (an error page, half a file) is refused.
is_apk() { [ "$(stat -c %s "$1" 2>/dev/null || echo 0)" -gt 1000000 ] && unzip -l "$1" 2>/dev/null | grep -q ' AndroidManifest.xml$'; }

from_eas() {
  [ -n "${EXPO_TOKEN:-}" ] && command -v eas > /dev/null || { echo "No EXPO_TOKEN or eas: not asking EAS for the Android test app."; return 1; }
  eas build:list --platform android --build-profile preview --status finished --limit 1 --json --non-interactive \
    > "$TMP/builds.json" 2> "$TMP/eas.log" || { echo "eas build:list failed:"; tail -n 5 "$TMP/eas.log"; return 1; }
  local url version code at sha
  url=$(jq -r '.[0].artifacts.applicationArchiveUrl // .[0].artifacts.buildUrl // empty' "$TMP/builds.json")
  [ -n "$url" ] || { echo "EAS has no finished Android test build (profile preview) yet."; return 1; }
  version=$(jq -r '.[0].appVersion // empty' "$TMP/builds.json")
  code=$(jq -r '.[0].appBuildVersion // empty' "$TMP/builds.json")
  at=$(jq -r '.[0].completedAt // .[0].updatedAt // empty' "$TMP/builds.json")
  sha=$(jq -r '.[0].gitCommitHash // empty | .[0:7]' "$TMP/builds.json")
  curl -sfL --retry 3 --max-time 600 -o "$APK" "$url" || { echo "Couldn't download the build from EAS."; rm -f "$APK"; return 1; }
  is_apk "$APK" || { echo "What EAS gave isn't an Android app."; rm -f "$APK"; return 1; }
  jq -n --arg version "$version" --arg code "$code" --arg at "$at" --arg sha "$sha" --argjson size "$(stat -c %s "$APK")" \
    '{version: $version, build: $code, size: $size, at: $at, sha: $sha, file: "/downloads/fratius-android.apk"}' > "$INFO"
  echo "Android test app $version (build $code, $sha) from EAS."
}

from_live() {
  curl -sfL --retry 2 --max-time 30 -o "$TMP/live.json" "$LIVE/android.json" || { echo "The website has no Android test app yet."; return 1; }
  jq -e '.version' "$TMP/live.json" > /dev/null 2>&1 || return 1
  curl -sfL --retry 3 --max-time 600 -o "$APK" "$LIVE/fratius-android.apk" || { rm -f "$APK"; return 1; }
  is_apk "$APK" || { rm -f "$APK"; return 1; }
  cp "$TMP/live.json" "$INFO"
  echo "Kept the Android test app the website already had ($(jq -r .version "$INFO"), build $(jq -r .build "$INFO"))."
}

if from_eas || from_live; then
  {
    echo "### Android test app"
    echo "Version $(jq -r .version "$INFO") (build $(jq -r .build "$INFO")), $(( $(jq -r .size "$INFO") / 1048576 )) MB: https://fratius.com/android"
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  rm -f "$APK" "$INFO"
  echo "::notice title=Android test app::None on the website yet: fratius.com/android says it isn't ready. Make one with Actions > Store build, platform android, profile preview (store/README.md, \"Android test version\")."
fi
rm -rf "$TMP"
exit 0
