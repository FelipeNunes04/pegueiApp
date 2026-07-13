# Peguei

Peguei is a React Native app that keeps a rolling circular buffer of camera video and lets you save the last N seconds by tapping a button — think of a boat/dashcam-style "catch the moment that already happened" flow, e.g. for landing a fish. Open the app, leave it running during the activity, and tap the record button whenever something happens; it saves the buffered seconds *before* the tap plus a short post-roll.

This is a **manual-only, 100% free** app in its current phase: one tap saves a clip, no voice commands, no subscription, no ads. See `BRAND.md` for the visual identity and tone of voice, `DECISIONS.md` for the reasoning behind non-obvious choices, and `BLOCKED.md` for the few things that genuinely need a human (not more engineering).

## Getting started

### 1. Install JS dependencies

```sh
yarn install
```

### 2. iOS setup

```sh
bundle install          # first time only, installs the pinned CocoaPods version
cd ios && pod install && cd ..
yarn ios                 # or open ios/VoiceCamBuffer.xcworkspace in Xcode
```

Note: `IPHONEOS_DEPLOYMENT_TARGET` is 16.0, required by the `AppIntents`-based Siri/Shortcuts integration — see `DECISIONS.md`.

### 3. Android setup

```sh
yarn android              # or open android/ in Android Studio
```

## Running on a physical device

Camera features do **not** work in the iOS Simulator (no camera hardware) and are unreliable on some Android emulators. To validate the actual recording flow:

- **iOS**: connect a device, select it as the Xcode/`react-native run-ios --device` destination, and make sure your Apple Developer team is set in the Xcode signing settings (Detox/CI can build for the simulator without this, but a physical run needs a signing identity).
- **Android**: enable USB debugging and run `yarn android` with the device connected (`adb devices` to confirm it's detected).

## Onboarding

A 4-screen onboarding flow (`src/screens/OnboardingScreen.tsx`) explains the buffer/tap-to-save concept before the permissions screen, shown once and gated by a persisted flag (`@react-native-async-storage/async-storage`). To see it again during development, clear the app's storage/reinstall, or clear AsyncStorage's `peguei:onboardingCompleted` key.

## System-level "open app" shortcuts

- **iOS**: an `AppIntent` (`OpenCameraIntent` in `ios/VoiceCamBuffer/OpenCameraIntent.swift`) is registered via `AppShortcutsProvider`, exposing "Abrir Peguei" to Siri and Spotlight. After installing the app once, users can also add a custom Siri phrase for it from the **Shortcuts** app (Settings are picked up automatically; no manual registration needed for the default phrases).
- **Android**: an App Action (`android/app/src/main/res/xml/actions.xml` + `shortcuts.xml`) maps Google Assistant's "open app feature" intent to a `peguei://camera` deep link on `MainActivity`. To test it locally, use the [App Actions Test Tool](https://developer.android.com/reference/app-actions-test-tool) (`aatt`) against the built APK, or trigger `adb shell am start -a android.intent.action.VIEW -d "peguei://camera" com.felipenunes.pegueiapp`.

## Testing

```sh
yarn test        # Jest: hooks, stores, utils, RNTL screen states
yarn lint        # ESLint
yarn tsc --noEmit
```

- Android native buffer logic: `cd android && ./gradlew testDebugUnitTest`
- iOS native buffer logic: `xcodebuild test -workspace ios/VoiceCamBuffer.xcworkspace -scheme VoiceCamBuffer -only-testing:VoiceCamBufferTests -destination 'platform=iOS Simulator,name=<a simulator you have>'`
- Detox E2E smoke test (requires a Metro server running in another terminal via `yarn start`, plus `brew install applesimutils` on macOS the first time):
  ```sh
  yarn e2e:build:ios
  yarn e2e:test:ios
  ```

## Other docs in this repo

- `BRAND.md` — palette, typography, tone of voice; source of truth for `src/theme/`.
- `/store-listing/` — App Store and Play Store copy (name/subtitle, description, keywords, screenshot text), PT-BR and EN-US.
- `/legal/` — draft Privacy Policy and Terms of Use (PT-BR and EN-US). **These are unreviewed drafts** — see the banner at the top of each file.

## Known limitations

- **No audio track in saved clips.** Clips are video-only (see `DECISIONS.md` → "Audio").
- **Camera doesn't work in the iOS Simulator.** Use a physical device to validate the actual buffering/recording flow.
- See `BLOCKED.md` for the Detox synchronization quirk and the on-device verification of the iOS/Android system shortcuts.
