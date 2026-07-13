# Blocked

Things I genuinely could not complete myself, with the specific reason and what's needed to unblock. Everything else in the audit checklist was completed or is tracked as a known limitation in `AUDIT_REPORT.md` / `DECISIONS.md` instead of here.

## 1. Detox smoke test: assertions blocked by an animation-synchronization quirk

**Update (2026-07-11):** the original wake-word feature and its `WaveformListening` "Ouvindo..." indicator no longer exist in this codebase at all (removed at some point before this pass — see `DECISIONS.md` → "Wake word (removed)"). The description below is kept for the *underlying Detox mechanism*, which likely still applies to `BufferIndicator`'s pulsing dot (an intentional infinite `Animated.loop` shown whenever `phase === 'buffering'`, which is the default state once permissions are granted) — but this wasn't re-verified against a simulator in this pass, since Detox wasn't run again. Treat the specific component name below as historical, and the general risk (infinite native-driven `Animated.loop` + Detox's default sync) as still live.

**What's blocked:** `e2e/smoke.test.ts`'s two test cases previously failed/timed out — not because the app is broken, but because Detox's default synchronization mechanism never considers the app "idle" while a decorative bar/dot animation (`Animated.loop`, intentionally infinite while a status indicator is in its active state) is running.

**Why I couldn't fully resolve it:** I confirmed via a direct simulator screenshot (manual `xcrun simctl launch` + `simctl io screenshot`) that the app itself renders correctly (PermissionsScreen shown, no crash, no red box). I tried the two standard fixes:
- `device.disableSynchronization()` called after `launchApp()` — too late, `launchApp()` itself never resolves because it also waits on the same synchronization handshake.
- `device.disableSynchronization()` called before `launchApp()` — Detox rejects this because the synchronization channel requires an already-connected app instance, which doesn't exist yet.

Both are legitimate, commonly-hit Detox limitations with continuously-running native-driven `Animated` loops; resolving it "properly" means either patching Detox's own native sync framework, or restructuring the status indicator to not use an infinite `Animated.loop` (a real product/UX tradeoff I didn't want to make unilaterally).

**What I did instead:** Verified the *entire rest* of the Detox pipeline actually works end-to-end against a real simulator — `detox build`, app install, launch, WebSocket connection, and simulator-level permission granting (`xcrun simctl privacy` / `applesimutils`) all succeeded. This is how I found and fixed two real pre-existing native bugs (missing `setup_permissions` in the Podfile, missing `@objc dynamic` on `CircularBufferPreviewView.isActive`) — see `DECISIONS.md`. `applesimutils` was installed via Homebrew (`brew tap wix/brew && brew install applesimutils`) to make this possible.

**To unblock:** Either accept a bounded/finite version of the buffering indicator's animation (a small UX call), or have someone more familiar with Detox's native sync internals patch around it. This is a "your call" item since it trades test-tooling convenience against a UI detail — happy to implement whichever direction you prefer.

## 2. Full device/store-level verification of App Intents (iOS) and App Actions (Android)

**What's blocked:** I could not verify `OpenCameraIntent`/`PegueiShortcuts` actually surface in Siri/Spotlight, nor that the Android App Action is recognized by Google Assistant, beyond confirming they compile and merge into the built app/manifest correctly (`ExtractAppIntentsMetadata` ran successfully during the iOS build; the merged `AndroidManifest.xml` contains the `com.google.android.actions` meta-data).

**Why:** Siri/Spotlight indexing and Google Assistant's App Actions recognition both require either a physical device signed into an Apple ID / Google account, or Google's own **App Actions Test Tool** (`aatt`) run against a Play-Console-registered build — neither is available in this sandboxed environment.

**To unblock:** Test on a physical device (iOS: say "Hey Siri, abrir Peguei" after installing; Android: use `aatt` per the link in `README.md`, or `adb shell am start -a android.intent.action.VIEW -d "peguei://camera" com.peguei.app` as a manual proxy for the deep link half of it).
