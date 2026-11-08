#!/bin/bash
# Launches the app on a booted simulator with screenshot-mode launch arguments and
# captures the screen. Requires a build that includes screenshot-mode.patch.
# Usage: shot.sh <simulator-udid> <output.png> <wait-seconds> [app args...]
#   app args: -shot Onboarding|Permissions|Camera|Settings|Gallery|Tips
set -euo pipefail
SIM=$1; out=$2; wait=$3; shift 3
xcrun simctl terminate "$SIM" com.felipenunes.pegueiapp 2>/dev/null || true
xcrun simctl launch "$SIM" com.felipenunes.pegueiapp "$@" >/dev/null
sleep "$wait"
xcrun simctl io "$SIM" screenshot "$out" >/dev/null 2>&1 && echo "ok $out"
