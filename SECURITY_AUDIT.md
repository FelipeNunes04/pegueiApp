# Security audit — v1.1 pass (2026-07-15)

Detailed review of the app's attack surface as part of the v1.1 hardening/restructure pass. Confirms and extends the "low attack surface" summary in `AUDIT_REPORT.md` with concrete checks, not just a re-statement. ✅ = checked and clean, no change needed. 🔧 = real gap, fixed in this pass. ⚠️ = real gap, documented but intentionally not auto-fixed (needs the user's own credentials/decision).

## Dependencies

- ⚠️ `yarn npm audit` (and `yarn audit`) currently fail outright — Yarn's audit API endpoint was retired server-side (`YN0035`, HTTP 410) independent of this project. No local fix available; if a dependency audit is needed, use GitHub's Dependabot alerts on the repo (Settings → Code security) or generate a throwaway `package-lock.json` (`npm install --package-lock-only`) and run `npm audit` against that instead.

## Secrets / config

- ✅ No hardcoded secrets, API keys, or `process.env` usage anywhere in `src/`.
- ✅ `android/app/google-services.json` and `ios/**/GoogleService-Info.plist` are gitignored; injected at EAS build time via `scripts/eas-build-pre-install.sh`, which copies from EAS file-secret env vars without ever logging their contents.
- ✅ `android/app/debug.keystore` is intentionally tracked (`!debug.keystore` in `.gitignore`) — this is the standard, non-secret, universally-known Android debug key, fine to commit. No `*.keystore` for a real release key is tracked.

## Permissions

- ✅ `AndroidManifest.xml` / `Info.plist` permissions (`CAMERA`, `RECORD_AUDIO`/`NSMicrophoneUsageDescription`, storage/photo-library) all have live consumers verified via `src/hooks/usePermissions.ts` — none are declared-but-unused. (`RECORD_AUDIO`/microphone is legitimate here: it's for audio-in-video-clips, added after the wake-word feature — which *did* use the microphone for a different purpose — was already removed; not leftover cruft.)
- ✅ `android:allowBackup="false"` — recorded clips can't be extracted via `adb backup`.
- ✅ iOS `NSAppTransportSecurity`: `NSAllowsArbitraryLoads = false`. `NSAllowsLocalNetworking = true` is scoped to same-device/local-network traffic only (used by the Metro dev bundler in debug builds), not a general HTTP bypass.
- ✅ Android `usesCleartextTraffic` is a template placeholder (`${usesCleartextTraffic}`) resolved by the React Native Gradle Plugin itself, not by this project: confirmed in `@react-native/gradle-plugin`'s `AgpConfiguratorUtils.kt` that it sets `"true"` only for debuggable build types and `"false"` for release — verified correct, no override needed.
- ✅ `peguei://camera` deep link (`MainActivity`'s `VIEW`/`BROWSABLE` intent-filter, `OpenCameraIntent.swift` on iOS): reviewed both entry points — neither reads any intent extras/query data, they only foreground the app. Nothing for an external caller to manipulate.

## Native module bridge / file handling

- ✅ `src/native/CircularBufferModule.ts` — every JS→native call is either no-argument or a plain number (`setZoom(factor)`, `BufferConfig`'s numeric settings). No string/path ever crosses the bridge from JS.
- ✅ Android's `CameraEncoderController.kt` generates its own output filename (`File(moviesDir, "clip_${System.currentTimeMillis()}.mp4")`) — never accepts a JS-supplied filename, so there's no path-traversal vector there.
- ✅ `src/utils/files.ts`'s `deleteClip(path)` calls `RNFS.unlink(path)` on a path, but that path is only ever sourced from `listSavedClips()`'s own `RNFS.readDir(CLIPS_DIR)` output or from `SavedClip` objects built the same way — there's no free-text/user-controllable path input anywhere in the app (no Linking/deep-link parameter, no text field), so this isn't reachable with an attacker-chosen path.
- ✅ `src/utils/analytics.ts` — all 7 logged Firebase events carry only booleans/counts/enums (`duration_seconds`, `count`, `permission`, `status`) — no file paths, filenames, or other PII.
- ✅ Android `FileProvider` used for sharing (`react-native-share`'s bundled `RNShareFileProvider`) is `exported="false"` with `grantUriPermissions="true"`; its path scope (`cache-path path="/"`) is the library's own default, scoped to the app's cache directory only — not full external storage. Library-owned config, not something this app's code controls; residual risk is low and matches the library's own standard template.

## Build hardening

- 🔧 **Fixed**: `android/app/build.gradle` had `enableProguardInReleaseBuilds = false` — release builds shipped fully unminified/unobfuscated Kotlin bytecode (the custom camera native module source was trivially reversible from the APK). Flipped to `true` (R8/ProGuard now runs on `assembleRelease`). Could not fully verify a clean `assembleRelease` build in this environment — the local disk ran out of space mid-build (`fatal error: ... No space left on device`, unrelated to this change: it failed compiling an unrelated third-party native module's C++ codegen before minification was ever reached). This is a low-risk, standard AGP/R8 toggle (RN 0.86 + this dependency set is a well-trodden default-R8-rules path), but run `./gradlew assembleRelease` once locally with free disk space to confirm before shipping.
- ⚠️ **Not fixed, needs you**: `android/app/build.gradle`'s `release` build type has no real signing config — `signingConfig signingConfigs.debug`, i.e. it signs with the shared, publicly-known Android debug key. There's no `build:android`/`submit:android` in `package.json` today (only iOS EAS scripts exist), so this likely isn't in the current shipping path — but if/when an Android release build or Play Store submission happens, it needs a real keystore (either a project-owned one referenced via `signingConfigs.release` reading from `gradle.properties`/env vars, or EAS-managed credentials the same way iOS already does). Not fabricating a keystore here since that's a credential decision that's yours to make, not something to guess.

## Summary

One real hardening gap fixed (release minification). One real gap documented but deliberately left for you (Android release signing — no shippable keystore exists yet, and generating one isn't this pass's call to make). Everything else checked came back clean — the app's overall attack surface remains small: no network calls, no secrets in source, centralized/verified permission usage, and no reachable path-traversal or PII-leak vectors in the file/analytics code paths.
