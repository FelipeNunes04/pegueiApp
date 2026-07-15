#!/usr/bin/env bash
# EAS Build hook (see package.json's "eas-build-pre-install" script): the
# Firebase config files are gitignored (they're tied to a specific Firebase
# project) and instead stored as EAS file-type secret env vars
# (GOOGLE_SERVICE_INFO_PLIST / GOOGLE_SERVICES_JSON), which EAS materializes
# to a local path at build time. This copies them into the paths the Xcode
# project / Gradle google-services plugin expect before the native build runs.
set -euo pipefail

if [ -n "${GOOGLE_SERVICE_INFO_PLIST:-}" ] && ! [ "$GOOGLE_SERVICE_INFO_PLIST" -ef ios/Peguei/GoogleService-Info.plist ]; then
  cp "$GOOGLE_SERVICE_INFO_PLIST" ios/Peguei/GoogleService-Info.plist
  echo "eas-build-pre-install: copied GoogleService-Info.plist into ios/Peguei/"
fi

if [ -n "${GOOGLE_SERVICES_JSON:-}" ] && ! [ "$GOOGLE_SERVICES_JSON" -ef android/app/google-services.json ]; then
  cp "$GOOGLE_SERVICES_JSON" android/app/google-services.json
  echo "eas-build-pre-install: copied google-services.json into android/app/"
fi
