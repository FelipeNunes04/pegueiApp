#!/usr/bin/env bash
# Muda a versão semântica (ex.: 1.3.0) em package.json, no projeto iOS
# (MARKETING_VERSION) e no Android (versionName).
#
# O número de build NÃO é mudado aqui: o eas.json usa
# "appVersionSource": "remote" e "autoIncrement": true nos perfis staging e
# prod, então o EAS incrementa o buildNumber (iOS) e o versionCode (Android)
# a cada build. Para ver ou acertar o número atual:
#   npx eas-cli build:version:get -p ios
#   npx eas-cli build:version:set -p android
#
# Uso: scripts/bump-version.sh 1.3.0
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: $0 X.Y.Z" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.version = process.argv[1];
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$version"
sed -i '' -E "s/MARKETING_VERSION = [0-9]+\.[0-9]+\.[0-9]+;/MARKETING_VERSION = ${version};/g" ios/Peguei.xcodeproj/project.pbxproj
sed -i '' -E "s/versionName \"[0-9]+\.[0-9]+\.[0-9]+\"/versionName \"${version}\"/" android/app/build.gradle

echo "Versão ${version} em package.json, iOS e Android."
echo "Lembre de adicionar a entrada no CHANGELOG.md."
