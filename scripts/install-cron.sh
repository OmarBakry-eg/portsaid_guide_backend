#!/usr/bin/env bash
# Install the launchd agent that runs the scraper every 6 hours.
#
#   bash scraper/scripts/install-cron.sh
#
# Before running, edit scraper/scripts/com.portsaid.scraper.plist to point
# GOOGLE_APPLICATION_CREDENTIALS at your service account JSON.

set -euo pipefail

PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.portsaid.scraper.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.portsaid.scraper.plist"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "✗ plist not found at $PLIST_SRC"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing version if loaded.
if launchctl list 2>/dev/null | grep -q '^[0-9-]*[[:space:]]*[0-9-]*[[:space:]]*com\.portsaid\.scraper'; then
  echo "→ unloading existing agent"
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DST"
echo "→ copied plist to $PLIST_DST"

launchctl load "$PLIST_DST"
echo "✓ launchd agent loaded — will run every 6h"
echo
echo "Useful commands:"
echo "  tail -F /tmp/portsaid-scraper.log         # watch the next run"
echo "  launchctl list | grep portsaid            # check it's loaded"
echo "  launchctl unload \"$PLIST_DST\"   # stop it"
