package com.felipenunes.pegueiapp.circularbuffer

/*
 * Pure decision logic behind CameraEncoderController's reliability/battery
 * behavior (watchdog, camera-loss recovery, thermal step-down, preview
 * sizing, save verification, hardware-trigger key handling), split out of the
 * Camera2/MediaCodec/Activity-bound code that acts on it -- same rationale as
 * pickTargetFpsRange's SDK-free overload and previewTargetIncluded (see
 * PickTargetFpsRangeTest): this project's unit tests run against the
 * unmocked Android SDK stub with no Robolectric, which throws at runtime for
 * any real android.* call, so anything worth testing has to live here,
 * expressed over plain Kotlin types. The only android.* references in this
 * file are `static final int` constants (KeyEvent.KEYCODE_*,
 * PowerManager.THERMAL_STATUS_*), which the Kotlin compiler inlines as
 * literals -- no android class is ever loaded at runtime by anything here.
 * See BufferPoliciesTest.kt.
 */

import android.os.PowerManager
import android.view.KeyEvent

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Wire values of the `CircularBufferHealth` event's `state` (bridge contract,
 *  docs/plans/2026-10-21-reliability-battery-triggers.md). */
internal enum class BufferHealth(val wire: String) {
    HEALTHY("healthy"),
    RECOVERING("recovering"),
    INTERRUPTED("interrupted"),
    THROTTLED("throttled"),
}

/**
 * Collapses the three independent conditions the controller tracks into the
 * single state JS sees. Precedence is "most actionable first": an OS-level
 * interruption (camera taken away -- nothing is being captured at all)
 * outranks a self-heal in progress (capture exists but frames stalled),
 * which outranks thermal throttling (frames flowing, just fewer of them).
 * Throttling is still true underneath the other two, so it reappears once
 * they clear without needing its own re-emission.
 */
internal fun resolveBufferHealth(interrupted: Boolean, recovering: Boolean, throttled: Boolean): BufferHealth = when {
    interrupted -> BufferHealth.INTERRUPTED
    recovering -> BufferHealth.RECOVERING
    throttled -> BufferHealth.THROTTLED
    else -> BufferHealth.HEALTHY
}

// ---------------------------------------------------------------------------
// Frame-flow watchdog
// ---------------------------------------------------------------------------

internal enum class WatchdogAction {
    /** Nothing to do (frames flowing, or the watchdog isn't armed right now). */
    NONE,

    /** First stall: rebuild just the MediaCodec encoder + capture session on the still-open camera. */
    RESTART_ENCODER,

    /** The encoder rebuild didn't bring frames back: full stop + reopen, keeping the pending config. */
    RESTART_PIPELINE,

    /** Every escalation step has been tried and frames still don't flow -- stop for real so
     *  isBuffering() reports false (JS's AppState handler restarts on false) and tell JS. */
    GIVE_UP,

    /** Frames are flowing again after one of the actions above -- clear "recovering". */
    RECOVERED,
}

/**
 * Escalating "no encoded video frame for > [stallThresholdMs]" detector.
 * Stateful but SDK-free: the controller feeds it wall-clock readings
 * (SystemClock.elapsedRealtime) from a 1 s tick and acts on the returned
 * [WatchdogAction]; this class only decides.
 *
 * Every action re-arms a fresh [stallThresholdMs] window measured from the
 * action itself (not from the last frame, which by definition is already
 * stale), so each escalation step gets a fair chance to restore flow before
 * the next one fires -- the plan's "if that doesn't restore flow within the
 * next window" rule. [noteSessionStarted] does the same for a capture
 * session that just (re)configured, since opening a camera can itself take
 * a good fraction of the window and isn't a stall.
 */
