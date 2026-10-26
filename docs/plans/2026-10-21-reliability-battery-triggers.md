# Reliability + battery + hardware triggers (2026-10-21)

Working plan shared by the parallel implementation passes. DECISIONS.md is
updated once at the end by the integrator, not by each pass.

## Bridge contract (both platforms implement exactly this)

New `CircularBufferModule` methods:

| Method | iOS | Android |
|---|---|---|
| `setPocketMode(enabled: boolean): Promise<void>` | Saves/restores `UIScreen.main.brightness` (dims to ~0.01 when enabled), disables the preview layer connection (`previewLayer.connection?.isEnabled = false`) so nothing is composited, re-enables on exit. Capture/encode keeps running untouched. | Sets the Activity window `screenBrightness` to ~0.01f (restore `BRIGHTNESS_OVERRIDE_NONE` on exit) and drops the preview target from the repeating request (same `setPreviewTargetIncluded` path background mode uses); re-adds it on exit. |
| `setHardwareTriggerEnabled(enabled: boolean): Promise<void>` | Attaches/detaches an `AVCaptureEventInteraction` (iOS 17.2+, `#available`-guarded; no-op below) to the preview view. Volume up/down and the Camera Control button emit a trigger on the `.ended` phase. | Gates whether `MainActivity.dispatchKeyEvent` intercepts `KEYCODE_VOLUME_UP`, `KEYCODE_VOLUME_DOWN`, `KEYCODE_CAMERA`, `KEYCODE_HEADSETHOOK`, `KEYCODE_MEDIA_PLAY_PAUSE`, `KEYCODE_MEDIA_PLAY`, `KEYCODE_ENTER` (cheap Bluetooth shutter remotes send VOLUME_UP or ENTER) while buffering. Only `ACTION_UP` with `repeatCount == 0` emits; `ACTION_DOWN` is consumed so the volume doesn't change. |
| `isIgnoringBatteryOptimizations(): Promise<boolean>` | Always resolves `true`. | `PowerManager.isIgnoringBatteryOptimizations(packageName)`. |
| `openBatteryOptimizationSettings(): Promise<void>` | Resolves (no-op). | Opens `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`; falls back to `ACTION_APPLICATION_DETAILS_SETTINGS` for this package. Do NOT use `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Play policy). |

New events (iOS must add them to `supportedEvents()`):

- `CircularBufferHealth` — `{ state: 'healthy' | 'recovering' | 'interrupted' | 'throttled', reason?: string }`. Emitted only on transitions. `interrupted` = OS interruption in progress (call, Siri, thermal shutdown); `recovering` = watchdog/encoder rebuild in progress; `throttled` = running at reduced fps because of thermal pressure; `healthy` = frames flowing normally.
- `CircularBufferHardwareTrigger` — `{ source: 'volumeUp' | 'volumeDown' | 'camera' | 'media' | 'enter' | 'captureButton' }`.

Existing behaviour that must keep working: `isBuffering()` must return the
truth (false once the pipeline is genuinely dead), because
`useCircularBuffer.ts`'s AppState handler restarts on `false`.

## Native reliability (both platforms)

- Frame-flow watchdog: track last-encoded-frame time. If buffering, not
  interrupted, and no encoded frame for > 3 s: rebuild the encoder; if that
  doesn't restore flow within the next window, do a full pipeline restart
  (keeping the pending config). Emit `CircularBufferHealth` accordingly.
- Encoder self-healing (iOS `VTCompressionSession` errors incl. -12903;
  Android `MediaCodec.CodecException`).
- Act on capture-session notifications instead of only logging them.
- Ring buffer integrity: when the encoder is recreated, the ring buffer is
  cleared (different format description). A manual recording in flight at
  that moment is finalized with the frames it already has rather than mixing
  formats.
- Save verification: a clip only resolves as saved after the file exists,
  has size > 0 and (iOS) the asset has a video track; otherwise reject with
  `E_SAVE_FAILED`. The JS layer only plays the "saved" sound after the
  promise resolves (already true today).

## Battery

- iOS: back camera is `.builtInWideAngleCamera` only (user decision
  2026-10-21: ultra-wide was unusable anyway; telephoto zoom becomes digital).
- Video stabilization explicitly off (iOS connection
  `preferredVideoStabilizationMode = .off`; Android
  `CONTROL_VIDEO_STABILIZATION_MODE_OFF`, `LENS_OPTICAL_STABILIZATION_MODE_OFF`
  is left at default).
- Android preview stream capped at 1280x720 (same 16:9 aspect as the encoder
  presets); encoder resolution unchanged.
- Thermal step-down: iOS `systemPressureState` serious → 24 fps, critical →
  15 fps, back to configured fps at nominal/fair. Android
  `PowerManager.addThermalStatusListener` (API 29+): SEVERE → 24, CRITICAL+
  → 15. Emit `throttled` / `healthy`.
- Android: `PARTIAL_WAKE_LOCK` held by `CircularBufferForegroundService`
  while it runs (released in onDestroy).

## JS

- Pocket mode: full-screen black overlay on CameraScreen, auto-enters after
  N seconds without touches while buffering (setting, default 20 s, can be
  turned off), manual enter button, single tap exits. Calls
  `setPocketMode`. Stops JS animations (BufferIndicator pulse) while active.
  Shows a very dim status line (buffering/recording) so the user knows it's alive.
- Hardware triggers: setting (default on) → `setHardwareTriggerEnabled`;
  `CircularBufferHardwareTrigger` toggles start/stop recording exactly like
  the record button (works inside pocket mode too).
- Buffer health indicator driven by `CircularBufferHealth`.
- Android battery-optimization card (non-blocking) in PermissionsScreen and
  Settings.
- Auto-stop setting: "Desligar buffer após inatividade" — Nunca (default) /
  30 min / 1 h / 2 h.
