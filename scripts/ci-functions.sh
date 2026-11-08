#!/usr/bin/env bash
# Installs the functions' packages in CI, trying again when a download fails: ffmpeg-static fetches its binary from
# GitHub's release downloads, which sometimes answer 504 for a while.
set -uo pipefail
for i in 1 2 3 4 5 6; do
  npm ci --prefix functions && exit 0
  [ "$i" = 6 ] && break
  echo "::warning title=Install::npm ci --prefix functions failed (try $i); trying again in $((i * 30)) s."
  sleep $((i * 30))
done
exit 1