internal class FrameFlowWatchdog(
    private val stallThresholdMs: Long = 3_000L,
    private val maxPipelineRestarts: Int = 2,
) {
    /** 0 = healthy, 1 = encoder rebuilt, 2.. = pipeline restarted (stage - 1) times. */
    var stage: Int = 0
        private set

    private var lastActionAtMs: Long = Long.MIN_VALUE / 2

    fun reset() {
        stage = 0
        lastActionAtMs = Long.MIN_VALUE / 2
    }

    /** A capture session just started delivering to the encoder -- give it a full window. */
    fun noteSessionStarted(nowMs: Long) {
        lastActionAtMs = nowMs
    }

    /**
     * The drain thread hit a MediaCodec error it can't retry through: same
     * escalation ladder as a stall, just without waiting out the window --
     * so a codec that keeps failing after its rebuild escalates to a
     * pipeline restart and eventually [WatchdogAction.GIVE_UP] instead of
     * being rebuilt in a tight loop forever.
     */
    fun forceEscalation(nowMs: Long): WatchdogAction {
        lastActionAtMs = nowMs
        return escalate()
    }

    fun evaluate(nowMs: Long, lastFrameAtMs: Long, active: Boolean): WatchdogAction {
        if (!active) return WatchdogAction.NONE
        if (stage > 0 && lastFrameAtMs > lastActionAtMs) {
            stage = 0
            return WatchdogAction.RECOVERED
        }
        val lastProgressAtMs = maxOf(lastFrameAtMs, lastActionAtMs)
        if (nowMs - lastProgressAtMs <= stallThresholdMs) return WatchdogAction.NONE
        lastActionAtMs = nowMs
        return escalate()
    }

    private fun escalate(): WatchdogAction =
        when {
            stage == 0 -> {
                stage = 1
                WatchdogAction.RESTART_ENCODER
            }
            stage <= maxPipelineRestarts -> {
                stage++
                WatchdogAction.RESTART_PIPELINE
            }
            else -> WatchdogAction.GIVE_UP
        }
}

// ---------------------------------------------------------------------------
// MediaCodec error escalation
// ---------------------------------------------------------------------------

internal enum class CodecErrorAction {
    /** Transient (resource momentarily unavailable): back off briefly and retry the same call. */
    RETRY,

    /** Recoverable or fatal: tear this codec down and rebuild encoder + session. */
    RECREATE_ENCODER,
}

internal const val MAX_CONSECUTIVE_TRANSIENT_CODEC_ERRORS = 5

/**
 * MediaCodec.CodecException.isTransient means "retry the same call later";
 * isRecoverable means "stop()/configure()/start() again" -- which for a
 * Surface-input encoder also means a fresh input Surface and therefore a new
 * capture session, i.e. exactly what a full recreate does anyway, so both
 * recoverable and fatal map to [CodecErrorAction.RECREATE_ENCODER]. A
 * transient error that keeps repeating is treated as not-actually-transient
 * so the drain thread can't spin on it forever.
 */
internal fun codecErrorAction(isTransient: Boolean, consecutiveTransientErrors: Int): CodecErrorAction =
    if (isTransient && consecutiveTransientErrors < MAX_CONSECUTIVE_TRANSIENT_CODEC_ERRORS) {
        CodecErrorAction.RETRY
    } else {
        CodecErrorAction.RECREATE_ENCODER
    }

// ---------------------------------------------------------------------------
// Camera loss (onDisconnected / onError) recovery
// ---------------------------------------------------------------------------

/** SDK-free mirror of CameraDevice.StateCallback's error constants plus the
 *  other ways an open/session can be lost; mapped in CameraEncoderController. */
internal enum class CameraLossKind {
    DISCONNECTED,
    IN_USE,
    MAX_CAMERAS_IN_USE,
    DISABLED,
    DEVICE_ERROR,
    SERVICE_ERROR,
    CONFIGURE_FAILED,
    OPEN_FAILED,
}

private val REOPEN_BACKOFF_MS = longArrayOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L)

/**
 * Delay before reopen attempt number [attempt] (0-based), or null to give up.
 *
 * DISABLED (device policy / admin has disabled the camera) never clears on
 * its own, so retrying is pointless. Everything else -- most commonly
 * another higher-priority app or a phone call's video taking the camera
 * away (onDisconnected / IN_USE) -- usually does clear once that app lets
 * go, so retry with exponential backoff for about a minute in total before
 * surfacing a real error. Bounded on purpose: an unbounded retry loop while
 * backgrounded would keep waking the camera HAL (battery) for a camera that
 * is never coming back, and JS's AppState handler already restarts the
 * buffer on the next foreground once isBuffering() reports false.
 */
