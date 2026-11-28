#!/usr/bin/env bash
# Checagem antes de cada build de teste ou de loja. Para no primeiro erro.
#
#   1. typecheck (tsc), lint e testes
#   2. segredos: arquivos sensíveis no git, chaves no repositório e no bundle JS
#   3. arquivos do Firebase (projeto pegueiapp-9d2bb, ids do app)
#   4. permissões declaradas x usadas (Android e iOS)
#
# Uso: yarn preflight            (tudo)
#      SKIP_TESTS=1 yarn preflight   (pula tsc/lint/testes, ex.: já rodou)
#      SKIP_BUNDLE=1 yarn preflight  (pula a geração do bundle JS)
set -uo pipefail
cd "$(dirname "$0")/.."

FIREBASE_PROJECT="pegueiapp-9d2bb"
APP_ID="com.felipenunes.pegueiapp"

failures=0
warnings=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
warn() { printf '  \033[33maviso\033[0m %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf '  \033[31mERRO\033[0m %s\n' "$1"; failures=$((failures + 1)); }
section() { printf '\n== %s ==\n' "$1"; }

yarn_cmd() {
  if command -v yarn >/dev/null 2>&1; then yarn "$@"; else node .yarn/releases/yarn-*.cjs "$@"; fi
}

# ---------------------------------------------------------------------------
section "1. TypeScript, lint e testes"
if [ "${SKIP_TESTS:-}" = "1" ]; then
  warn "SKIP_TESTS=1: tsc, lint e testes não rodaram"
else
  if npx tsc --noEmit; then ok "tsc sem erros"; else fail "tsc encontrou erros"; fi
  if yarn_cmd lint >/dev/null; then ok "lint sem erros"; else fail "lint encontrou erros (rode yarn lint)"; fi
  if yarn_cmd test --silent >/dev/null 2>&1; then ok "testes passaram"; else fail "testes falharam (rode yarn test)"; fi
fi

# ---------------------------------------------------------------------------
section "2. Segredos"
# Arquivos que nunca podem ir para o git.
for f in credentials.json google-play-service-account.json android/app/google-services.json ios/Peguei/GoogleService-Info.plist; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    fail "$f está no git. Rode: git rm --cached $f"
  elif [ -e "$f" ] && ! git check-ignore -q "$f"; then
    fail "$f existe e não está no .gitignore"
  else
    ok "$f fora do git"
  fi
done
tracked_secrets=$(git ls-files | grep -Ei '\.(p8|p12|pem|jks|mobileprovision)$|(^|/)[^/]*\.keystore$' | grep -v '^android/app/debug.keystore$' || true)
if [ -n "$tracked_secrets" ]; then fail "chaves ou certificados no git: $tracked_secrets"; else ok "nenhuma chave/certificado no git"; fi

SECRET_PATTERN='-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|"private_key"[[:space:]]*:|"type"[[:space:]]*:[[:space:]]*"service_account"|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{20,}|ghp_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|EXPO_TOKEN=[A-Za-z0-9_-]{20,}'
repo_hits=$(git ls-files -z | grep -zv -E '^(yarn\.lock|scripts/preflight\.sh)$' | xargs -0 grep -lIE -e "$SECRET_PATTERN" 2>/dev/null || true)
if [ -n "$repo_hits" ]; then fail "possível segredo em arquivos do git: $repo_hits"; else ok "nenhum segredo nos arquivos do git"; fi

if [ "${SKIP_BUNDLE:-}" = "1" ]; then
  warn "SKIP_BUNDLE=1: bundle JS não verificado"
else
  tmp=$(mktemp -d)
  if npx react-native bundle --platform android --dev false --entry-file index.js \
      --bundle-output "$tmp/index.bundle" --assets-dest "$tmp/assets" >/dev/null 2>&1; then
    # Também pega chaves de API do Google (AIza...): elas só podem estar nos
    # arquivos do Firebase, nunca no bundle.
    if grep -qE -e "$SECRET_PATTERN|AIza[0-9A-Za-z_-]{35}" "$tmp/index.bundle"; then
      fail "possível segredo no bundle JS ($tmp/index.bundle)"
    else
      ok "bundle JS sem segredos"
      rm -rf "$tmp"
    fi
  else
    fail "não foi possível gerar o bundle JS (npx react-native bundle)"
  fi
fi

# ---------------------------------------------------------------------------
section "3. Firebase"
plist=ios/Peguei/GoogleService-Info.plist
if [ -f "$plist" ]; then
  pid=$(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$plist" 2>/dev/null || true)
  bid=$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$plist" 2>/dev/null || true)
  [ "$pid" = "$FIREBASE_PROJECT" ] && ok "iOS: PROJECT_ID $pid" || fail "iOS: PROJECT_ID '$pid' (esperado $FIREBASE_PROJECT)"
  [ "$bid" = "$APP_ID" ] && ok "iOS: BUNDLE_ID $bid" || fail "iOS: BUNDLE_ID '$bid' (esperado $APP_ID)"
else
  warn "iOS: $plist não existe aqui (no EAS vem da variável GOOGLE_SERVICE_INFO_PLIST)"
fi
json=android/app/google-services.json
if [ -f "$json" ]; then
  if node -e '
    const j = require("./" + process.argv[1]);
    const okProject = j.project_info && j.project_info.project_id === process.argv[2];
    const okPkg = (j.client || []).some(c => c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name === process.argv[3]);
    process.exit(okProject && okPkg ? 0 : 1);
  ' "$json" "$FIREBASE_PROJECT" "$APP_ID"; then
    ok "Android: $json do projeto $FIREBASE_PROJECT com $APP_ID"
  else
    fail "Android: $json não é do projeto $FIREBASE_PROJECT ou não tem $APP_ID"
  fi
else
  warn "Android: $json não existe aqui (no EAS vem da variável GOOGLE_SERVICES_JSON)"
fi
grep -q '"google_analytics_adid_collection_enabled": false' firebase.json && ok "firebase.json: sem ID de publicidade" || fail "firebase.json: ligue google_analytics_adid_collection_enabled=false"
grep -q 'RNFirebaseAnalyticsWithoutAdIdSupport' ios/Podfile && ok "Podfile: Analytics sem IDFA" || fail "Podfile: falta \$RNFirebaseAnalyticsWithoutAdIdSupport = true"

# ---------------------------------------------------------------------------
section "4. Permissões declaradas x usadas"
manifest=android/app/src/main/AndroidManifest.xml
# permissão -> padrão que prova o uso no código nativo ou JS
declare_usage() {
  case "$1" in
    android.permission.INTERNET) echo 'firebase|https://' ;;
    android.permission.ACCESS_NETWORK_STATE) echo 'ConnectivityManager' ;;
    android.permission.VIBRATE) echo 'Vibration\.vibrate' ;;
    android.permission.CAMERA) echo 'CameraManager|openCamera' ;;
    android.permission.RECORD_AUDIO) echo 'AudioRecord' ;;
    android.permission.FOREGROUND_SERVICE) echo 'startForeground' ;;
    android.permission.FOREGROUND_SERVICE_CAMERA) echo 'FOREGROUND_SERVICE_TYPE_CAMERA' ;;
    android.permission.FOREGROUND_SERVICE_MICROPHONE) echo 'FOREGROUND_SERVICE_TYPE_MICROPHONE' ;;
    android.permission.POST_NOTIFICATIONS) echo 'requestNotifications' ;;
    android.permission.WAKE_LOCK) echo 'WakeLock|FLAG_KEEP_SCREEN_ON|keepScreenOn' ;;
    *) echo '' ;;
  esac
}
declared=$(grep -E '<uses-permission ' "$manifest" | grep -v 'tools:node="remove"' | sed -E 's/.*android:name="([^"]+)".*/\1/')
for perm in $declared; do
  pattern=$(declare_usage "$perm")
  if [ -z "$pattern" ]; then
    fail "Android: $perm declarada sem justificativa (adicione em scripts/preflight.sh ou remova)"
  elif grep -rqE "$pattern" android/app/src/main src App.tsx 2>/dev/null; then
    ok "Android: $perm usada"
  else
    fail "Android: $perm declarada mas não usada"
  fi
