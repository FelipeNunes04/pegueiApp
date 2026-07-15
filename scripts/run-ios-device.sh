#!/usr/bin/env bash
# Build and run the iOS app on a connected physical device.
#
# Usage:
#   yarn ios:device                # auto-detect the connected device
#   yarn ios:device "iPhone Name"  # target a device by name (substring match)
#   yarn ios:device <UDID>         # target a device by UDID

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"

devices=$(xcrun xctrace list devices 2>&1 \
  | sed -n '/== Devices ==/,/== Simulators ==/p' \
  | grep -iE 'iphone|ipad|ipod')

if [ -z "$devices" ]; then
  echo "No physical iOS device found. Plug in an iPhone/iPad, unlock it, and trust this Mac." >&2
  exit 1
fi

if [ -n "$TARGET" ]; then
  match=$(echo "$devices" | grep -i "$TARGET" || true)
  if [ -z "$match" ]; then
    echo "No connected device matches \"$TARGET\". Available devices:" >&2
    echo "$devices" >&2
    exit 1
  fi
  device_count=$(echo "$match" | wc -l | tr -d ' ')
  if [ "$device_count" -gt 1 ]; then
    echo "Multiple devices match \"$TARGET\", be more specific:" >&2
    echo "$match" >&2
    exit 1
  fi
  udid=$(echo "$match" | grep -oE '\(([A-F0-9-]+)\)$' | tr -d '()')
else
  device_count=$(echo "$devices" | wc -l | tr -d ' ')
  if [ "$device_count" -gt 1 ]; then
    echo "Multiple devices connected, pass a name or UDID to pick one:" >&2
    echo "$devices" >&2
    exit 1
  fi
  udid=$(echo "$devices" | grep -oE '\(([A-F0-9-]+)\)$' | tr -d '()')
fi

echo "Running on: $(echo "$devices" | grep "$udid")"
npx react-native run-ios --udid "$udid"