internal fun cameraReopenDelayMs(kind: CameraLossKind, attempt: Int): Long? {
    if (kind == CameraLossKind.DISABLED) return null
    if (attempt < 0 || attempt >= REOPEN_BACKOFF_MS.size) return null
    return REOPEN_BACKOFF_MS[attempt]
}

// ---------------------------------------------------------------------------
// Thermal step-down
// ---------------------------------------------------------------------------

/**
 * PowerManager thermal status -> frame-rate ceiling, or null for "no
 * ceiling". SEVERE is the first level where Android itself says the device
 * is throttling hard enough for users to notice; dropping to 24 fps cuts
 * encoder + ISP work by ~20% at 30 fps (60% at 60) while still looking like
 * normal video. CRITICAL and above are one step from a thermal shutdown, so
 * 15 fps -- still a usable record of what happened, which is the point of
 * this app -- beats losing the buffer entirely.
 */
internal fun thermalFpsCap(thermalStatus: Int): Int? = when {
    thermalStatus >= PowerManager.THERMAL_STATUS_CRITICAL -> 15
    thermalStatus >= PowerManager.THERMAL_STATUS_SEVERE -> 24
    else -> null
}

/** The fps actually requested from the camera: the configured one, capped by
 *  [thermalFpsCap] -- never *raised* (a 24 fps config stays 24 at SEVERE). */
internal fun effectiveFps(configuredFps: Int, thermalStatus: Int): Int {
    val cap = thermalFpsCap(thermalStatus) ?: return configuredFps
    return minOf(configuredFps, cap)
}

/**
 * AE target range for a thermally *reduced* fps. Unlike [CameraEncoderController.pickTargetFpsRange]
 * (which happily picks e.g. 15-30 for a 15 fps request, because for the
 * user's configured rate a wide floor is the goal), the whole point here is
 * a lower *ceiling*, so prefer a range whose upper bound is exactly [fps],
 * then the highest upper bound still below it; only if the camera offers
 * nothing at or under [fps] fall back to the normal picker (no throttle
 * possible on this device, but still a valid range).
 */
internal fun pickThrottledFpsRange(available: List<FpsRange>, fps: Int): FpsRange? {
    available.filter { it.upper == fps }.minByOrNull { it.lower }?.let { return it }
    val below = available.filter { it.upper < fps }
    val bestUpper = below.maxOfOrNull { it.upper }
    if (bestUpper != null) return below.filter { it.upper == bestUpper }.minByOrNull { it.lower }
    return CameraEncoderController.pickTargetFpsRange(available, fps)
}

// ---------------------------------------------------------------------------
// Preview sizing
// ---------------------------------------------------------------------------

internal data class PixelSize(val width: Int, val height: Int)

internal val MAX_PREVIEW_SIZE = PixelSize(1280, 720)

/**
 * Preview SurfaceTexture buffer size, capped at [max] (720p) regardless of
 * the encoder resolution: the on-screen TextureView is at most a phone
 * screen's width, so streaming a 1080p/4K buffer into it only costs ISP +
 * GPU composition bandwidth (battery/heat) for no visible gain. The encoder
 * keeps its own full-resolution surface -- unaffected.
 *
 * Picks the largest camera-supported SurfaceTexture size with the *same
 * aspect ratio* as the encoder (so the preview frames exactly what's being
 * recorded -- a different aspect would crop differently) that fits under
 * [max]. If the camera reports no such size (or none at all), falls back to
 * the encoder's own size, which is known to be supported -- a slightly
 * wasteful preview beats a configure failure from an unsupported one.
 */
internal fun pickPreviewSize(supported: List<PixelSize>, encoder: PixelSize, max: PixelSize = MAX_PREVIEW_SIZE): PixelSize {
    val candidates = supported.filter {
        it.width.toLong() * encoder.height == it.height.toLong() * encoder.width &&
            it.width <= max.width && it.height <= max.height
    }
    return candidates.maxByOrNull { it.width.toLong() * it.height } ?: encoder
}