done
for removed in com.google.android.gms.permission.AD_ID android.permission.ACCESS_ADSERVICES_AD_ID android.permission.ACCESS_ADSERVICES_ATTRIBUTION; do
  grep -q "$removed\" tools:node=\"remove\"" "$manifest" && ok "Android: $removed removida" || fail "Android: $removed não está com tools:node=\"remove\""
done
merged=$(ls android/app/build/intermediates/merged_manifests/release/*/AndroidManifest.xml android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml 2>/dev/null | head -1 || true)
if [ -n "$merged" ]; then
  bad=$(grep -oE 'android.permission.(ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|READ_PHONE_STATE|READ_MEDIA_[A-Z_]+)|com.google.android.gms.permission.AD_ID' "$merged" | sort -u || true)
  [ -z "$bad" ] && ok "Android (manifesto final do release): nenhuma permissão inesperada" || fail "Android: o manifesto final traz $bad"
else
  warn "Android: manifesto final do release não encontrado (rode ./gradlew :app:processReleaseMainManifest para checar as libs)"
fi

plist_info=ios/Peguei/Info.plist
ios_usage() {
  case "$1" in
    NSCameraUsageDescription) echo 'AVCaptureDevice' ;;
    NSMicrophoneUsageDescription) echo 'AVCaptureAudioDataOutput|AVAudioSession' ;;
    NSPhotoLibraryAddUsageDescription|NSPhotoLibraryUsageDescription) echo 'react-native-share' ;;
    *) echo '' ;;
  esac
}
ios_keys=$(grep -oE 'NS[A-Za-z]+UsageDescription' "$plist_info" | sort -u)
for key in $ios_keys; do
  pattern=$(ios_usage "$key")
  if [ -z "$pattern" ]; then
    fail "iOS: $key declarada sem justificativa"
  elif grep -rqE "$pattern" ios/CircularBuffer ios/Export ios/Peguei package.json 2>/dev/null; then
    ok "iOS: $key usada"
  else
    fail "iOS: $key declarada mas não usada"
  fi
done
if grep -q 'NSUserTrackingUsageDescription' "$plist_info"; then fail "iOS: NSUserTrackingUsageDescription presente (o Peguei não usa ATT)"; else ok "iOS: sem App Tracking Transparency"; fi
if grep -A1 'NSPrivacyTracking<' ios/Peguei/PrivacyInfo.xcprivacy | grep -q '<false/>'; then ok "iOS: PrivacyInfo NSPrivacyTracking = false"; else fail "iOS: PrivacyInfo deve ter NSPrivacyTracking = false"; fi
if grep -q 'NSPrivacyAccessedAPICategoryDiskSpace' ios/Peguei/PrivacyInfo.xcprivacy; then ok "iOS: PrivacyInfo declara o uso de espaço em disco (E174.1)"; else fail "iOS: PrivacyInfo sem NSPrivacyAccessedAPICategoryDiskSpace"; fi

# ---------------------------------------------------------------------------
printf '\n'
if [ "$failures" -gt 0 ]; then
  printf '\033[31mPreflight falhou: %d erro(s), %d aviso(s).\033[0m\n' "$failures" "$warnings"
  exit 1
fi
printf '\033[32mPreflight ok\033[0m (%d aviso(s)).\n' "$warnings"