// ---------------------------------------------------------------------------
// Save verification
// ---------------------------------------------------------------------------

/** A clip only counts as saved once the muxed file actually exists on disk
 *  with content -- MediaMuxer.stop() returning without throwing isn't proof
 *  (a full disk or a revoked directory can still leave nothing/0 bytes). */
internal fun isSavedClipValid(exists: Boolean, lengthBytes: Long): Boolean = exists && lengthBytes > 0

/** Outcome of a save, decoupled from the bridge's SaveClipCallback so it can be
 *  produced before anyone is waiting for it -- see [DeferredSaveOutcome]. */
internal sealed class SaveOutcome {
    data class Saved(val path: String, val durationSeconds: Double) : SaveOutcome()
    data class Failed(val code: String, val message: String) : SaveOutcome()
}

/**
 * One-shot rendezvous between a save that the *native side* finalized on
 * its own (an in-flight manual recording cut short by an encoder rebuild or
 * pipeline restart, see CameraEncoderController.finalizeInFlightRecording)
 * and JS's later stopManualRecording() call, which is still the only thing
 * that resolves the user's recording. Whichever side arrives second
 * delivers; each side only ever arrives once.
 */
internal class DeferredSaveOutcome {
    private var outcome: SaveOutcome? = null
    private var waiter: ((SaveOutcome) -> Unit)? = null

    fun complete(result: SaveOutcome) {
        val deliverTo: ((SaveOutcome) -> Unit)?
        synchronized(this) {
            if (outcome != null) return
            outcome = result
            deliverTo = waiter
            waiter = null
        }
        deliverTo?.invoke(result)
    }

    fun await(onOutcome: (SaveOutcome) -> Unit) {
        val ready: SaveOutcome?
        synchronized(this) {
            ready = outcome
            if (ready == null) waiter = onOutcome
        }
        ready?.let(onOutcome)
    }
}

// ---------------------------------------------------------------------------
// Hardware triggers (MainActivity.dispatchKeyEvent)
// ---------------------------------------------------------------------------

/** Contract `source` for each intercepted key, or null if the key isn't a trigger. Cheap
 *  Bluetooth selfie-shutter remotes send VOLUME_UP or ENTER, hence both being here. */
internal fun hardwareTriggerSource(keyCode: Int): String? = when (keyCode) {
    KeyEvent.KEYCODE_VOLUME_UP -> "volumeUp"
    KeyEvent.KEYCODE_VOLUME_DOWN -> "volumeDown"
    KeyEvent.KEYCODE_CAMERA -> "camera"
    KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> "media"
    KeyEvent.KEYCODE_ENTER -> "enter"
    else -> null
}

internal enum class KeyDecision {
    /** Not ours: let the system handle it (volume changes, text input, ...). */
    PASS_THROUGH,

    /** Ours, but not the triggering edge: swallow it so e.g. volume doesn't change. */
    CONSUME,

    /** Ours and the triggering edge: swallow it and emit CircularBufferHardwareTrigger. */
    TRIGGER,
}

/**
 * Only ever intercepts while the user has the setting on AND the buffer is
 * actually running -- everywhere else (Settings, Gallery, buffer stopped)
 * volume keys must keep changing volume and ENTER must keep working in text
 * fields. Fires on the key's *release* (ACTION_UP) rather than press so a
 * single physical press can't double-fire via auto-repeat, and ignores a
 * release whose press the system already canceled (e.g. a key that turned
 * into a system gesture/long-press action). ACTION_DOWN (including its
 * auto-repeats) is consumed so the volume HUD never shows up.
 */
internal fun decideHardwareKey(
    enabled: Boolean,
    buffering: Boolean,
    keyCode: Int,
    isDown: Boolean,
    isUp: Boolean,
    repeatCount: Int,
    isCanceled: Boolean,
): KeyDecision {
    if (!enabled || !buffering || hardwareTriggerSource(keyCode) == null) return KeyDecision.PASS_THROUGH
    if (isDown) return KeyDecision.CONSUME
    if (isUp && repeatCount == 0 && !isCanceled) return KeyDecision.TRIGGER
    return KeyDecision.CONSUME
}
