package com.felipenunes.pegueiapp.circularbuffer

import android.content.Context
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import com.felipenunes.pegueiapp.FeatureFlags
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

data class BufferConfig(val bufferSeconds: Int, val width: Int, val height: Int, val fps: Int)

/** Plain (lower, upper) pair mirroring `android.util.Range<Int>` without the Android SDK
 *  dependency -- see `pickTargetFpsRange`'s doc comment for why. */
internal data class FpsRange(val lower: Int, val upper: Int)

data class CaptureCapabilities(val supportedQualities: List<String>, val fpsByQuality: Map<String, List<Int>>)

/** The (width, height) pixel dimensions for each quality preset, mirrored from
 *  VIDEO_QUALITY_PRESETS in shared/types/index.ts -- capability-checking happens
 *  entirely native-side, before any BufferConfig is ever built. */
private val QUALITY_PRESET_SIZES = listOf(
    Triple("720p", 1280, 720),
    Triple("1080p", 1920, 1080),
    Triple("4k", 3840, 2160),
)

/** Mirrors VIDEO_FPS_OPTIONS in shared/types/index.ts. */
private val CANDIDATE_FPS_OPTIONS = listOf(24, 30, 60)

data class ZoomInfo(val minZoom: Double, val maxZoom: Double, val hasUltraWide: Boolean)

interface CameraEncoderCallback {
    fun onError(code: String, message: String)

    /** `CircularBufferHealth` transitions (`state` is one of BufferHealth's wire values).
     *  Default no-op so callers that only care about errors don't have to implement it. */
    fun onHealth(state: String, reason: String?) {}
}

interface SaveClipCallback {
    fun onSaved(path: String, durationSeconds: Double)
    fun onFailed(code: String, message: String)
}

interface StartRecordingCallback {
    fun onStarted()
    fun onFailed(code: String, message: String)
}

/**
 * Owns the Camera2 capture session, the MediaCodec H.264 encoder and the
 * [FrameRingBuffer] of encoded video frames, plus a continuously-running
 * mic capture + AAC encoder pair feeding a second [FrameRingBuffer] of
 * encoded audio frames, muxed in alongside video at save time (see
 * [finalizeSave]). See DECISIONS.md "Audio".
 *
 * Reliability (2026-10-21, docs/plans/2026-10-21-reliability-battery-triggers.md):
 * the pipeline is expected to run unattended for long stretches (pocket
 * mode, screen off), so it now heals itself instead of dying quietly --
 * a frame-flow watchdog ([onWatchdogTick]), MediaCodec.CodecException
 * handling in the drain thread, and camera-loss recovery with backoff
 * ([handleCameraLost]) -- and reports what it's doing through
 * `CircularBufferHealth` ([updateHealth]). The decision logic for all of it
 * lives SDK-free in BufferPolicies.kt so it's unit-testable.
 *
 * Threading: public entry points and every state transition are
 * `@Synchronized` on this object. Camera2 callbacks arrive on
 * [cameraHandler]; anything that tears the pipeline down (which quits that
 * very thread) is instead posted to the long-lived [watchdogHandler]
 * thread, which also runs the watchdog tick, reopen backoff and thermal
 * callbacks. The drain/audio threads never take the lock -- they only post
 * recovery requests -- so stopInternal()'s bounded joins can't deadlock
 * against them.
 *
 * There is only ever one active session app-wide, hence the singleton.
 */
object CameraEncoderController {
    private const val TAG = "CircularBuffer"
    private const val MIME_TYPE = MediaFormat.MIMETYPE_VIDEO_AVC
    private const val I_FRAME_INTERVAL_SECONDS = 1
    private const val OUTPUT_TIMEOUT_US = 10_000L

    private const val AUDIO_MIME_TYPE = MediaFormat.MIMETYPE_AUDIO_AAC
    private const val AUDIO_SAMPLE_RATE = 44_100
    private const val AUDIO_CHANNEL_COUNT = 1
    private const val AUDIO_BIT_RATE = 96_000
    private const val AUDIO_OUTPUT_TIMEOUT_US = 10_000L
    private const val MAX_AUDIO_RESTARTS_PER_SESSION = 3

    private const val WATCHDOG_TICK_MS = 1_000L

    /** Window brightness used by pocket mode -- not 0, which some OEMs treat as "screen off"
     *  and which would then stop delivering key events (hardware triggers) to the Activity. */
    const val POCKET_MODE_BRIGHTNESS = 0.01f

    private var appContext: Context? = null
    private var pendingConfig: BufferConfig? = null
    private var callback: CameraEncoderCallback? = null

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var encoder: MediaCodec? = null
    private var encoderInputSurface: Surface? = null
    private var encoderOutputFormat: MediaFormat? = null

    // Zoom state, populated once the camera id is picked in
    // openCameraAndStart() (before the device is even fully opened) and
    // read/written by setZoom()/getZoomInfo(). requestBuilder is the same
    // builder used for the repeating preview+encoder request in
    // createSession() -- promoted from a local val to a field so
    // setZoom() can mutate it and resubmit via setRepeatingRequest() without
    // touching the session's surfaces/inputs, i.e. without any risk of
    // restarting the capture session or interrupting an in-flight manual
    // recording. See DECISIONS.md "Zoom".
    private var requestBuilder: CaptureRequest.Builder? = null
    private var zoomRatioRange: Range<Float>? = null
    private var maxDigitalZoom: Float = 1f
    private var sensorActiveArraySize: Rect? = null
    private var targetFpsRange: Range<Int>? = null
    /** The camera's AE target ranges, kept so a thermal step-down can re-pick a range on
     *  the live session (see [applyThermalFps]) without re-reading CameraCharacteristics. */
    private var availableFpsRanges: List<FpsRange> = emptyList()
    /** Preview SurfaceTexture buffer size -- capped at 720p, see [pickPreviewSize]. */
    private var previewSize: PixelSize? = null
    /** Last zoom factor applied via [setZoom], reapplied by every fresh CaptureRequest.Builder
     *  (see [buildRepeatingRequest]) -- otherwise a recreated session silently starts back at
     *  the hardware default. Reset on a real [stopInternal] since JS's own useZoom.ts already
     *  handles reapplying the user's chosen zoom after a full cold restart; *kept* across the
     *  native-initiated recovery restarts (keepZoom = true), which JS never hears about. */
    private var appliedZoom: Float? = null

    /** True while the app is backgrounded/screen-off -- see [enterBackgroundMode]. Unlike
     *  the fields above, this is NOT reset in [stopInternal]: an explicit stopBuffering()
     *  can only be called from the (necessarily foregrounded) JS/UI thread, but this flag's
     *  own transitions are driven independently by Activity lifecycle callbacks, so leaving
     *  it as-is here is simplest and matches the actual state of the app process. */
    private var isBackgroundMode = false

    /** JS-driven pocket mode (see [setPocketMode]): app in the foreground, screen dimmed to
     *  near-black, preview target dropped exactly like background mode. Independent of
     *  [isBackgroundMode] -- the preview is only re-added once *neither* is active. */
    private var isPocketMode = false

    /** Whether MainActivity.dispatchKeyEvent should turn volume/camera/media/enter keys into
     *  `CircularBufferHardwareTrigger` events -- see [decideHardwareKey]. */
    @Volatile
    var hardwareTriggerEnabled = false

    private var previewView: CircularBufferPreviewView? = null
    private var previewSurfaceTexture: SurfaceTexture? = null
    private var previewSurface: Surface? = null
    /** The preview Surface that's actually part of the live session's output list (null for a
     *  headless session). addTarget() is only legal for this one -- see [setPreviewTargetIncluded]. */
    private var sessionPreviewSurface: Surface? = null

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var drainThread: Thread? = null
    /** The codec [drainThread] is draining -- lets [ensureDrainThread] tell whether the live
     *  encoder already has a drain thread after an encoder rebuild. */
    private var drainCodec: MediaCodec? = null

    private val isRunning = AtomicBoolean(false)
    private val isOpening = AtomicBoolean(false)
    /** The in-progress open was started by recovery (watchdog/camera loss), not by JS -- so a
     *  failure retries with backoff instead of surfacing an immediate error. */
    private var isRecoveryOpen = false

    // Staleness tokens for Camera2's async callbacks: bumped on every teardown
    // (deviceGen) / every new capture session (sessionGen), captured by each
    // callback, and compared under the lock before acting. Without them a
    // late onOpened/onConfigured/onDisconnected from a device or session
    // that was already torn down (very possible now that recovery can tear
    // down and reopen within a second) would clobber the *current* state --
    // the pre-2026-10-21 code could e.g. leave isOpening stuck true forever if
    // the preview detached mid-open.
    private var deviceGen = 0
    private var sessionGen = 0

    private var ringBuffer: FrameRingBuffer? = null

    // Continuously-running mic capture + AAC encoder, parallel to the video
    // encoder/drain thread above. isAudioRunning is separate from isRunning:
    // audio starts synchronously right after the video encoder is
    // configured, well before isRunning flips true in createSession's
    // async onConfigured callback, so reusing isRunning as the audio loop's
    // condition would race it into never starting.
    private var audioRecord: AudioRecord? = null
    private var audioEncoder: MediaCodec? = null
    private var audioEncoderOutputFormat: MediaFormat? = null
    private var audioThread: Thread? = null
    private var audioRingBuffer: FrameRingBuffer? = null
    private val isAudioRunning = AtomicBoolean(false)
    private var audioRestarts = 0

    @Volatile
    private var pendingSave: PendingSave? = null

    /** A manual recording the native side had to finalize on its own (encoder rebuild /
     *  pipeline restart mid-recording), waiting for JS's stopManualRecording() to claim its
     *  outcome -- see [finalizeInFlightRecording]. */
    private var orphanedSave: DeferredSaveOutcome? = null

    // --- Reliability state (watchdog, camera-loss backoff, health) ---

    /** Long-lived (never quit -- this object is a process singleton) thread for the watchdog
     *  tick, reopen backoff, thermal callbacks and any recovery that tears down the camera
     *  thread. Lazy so merely touching this object (unit tests call its pure helpers) never
     *  constructs an android.os.Handler against the stub SDK. */
    private val watchdogHandler: Handler by lazy {
        Handler(HandlerThread("CircularBufferWatchdog").apply { start() }.looper)
    }
    private val watchdog = FrameFlowWatchdog()
    @Volatile
    private var lastVideoFrameAtMs = 0L
    private var watchdogTicking = false
    private val watchdogTick = Runnable { onWatchdogTick() }

    private var reopenAttempt = 0
    private var lastLossKind = CameraLossKind.DISCONNECTED
    private val reopenRunnable = Runnable { attemptReopen() }

    private var healthInterrupted = false
    private var healthRecovering = false
    private var healthThrottled = false
    private var lastEmittedHealth = BufferHealth.HEALTHY

    /** PowerManager.OnThermalStatusChangedListener (API 29+), typed as Any so this field's
     *  declaration never references a class missing on API 24-28. */
    private var thermalListener: Any? = null
    private var thermalStatus = 0 // PowerManager.THERMAL_STATUS_NONE

    /**
     * A manual recording in flight: [headFrames] is the pre-roll snapshot
     * taken from the ring buffer the moment recording started; [tailFrames]
     * keeps accumulating every frame the encoder produces for as long as
     * recording continues, with no fixed target duration -- the user's own
     * "stop" tap is what ends it (see [stopManualRecording]). The tail lists
     * are appended from the drain/audio threads and copied by [finalizeSave],
     * so both sides synchronize on the list itself.
     */
    private class PendingSave(
        val headFrames: List<EncodedFrame>,
        val tailFrames: MutableList<EncodedFrame>,
        val audioHeadFrames: List<EncodedFrame>,
        val audioTailFrames: MutableList<EncodedFrame>,
        val outputFile: File,
    )

    private enum class SessionPurpose { INITIAL, ENCODER_RESTART, NEW_PREVIEW }

    /**
     * Truthful by construction: isRunning is only true between a session's
     * onConfigured and the next [stopInternal], and every path that kills the
     * pipeline for real (camera disconnected/errored, watchdog giving up,
     * session configure failure) now goes through stopInternal -- previously
     * onDisconnected closed the device and left this reporting true forever,
     * so useCircularBuffer.ts's AppState handler never restarted a dead buffer.
     * An in-place encoder rebuild keeps it true: the camera is still open and
     * frames resume within the watchdog window.
     */
    fun isBuffering(): Boolean = isRunning.get()

    /** Called by CircularBufferModule.startBuffering(). May run before the preview surface exists. */
    @Synchronized
    fun configureAndArm(context: Context, config: BufferConfig, cb: CameraEncoderCallback) {
        appContext = context.applicationContext
        pendingConfig = config
        callback = cb
        ringBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)
        audioRingBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)

        // A JS-initiated (re)start supersedes any native recovery in progress.
        cancelScheduledReopen()
        reopenAttempt = 0
        watchdog.reset()
        healthInterrupted = false
        healthRecovering = false
        registerThermalListener(context.applicationContext)
        applyThermalFps()
        updateHealth(null)
        startWatchdogTicks()

        if (previewSurface != null && !isRunning.get()) {
            openCameraAndStart()
        }
    }

    /** Called by the native preview view once its SurfaceTexture is ready. */
    @Synchronized
    fun attachPreviewSurface(view: CircularBufferPreviewView, surfaceTexture: SurfaceTexture, surface: Surface, width: Int, height: Int) {
        previewView = view
        previewSurfaceTexture = surfaceTexture
        previewSurface = surface
        if (isRunning.get()) {
            // Only reachable after detachPreviewSurface's soft-detach branch
            // below actually lost the old SurfaceTexture (backgrounded +
            // the OS reclaimed it -- less common than the surface simply
            // surviving, but happens under memory pressure/on some OEMs), or
            // after a headless recovery reopen while backgrounded. This new
            // Surface was never part of the live session's original
            // createCaptureSession(...) target list, so unlike
            // exitBackgroundMode()'s common-case path it can't just be
            // addTarget()'d back on -- see recreateSessionWithNewPreview.
            recreateSessionWithNewPreview(surface)
            return
        }
        if (pendingConfig != null) {
            openCameraAndStart()
        }
    }

    @Synchronized
    fun detachPreviewSurface() {
        val oldPreview = previewSurface
        previewView = null
        previewSurfaceTexture = null
        previewSurface = null
        if (isBackgroundMode && (isRunning.get() || isOpening.get())) {
            // Soft detach: backgrounded and the OS tore down the preview
            // surface. Drop it from the live repeating request (idempotent
            // if enterBackgroundMode already did this) and leave the
            // session/encoder/audio/ring buffers running headless, instead
            // of the full teardown below -- that's the entire point of
            // background mode. Real in-app navigation (Settings/Gallery,
            // isBackgroundMode false) is untouched and keeps today's
            // tested full-stop-and-cold-restart behavior. Also covers a
            // recovery reopen still in flight (isOpening): tearing that down
            // here would silently end background recording.
            setPreviewTargetIncluded(oldPreview, included = false)
            return
        }
        stopInternal()
    }

    /** Two-argument form kept for PreviewTargetIncludedTest / background-mode-only callers;
     *  see the three-argument overload. */
    internal fun previewTargetIncluded(isBackgroundMode: Boolean, isRunning: Boolean): Boolean =
        previewTargetIncluded(isBackgroundMode, isPocketMode = false, isRunning = isRunning)

    /** Whether the current CaptureRequest should include the preview
     *  target: only while actually running, in the foreground, and not in
     *  pocket mode (screen dimmed under a black overlay -- rendering preview
     *  frames nobody can see is pure ISP/GPU cost). Split out from the real
     *  android.hardware.camera2 mutation in [setPreviewTargetIncluded] so
     *  this decision is unit-testable under plain JUnit, same rationale as
     *  [pickTargetFpsRange]'s SDK-free overload -- see its doc comment. */
    internal fun previewTargetIncluded(isBackgroundMode: Boolean, isPocketMode: Boolean, isRunning: Boolean): Boolean =
        isRunning && !isBackgroundMode && !isPocketMode

    private fun currentPreviewTargetIncluded(): Boolean =
        previewTargetIncluded(isBackgroundMode, isPocketMode, isRunning.get())

    /**
     * Mutates the *existing* CaptureRequest.Builder's target set and
     * resubmits via setRepeatingRequest -- the same "never recreate the
     * session" pattern setZoom() already uses (see DECISIONS.md "Camera
     * zoom"). addTarget()/removeTarget() only work for a surface that was
     * part of the session's original createCaptureSession(...) list, so an
     * add is skipped unless `preview` is exactly [sessionPreviewSurface]
     * (a headless recovery session has no preview output at all; the
     * eventual attachPreviewSurface -> recreateSessionWithNewPreview handles
     * that case). Removal is always safe.
     */
    private fun setPreviewTargetIncluded(preview: Surface?, included: Boolean) {
        val session = captureSession ?: return
        val builder = requestBuilder ?: return
        if (preview == null) return
        if (included && preview !== sessionPreviewSurface) return
        try {
            if (included) builder.addTarget(preview) else builder.removeTarget(preview)
            session.setRepeatingRequest(builder.build(), null, cameraHandler)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to ${if (included) "add" else "remove"} preview target", t)
        }
    }

    /**
     * Called from MainApplication's ActivityLifecycleCallbacks when the app
     * backgrounds (switched away, or the screen turns off -- Activity.onStop
     * fires for both). Drops the preview target from the live repeating
     * request without touching the encoder/session/ring buffers at all, so
     * capture -- and therefore the circular buffer and any in-flight manual
     * recording -- keeps running headless. No-op if already backgrounded or
     * not currently running (buffering not started).
     *
     * Gated on [FeatureFlags.BACKGROUND_RECORDING_ENABLED]: when the flag is
     * off, this falls back to a full [stopInternal] instead of the headless
     * soft-detach above. That's not just the simplest thing to do -- without
     * [CircularBufferForegroundService]'s elevated priority (also gated off,
     * see CircularBufferModule.startBuffering), the OS revokes Camera2 access
     * from a backgrounded process shortly after anyway, so leaving the
     * session running headless would only degrade into camera errors.
     * Matches iOS, which has no background-capture path at all.
     */
    @Synchronized
    fun enterBackgroundMode() {
        if (isBackgroundMode) return
        isBackgroundMode = true
        if (!FeatureFlags.BACKGROUND_RECORDING_ENABLED) {
            if (isRunning.get() || isOpening.get()) stopInternal()
            cancelScheduledReopen()
            return
        }
        if (isRunning.get()) {
            setPreviewTargetIncluded(previewSurface, currentPreviewTargetIncluded())
        }
    }

    /**
     * Called when the app returns to the foreground. In the common case
     * (the TextureView's SurfaceTexture survived backgrounding, so
     * previewSurface was never cleared) this alone re-adds the preview
     * target to the still-open session -- attachPreviewSurface() never even
     * fires again. If the surface *was* torn down while backgrounded,
     * previewSurface is null here and there's nothing to re-add yet; the
     * eventual attachPreviewSurface() call (once the TextureView is
     * recreated) picks it up via recreateSessionWithNewPreview instead.
     * Stays dropped if pocket mode is still on (see [setPocketMode]).
     *
     * With [FeatureFlags.BACKGROUND_RECORDING_ENABLED] off, this is a no-op:
     * [enterBackgroundMode] already fully stopped the session above, so
     * there's nothing to restore here -- the normal attachPreviewSurface() ->
     * openCameraAndStart() cold-restart path (the same one Settings/Gallery
     * navigation already relies on) handles reopening from scratch.
     */
    @Synchronized
    fun exitBackgroundMode() {
        if (!isBackgroundMode) return
        isBackgroundMode = false
        if (!FeatureFlags.BACKGROUND_RECORDING_ENABLED) return
        if (isRunning.get()) {
            setPreviewTargetIncluded(previewSurface, currentPreviewTargetIncluded())
        }
    }

    /**
     * Pocket mode (bridge contract `setPocketMode`): the phone is face-down
     * or in a pocket with the app still foregrounded, so the screen is
     * dimmed (CircularBufferModule sets the window brightness) and the
     * preview target is dropped from the repeating request exactly like
     * [enterBackgroundMode] does -- capture/encode/ring buffers and any
     * in-flight recording are untouched. Coexists with background mode via
     * [previewTargetIncluded]: the preview only comes back once the app is
     * foregrounded *and* pocket mode is off, whichever happens last.
     * Remembered while not running, so a session (re)created in pocket mode
     * (watchdog/camera-loss recovery) also starts without the preview.
     */
    @Synchronized
    fun setPocketMode(enabled: Boolean) {
        if (isPocketMode == enabled) return
        isPocketMode = enabled
        if (isRunning.get()) {
            setPreviewTargetIncluded(previewSurface, currentPreviewTargetIncluded())
        }
    }

    /**
     * Surgical re-creation of just the CameraCaptureSession on the
     * already-open cameraDevice, for the soft-detach case where the
     * TextureView's SurfaceTexture was actually destroyed and recreated
     * while backgrounded (detachPreviewSurface's isBackgroundMode branch),
     * or a headless recovery session that now has a preview to show:
     * the new Surface was never part of the live session's original
     * createCaptureSession(...) target list, so it can't just be
     * addTarget()'d the way the common case (exitBackgroundMode) can.
     * Creating a new session on an already-open CameraDevice is a normal,
     * supported Camera2 operation (the framework implicitly closes the
     * prior session) -- unlike openCameraAndStart(), this never touches the
     * MediaCodec encoder, AudioRecord/audio encoder, or either ring buffer,
     * so it can't disturb an in-flight manual recording (pendingSave keeps
     * accumulating frames from the same encoder throughout).
     */
    private fun recreateSessionWithNewPreview(preview: Surface) {
        val device = cameraDevice ?: return
        if (encoderInputSurface == null) return
        applyPreviewBufferSize()
        createSession(device, preview, SessionPurpose.NEW_PREVIEW)
    }

    /** Reapplies the last zoom factor set via [setZoom] to a fresh CaptureRequest.Builder --
     *  every recreated session's new builder otherwise starts back at the hardware default
     *  zoom. Mirrors setZoom's own zoomRatioRange-vs-crop-region branch exactly. */
    private fun reapplyZoom(builder: CaptureRequest.Builder) {
        val zoom = appliedZoom ?: return
        if (zoomRatioRange != null) {
            builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoom)
        } else {
            sensorActiveArraySize?.let { activeArray ->
                builder.set(CaptureRequest.SCALER_CROP_REGION, cropRegionForZoom(activeArray, zoom))
            }
        }
    }

    /**
     * Mirrors Google's Camera2Basic sample: the buffer is requested at its
     * native (landscape) size and the view's own *measured* box is
     * constrained to the rotated (portrait) aspect ratio via setAspectRatio,
     * instead of trying to fix the mismatch with a content Matrix. The size
     * is [previewSize] -- the encoder's aspect ratio capped at 720p (see
     * [pickPreviewSize]) -- so the aspect ratio handed to the view is the
     * preview's own, which by construction equals the encoder's.
     */
    private fun applyPreviewBufferSize() {
        val size = previewSize ?: pendingConfig?.let { PixelSize(it.width, it.height) } ?: return
        previewSurfaceTexture?.setDefaultBufferSize(size.width, size.height)
        previewView?.let { view -> view.post { view.setAspectRatio(size.height, size.width) } }
    }

    /**
     * @param recovery true when called by native recovery (watchdog pipeline
     *   restart / camera-loss reopen) rather than by JS: allows a *headless*
     *   open while backgrounded with no preview surface (the TextureView's
     *   SurfaceTexture may be long gone), and routes failures into the
     *   reopen backoff instead of an immediate error.
     */
    @Synchronized
    private fun openCameraAndStart(recovery: Boolean = false) {
        val context = appContext ?: return
        val config = pendingConfig ?: return
        if (previewSurface == null && !(recovery && isBackgroundMode)) return
        if (isOpening.get() || isRunning.get()) return

        // ringBuffer/audioRingBuffer are only ever *created* in
        // configureAndArm(), which runs exactly once (CameraScreen's
        // initial mount). Every restart after that point (navigating away
        // detaches the preview -> stopInternal() nulls both buffers;
        // navigating back reattaches -> this method) brings the capture
        // session back correctly but would leave the buffers permanently
        // null forever after, since nothing here recreated them -- same
        // bug confirmed on the iOS side via on-device diagnostics (session
        // restart reported success while ringBuffer stayed nil). Fresh
        // buffers here (not reused stale ones) also matters because
        // they'd otherwise hold frames encoded under the *previous*
        // session's encoderOutputFormat, which finalizeSave assumes is
        // uniform across every frame.
        if (ringBuffer == null) {
            ringBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)
        }
        if (audioRingBuffer == null) {
            audioRingBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)
        }

        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = try {
            pickBackCameraId(manager)
        } catch (t: Throwable) {
            failOpen(recovery, CameraLossKind.SERVICE_ERROR, CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao acessar a câmera: ${t.message}")
            return
        }
        if (cameraId == null) {
            callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Nenhuma câmera traseira disponível.")
            return
        }

        val characteristics = manager.getCameraCharacteristics(cameraId)
        // CONTROL_ZOOM_RATIO (API 30+) is what makes zoom span a logical
        // multi-camera's physical lenses (including below 1.0 for
        // ultra-wide) automatically -- the framework picks the right
        // physical lens for the requested ratio. Below API 30, or on a
        // device that doesn't report a range, only crop-region digital zoom
        // is available (never below 1.0, so 0.5x is correctly never offered
        // -- see getZoomInfo()).
        zoomRatioRange = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
        } else {
            null
        }
        maxDigitalZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
        sensorActiveArraySize = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        availableFpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?.map { FpsRange(it.lower, it.upper) } ?: emptyList()
        targetFpsRange = fpsRangeFor(config.fps, effectiveFps(config.fps, thermalStatus))

        val supportedPreviewSizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(SurfaceTexture::class.java)
            ?.map { PixelSize(it.width, it.height) } ?: emptyList()
        previewSize = pickPreviewSize(supportedPreviewSizes, PixelSize(config.width, config.height))
        applyPreviewBufferSize()

        try {
            createVideoEncoder(config)
        } catch (t: Throwable) {
            releaseEncoder()
            failOpen(recovery, CameraLossKind.OPEN_FAILED, CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao iniciar o encoder: ${t.message}")
            return
        }

        audioRestarts = 0
        try {
            startAudioCapture()
        } catch (e: SecurityException) {
            releaseEncoder()
            releaseAudioCapture()
            callback?.onError(CircularBufferErrorCodes.MICROPHONE_PERMISSION, "Permissão de microfone não concedida.")
            return
        } catch (t: Throwable) {
            // Non-fatal: the video pipeline above already succeeded, so a mic/
            // audio-encoder problem degrades to a video-only clip (mirrors
            // the iOS side's "audio is best-effort" handling) instead of
            // failing the whole buffering session.
            Log.e(TAG, "Failed to start audio capture, continuing video-only", t)
            releaseAudioCapture()
        }

        isOpening.set(true)
        isRecoveryOpen = recovery
        cameraThread = HandlerThread("CircularBufferCamera").apply { start() }
        cameraHandler = Handler(cameraThread!!.looper)
        val gen = deviceGen

        try {
            @Suppress("MissingPermission")
            manager.openCamera(
                cameraId,
                object : CameraDevice.StateCallback() {
                    override fun onOpened(device: CameraDevice) {
                        onCameraOpened(gen, device)
                    }

                    // The OS took the camera away (another higher-priority
                    // client, a call, the camera privacy toggle, background
                    // revocation...). Previously this only closed the device
                    // and left isRunning true with no JS notification -- the
                    // buffer was dead but looked alive forever. Now it goes
                    // through the same truthful teardown + backoff reopen as
                    // onError. Posted rather than handled inline because the
                    // teardown quits this very callback thread.
                    override fun onDisconnected(device: CameraDevice) {
                        try {
                            device.close()
                        } catch (_: Throwable) {
                        }
                        watchdogHandler.post { handleCameraLost(gen, CameraLossKind.DISCONNECTED, null) }
                    }

                    override fun onError(device: CameraDevice, error: Int) {
                        try {
                            device.close()
                        } catch (_: Throwable) {
                        }
                        watchdogHandler.post { handleCameraLost(gen, cameraLossKindFor(error), error) }
                    }
                },
                cameraHandler,
            )
        } catch (e: SecurityException) {
            stopInternal(keepZoom = recovery)
            callback?.onError(CircularBufferErrorCodes.CAMERA_PERMISSION, "Permissão de câmera não concedida.")
        } catch (t: Throwable) {
            failOpen(recovery, CameraLossKind.OPEN_FAILED, CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao abrir a câmera: ${t.message}")
        }
    }

    /** A synchronous open failure: during recovery, back off and retry (the camera
     *  service/codec resources are often only momentarily unavailable); otherwise the
     *  pre-existing immediate JS error, after a full cleanup (the old code leaked a
     *  running AudioRecord + audio thread on several of these paths). */
    private fun failOpen(recovery: Boolean, kind: CameraLossKind, code: String, message: String) {
        stopInternal(keepZoom = recovery)
        if (recovery) {
            Log.e(TAG, "Recovery open failed ($kind): $message")
            scheduleReopen(kind)
        } else {
            callback?.onError(code, message)
        }
    }

    private fun createVideoEncoder(config: BufferConfig) {
        val codec = MediaCodec.createEncoderByType(MIME_TYPE)
        try {
            val format = MediaFormat.createVideoFormat(MIME_TYPE, config.width, config.height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, estimateBitRate(config))
                setInteger(MediaFormat.KEY_FRAME_RATE, config.fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL_SECONDS)
            }
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val surface = codec.createInputSurface()
            codec.start()
            encoder = codec
            encoderInputSurface = surface
        } catch (t: Throwable) {
            try {
                codec.release()
            } catch (_: Throwable) {
            }
            throw t
        }
    }

    @Synchronized
    private fun onCameraOpened(gen: Int, device: CameraDevice) {
        if (gen != deviceGen) {
            // Torn down (or superseded) while the open was in flight.
            try {
                device.close()
            } catch (_: Throwable) {
            }
            return
        }
        cameraDevice = device
        createSession(device, previewSurface, SessionPurpose.INITIAL)
    }

    /**
     * Every repeating request (initial, encoder-rebuild, new-preview) is built
     * here so they can't drift apart:
     * - preview target only if [currentPreviewTargetIncluded] (a session
     *   rebuilt while backgrounded/in pocket mode must not resume rendering).
     * - CONTROL_VIDEO_STABILIZATION_MODE_OFF explicitly: TEMPLATE_RECORD lets
     *   some OEMs default EIS on, which crops the sensor and adds a
     *   per-frame warp pass on the ISP/GPU -- measurable battery/heat for a
     *   buffer that runs for hours, with no benefit for a phone that's
     *   usually mounted or pocketed. OIS (LENS_OPTICAL_STABILIZATION_MODE)
     *   is left at the template default (plan decision).
     * - AE fps range = [targetFpsRange], which already includes any thermal
     *   step-down (see [applyThermalFps]).
     * - the last zoom, see [reapplyZoom].
     */
    private fun buildRepeatingRequest(device: CameraDevice, preview: Surface?, encInputSurface: Surface): CaptureRequest.Builder =
        device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
            if (preview != null && currentPreviewTargetIncludedForNewSession()) addTarget(preview)
            addTarget(encInputSurface)
            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
            set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
            targetFpsRange?.let { set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
            reapplyZoom(this)
        }

    /** isRunning is still false while the INITIAL session is being built, so evaluate the
     *  preview decision as if running -- what matters here is background/pocket state. */
    private fun currentPreviewTargetIncludedForNewSession(): Boolean =
        previewTargetIncluded(isBackgroundMode, isPocketMode, isRunning = true)

    private fun createSession(device: CameraDevice, preview: Surface?, purpose: SessionPurpose) {
        val gen = ++sessionGen
        val encInputSurface = encoderInputSurface
        if (encInputSurface == null) {
            onSessionConfigureFailed(gen, purpose)
            return
        }
        try {
            val builder = buildRepeatingRequest(device, preview, encInputSurface)
            device.createCaptureSession(
                listOfNotNull(preview, encInputSurface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        onSessionConfigured(gen, session, builder, preview, purpose)
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        Log.e(TAG, "Capture session configure failed ($purpose)")
                        onSessionConfigureFailed(gen, purpose)
                    }
                },
                cameraHandler,
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to create capture session ($purpose)", t)
            onSessionConfigureFailed(gen, purpose)
        }
    }

    @Synchronized
    private fun onSessionConfigured(
        gen: Int,
        session: CameraCaptureSession,
        builder: CaptureRequest.Builder,
        preview: Surface?,
        purpose: SessionPurpose,
    ) {
        if (gen != sessionGen) {
            try {
                session.close()
            } catch (_: Throwable) {
            }
            return
        }
        captureSession = session
        requestBuilder = builder
        sessionPreviewSurface = preview
        try {
            session.setRepeatingRequest(builder.build(), null, cameraHandler)
        } catch (t: Throwable) {
            Log.e(TAG, "setRepeatingRequest failed on a freshly configured session ($purpose)", t)
            onSessionConfigureFailed(gen, purpose)
            return
        }

        if (purpose == SessionPurpose.INITIAL) {
            isOpening.set(false)
            isRecoveryOpen = false
            isRunning.set(true)
            reopenAttempt = 0
            healthInterrupted = false
            updateHealth("cameraReady")
        }
        watchdog.noteSessionStarted(SystemClock.elapsedRealtime())
        // Covers both the normal start and an encoder rebuild whose own
        // ENCODER_RESTART session was superseded by a NEW_PREVIEW one
        // before it configured.
        ensureDrainThread()

        // The preview surface changed while this session was being built
        // (e.g. a headless recovery reopen finished after the TextureView
        // came back) -- rebuild once more with the current one.
        val current = previewSurface
        if (current != null && current !== preview) {
            recreateSessionWithNewPreview(current)
        }
    }

    @Synchronized
    private fun onSessionConfigureFailed(gen: Int, purpose: SessionPurpose) {
        if (gen != sessionGen) return
        when (purpose) {
            // Best-effort, as before: the framework already closed the old
            // session when this one was requested, so if frames really
            // stopped, the watchdog notices within its window and rebuilds.
            SessionPurpose.NEW_PREVIEW -> Unit
            SessionPurpose.ENCODER_RESTART -> restartPipeline("sessionConfigureFailed")
            SessionPurpose.INITIAL -> {
                if (isRecoveryOpen) {
                    handleCameraLost(deviceGen, CameraLossKind.CONFIGURE_FAILED, null)
                } else {
                    // Previously this released only the video encoder and left
                    // the camera device + AudioRecord/audio thread running.
                    stopInternal()
                    callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao configurar sessão de captura.")
                }
            }
        }
    }

    private fun cameraLossKindFor(error: Int): CameraLossKind = when (error) {
        CameraDevice.StateCallback.ERROR_CAMERA_IN_USE -> CameraLossKind.IN_USE
        CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE -> CameraLossKind.MAX_CAMERAS_IN_USE
        CameraDevice.StateCallback.ERROR_CAMERA_DISABLED -> CameraLossKind.DISABLED
        CameraDevice.StateCallback.ERROR_CAMERA_DEVICE -> CameraLossKind.DEVICE_ERROR
        else -> CameraLossKind.SERVICE_ERROR
    }

    private fun errorCodeFor(kind: CameraLossKind): String = when (kind) {
        CameraLossKind.IN_USE, CameraLossKind.MAX_CAMERAS_IN_USE, CameraLossKind.DISCONNECTED -> CircularBufferErrorCodes.CAMERA_BUSY
        else -> CircularBufferErrorCodes.ENCODER_INIT_FAILED
    }

    /**
     * The camera device went away (onDisconnected/onError) or a recovery
     * session failed to configure. Always ends with a truthful state:
     * the pipeline is torn down (isRunning false, so isBuffering() and
     * JS's AppState restart agree), any in-flight recording is finalized
     * with what it already captured, and -- if the buffer had actually been
     * running (or this was already a recovery attempt) -- `interrupted` is
     * emitted and a reopen is scheduled with exponential backoff
     * ([cameraReopenDelayMs]). A failure on a *JS-initiated* first open keeps
     * the pre-existing immediate CircularBufferError instead: the user just
     * pressed/opened something and should hear about it now, not after a
     * minute of silent retries.
     */
    @Synchronized
    private fun handleCameraLost(gen: Int, kind: CameraLossKind, errorCode: Int?) {
        if (gen != deviceGen) return
        val wasEstablished = isRunning.get() || isRecoveryOpen
        Log.w(TAG, "Camera lost: $kind (error=$errorCode, wasEstablished=$wasEstablished)")
        finalizeInFlightRecording()
        stopInternal(keepZoom = true)

        if (!wasEstablished && kind != CameraLossKind.DISCONNECTED) {
            appliedZoom = null
            val message = "Câmera indisponível (código ${errorCode ?: -1}). Verifique se outro app não está usando a câmera."
            callback?.onError(errorCodeFor(kind), message)
            return
        }
        healthRecovering = false
        healthInterrupted = true
        updateHealth(if (kind == CameraLossKind.DISCONNECTED) "cameraDisconnected" else "cameraError")
        scheduleReopen(kind)
    }

    private fun scheduleReopen(kind: CameraLossKind) {
        if (pendingConfig == null) return
        val delay = cameraReopenDelayMs(kind, reopenAttempt)
        if (delay == null) {
            // Out of retries (or DISABLED): stay interrupted, tell JS. The
            // buffer is genuinely stopped, so the next foreground's
            // isBuffering() == false restarts it from scratch.
            Log.e(TAG, "Giving up reopening the camera after $reopenAttempt attempts ($kind)")
            reopenAttempt = 0
            callback?.onError(errorCodeFor(kind), "A câmera foi interrompida e não pôde ser reaberta.")
            return
        }
        reopenAttempt++
        lastLossKind = kind
        watchdogHandler.removeCallbacks(reopenRunnable)
        watchdogHandler.postDelayed(reopenRunnable, delay)
    }

    private fun cancelScheduledReopen() {
        watchdogHandler.removeCallbacks(reopenRunnable)
    }

    /**
     * Backoff timer fired. Only reopens where a reopen can actually work and
     * is wanted: never after stopBuffering() (pendingConfig null); never while
     * backgrounded with background recording compiled out (the OS would
     * just revoke it again -- JS's AppState handler restarts on foreground);
     * and not in the foreground without a preview surface (the user navigated
     * to Settings/Gallery -- the normal attachPreviewSurface() cold start
     * handles coming back). Backgrounded *with* the flag on, it reopens
     * headless.
     */
    @Synchronized
    private fun attemptReopen() {
        if (pendingConfig == null || isRunning.get() || isOpening.get()) return
        if (isBackgroundMode && !FeatureFlags.BACKGROUND_RECORDING_ENABLED) return
        if (previewSurface == null && !isBackgroundMode) return
        Log.i(TAG, "Reopening camera (attempt $reopenAttempt after $lastLossKind)")
        openCameraAndStart(recovery = true)
    }

    // --- Watchdog ---

    private fun startWatchdogTicks() {
        if (watchdogTicking) return
        watchdogTicking = true
        watchdogHandler.postDelayed(watchdogTick, WATCHDOG_TICK_MS)
    }

    private fun stopWatchdogTicks() {
        if (!watchdogTicking) return
        watchdogTicking = false
        watchdogHandler.removeCallbacks(watchdogTick)
    }

    /**
     * 1 Hz frame-flow check (see [FrameFlowWatchdog] for the escalation
     * policy). Only armed while the pipeline is actually running -- a reopen
     * in progress or backoff wait isn't a stall -- and, with background
     * recording compiled out, never while backgrounded (nothing is supposed
     * to be capturing then). With the flag on it keeps watching in the
     * background too: that's exactly when nobody would otherwise notice a
     * dead buffer.
     */
    @Synchronized
    private fun onWatchdogTick() {
        if (!watchdogTicking || pendingConfig == null) {
            watchdogTicking = false
            return
        }
        val active = isRunning.get() && (!isBackgroundMode || FeatureFlags.BACKGROUND_RECORDING_ENABLED)
        when (watchdog.evaluate(SystemClock.elapsedRealtime(), lastVideoFrameAtMs, active)) {
            WatchdogAction.NONE -> Unit
            WatchdogAction.RECOVERED -> {
                healthRecovering = false
                updateHealth("framesFlowing")
            }
            WatchdogAction.RESTART_ENCODER -> restartEncoder("watchdog")
            WatchdogAction.RESTART_PIPELINE -> restartPipeline("watchdog")
            WatchdogAction.GIVE_UP -> giveUp("watchdog")
        }
        if (watchdogTicking) watchdogHandler.postDelayed(watchdogTick, WATCHDOG_TICK_MS)
    }

    private fun giveUp(reason: String) {
        Log.e(TAG, "Buffer could not be recovered ($reason), stopping")
        finalizeInFlightRecording()
        stopInternal()
        watchdog.reset()
        healthRecovering = false
        healthInterrupted = true
        updateHealth("${reason}GaveUp")
        callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "O buffer de vídeo parou e não pôde ser recuperado.")
    }

    /** Called (via [watchdogHandler]) by the drain thread when its codec threw something it
     *  can't retry through. Ignored if that codec has already been replaced. */
    @Synchronized
    private fun onEncoderFailed(codec: MediaCodec, reason: String) {
        if (encoder !== codec || !isRunning.get()) return
        when (watchdog.forceEscalation(SystemClock.elapsedRealtime())) {
            WatchdogAction.RESTART_ENCODER -> restartEncoder(reason)
            WatchdogAction.RESTART_PIPELINE -> restartPipeline(reason)
            WatchdogAction.GIVE_UP -> giveUp(reason)
            else -> Unit
        }
    }

    /**
     * Rebuilds just the MediaCodec encoder (and, necessarily, the capture
     * session -- its output list holds the old encoder's input Surface) on
     * the still-open camera. Cheaper and less disruptive than a full restart
     * (no camera reopen, audio keeps running), which is why it's the first
     * escalation step.
     *
     * Ring buffer integrity: frames from the old encoder carry a different
     * codec configuration (SPS/PPS in the output format) than the new one's,
     * and finalizeSave writes every frame of a clip under a single track
     * format -- so the video ring buffer is cleared here (some pre-roll is
     * lost, unavoidably) and an in-flight manual recording is finalized
     * right now with the frames it already has, under the old format,
     * rather than mixing both encoders' output in one file. JS's eventual
     * stopManualRecording() then receives that clip (see [orphanedSave]).
     */
    @Synchronized
    private fun restartEncoder(reason: String) {
        if (!isRunning.get()) return
        val device = cameraDevice
        val config = pendingConfig
        if (device == null || config == null) {
            restartPipeline(reason)
            return
        }
        Log.w(TAG, "Rebuilding video encoder ($reason)")
        healthRecovering = true
        updateHealth(reason)

        // Invalidate any in-flight session callbacks and stop feeding the old surface.
        sessionGen++
        try {
            captureSession?.stopRepeating()
            captureSession?.close()
        } catch (_: Throwable) {
        }
        captureSession = null
        requestBuilder = null
        sessionPreviewSurface = null

        // encoder !== drainCodec ends the drain loop; join it before touching
        // pendingSave so no old-encoder frame can land after the snapshot.
        val oldCodec = encoder
        val oldSurface = encoderInputSurface
        encoder = null
        encoderInputSurface = null
        drainThread?.join(500)
        drainThread = null
        drainCodec = null

        finalizeInFlightRecording()
        ringBuffer?.clear()
        encoderOutputFormat = null
        try {
            oldCodec?.stop()
        } catch (_: Throwable) {
        }
        try {
            oldCodec?.release()
        } catch (_: Throwable) {
        }
        oldSurface?.release()

        try {
            createVideoEncoder(config)
        } catch (t: Throwable) {
            Log.e(TAG, "Encoder rebuild failed, escalating to pipeline restart", t)
            restartPipeline(reason)
            return
        }
        createSession(device, previewSurface, SessionPurpose.ENCODER_RESTART)
    }

    /**
     * Full stop + reopen keeping [pendingConfig] (and the current zoom),
     * the second escalation step. Headless when backgrounded with no preview
     * surface; in the foreground without one (navigated away) the next
     * attachPreviewSurface() reopens instead.
     */
    @Synchronized
    private fun restartPipeline(reason: String) {
        if (pendingConfig == null) return
        Log.w(TAG, "Restarting capture pipeline ($reason)")
        healthRecovering = true
        updateHealth(reason)
        finalizeInFlightRecording()
        stopInternal(keepZoom = true)
        openCameraAndStart(recovery = true)
    }

    private fun updateHealth(reason: String?) {
        val state = resolveBufferHealth(healthInterrupted, healthRecovering, healthThrottled)
        if (state == lastEmittedHealth) return
        lastEmittedHealth = state
        try {
            callback?.onHealth(state.wire, reason)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to emit health event", t)
        }
    }

    // --- Thermal step-down ---

    /**
     * PowerManager.addThermalStatusListener (API 29+; no-op below). Callbacks
     * arrive on [watchdogHandler]. Registered while armed (configureAndArm ..
     * stop), so a status change while the camera is momentarily closed is
     * still remembered for the next open.
     */
    private fun registerThermalListener(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        if (thermalListener != null) return
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        try {
            val listener = PowerManager.OnThermalStatusChangedListener { status -> onThermalStatusChanged(status) }
            pm.addThermalStatusListener(Executor { watchdogHandler.post(it) }, listener)
            thermalListener = listener
            thermalStatus = pm.currentThermalStatus
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to register thermal listener", t)
        }
    }

    private fun unregisterThermalListener() {
        val listener = thermalListener ?: return
        thermalListener = null
        thermalStatus = 0
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val pm = appContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        try {
            pm.removeThermalStatusListener(listener as PowerManager.OnThermalStatusChangedListener)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to unregister thermal listener", t)
        }
    }

    @Synchronized
    private fun onThermalStatusChanged(status: Int) {
        if (thermalListener == null) return
        thermalStatus = status
        applyThermalFps()
    }

    /**
     * Applies [effectiveFps] to the *live* repeating request -- the same
     * mutate-the-builder + setRepeatingRequest pattern as setZoom (see
     * DECISIONS.md "Camera zoom"), never a session/encoder recreation, so a
     * thermal change can't interrupt the buffer or an in-flight recording.
     * The encoder keeps its configured KEY_FRAME_RATE (it's only a rate-
     * control hint for a Surface-input encoder; timestamps come from the
     * camera), so clips recorded while throttled simply have fewer frames.
     */
    private fun applyThermalFps() {
        val config = pendingConfig ?: return
        val fps = effectiveFps(config.fps, thermalStatus)
        healthThrottled = fps < config.fps
        if (availableFpsRanges.isNotEmpty()) {
            val range = fpsRangeFor(config.fps, fps)
            if (range != targetFpsRange) {
                targetFpsRange = range
                val session = captureSession
                val builder = requestBuilder
                if (range != null && session != null && builder != null) {
                    try {
                        builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                        session.setRepeatingRequest(builder.build(), null, cameraHandler)
                    } catch (t: Throwable) {
                        Log.e(TAG, "Failed to apply thermal fps range", t)
                    }
                }
            }
        }
        updateHealth("thermal")
    }

    /**
     * Without a pinned target, auto-exposure is free to lower the frame
     * rate in dim lighting to keep exposure time up -- a common OEM ISP
     * behavior (very noticeable on MediaTek chipsets) that leaves the
     * encoder still assuming `config.fps` throughout, so the saved clip
     * ends up with real gaps between frame timestamps and plays back as if
     * it's dropping frames. Pinning a fixed range forces constant frame
     * delivery, trading noisier low-light frames (via ISO gain) for smooth
     * playback, which is the right tradeoff for a video-first app.
     *
     * Replaces the old CameraCharacteristics-reading overload of
     * pickTargetFpsRange: the camera's ranges are now read once per open into
     * [availableFpsRanges] so a thermal change can re-pick without them.
     * Thermally reduced rates use [pickThrottledFpsRange] (a lower *ceiling*
     * is the point there), the configured rate the normal picker.
     */
    private fun fpsRangeFor(configuredFps: Int, fps: Int): Range<Int>? {
        val picked = if (fps < configuredFps) {
            pickThrottledFpsRange(availableFpsRanges, fps)
        } else {
            pickTargetFpsRange(availableFpsRanges, fps)
        } ?: return null
        return Range(picked.lower, picked.upper)
    }

    // --- Drain / audio ---

    private fun ensureDrainThread() {
        val codec = encoder ?: return
        if (!isRunning.get() || drainCodec === codec) return
        startDrainThread(codec)
    }

    /**
     * Drains [codec] into the ring buffer until the pipeline stops or the
     * codec is replaced (encoder !== codec). MediaCodec failures no longer
     * just `break` and leave the buffer silently dead: a transient
     * CodecException is retried briefly, anything else is handed to
     * [onEncoderFailed] (posted -- this thread never takes the controller
     * lock) which rebuilds per the watchdog's escalation policy.
     */
    private fun startDrainThread(codec: MediaCodec) {
        drainCodec = codec
        drainThread = Thread({
            val bufferInfo = MediaCodec.BufferInfo()
            var transientErrors = 0
            while (isRunning.get() && encoder === codec) {
                try {
                    val outIndex = codec.dequeueOutputBuffer(bufferInfo, OUTPUT_TIMEOUT_US)
                    when {
                        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            encoderOutputFormat = codec.outputFormat
                        }
                        outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                            // no output yet, keep polling
                        }
                        outIndex >= 0 -> {
                            val outputBuffer = codec.getOutputBuffer(outIndex)
                            if (outputBuffer != null && bufferInfo.size > 0 &&
                                (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                            ) {
                                outputBuffer.position(bufferInfo.offset)
                                outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                                val data = ByteArray(bufferInfo.size)
                                outputBuffer.get(data)
                                val isKeyFrame = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                                val frame = EncodedFrame(data, bufferInfo.presentationTimeUs, isKeyFrame)
                                ringBuffer?.add(frame)
                                onFrameEncoded(frame)
                                lastVideoFrameAtMs = SystemClock.elapsedRealtime()
                            }
                            codec.releaseOutputBuffer(outIndex, false)
                        }
                    }
                    transientErrors = 0
                } catch (e: MediaCodec.CodecException) {
                    if (!isRunning.get() || encoder !== codec) break // torn down under us -- expected
                    when (codecErrorAction(e.isTransient, transientErrors)) {
                        CodecErrorAction.RETRY -> {
                            transientErrors++
                            Log.w(TAG, "Transient encoder error (${e.diagnosticInfo}), retrying")
                            try {
                                Thread.sleep(20)
                            } catch (_: InterruptedException) {
                                break
                            }
                        }
                        CodecErrorAction.RECREATE_ENCODER -> {
                            Log.e(TAG, "Encoder error (recoverable=${e.isRecoverable}, ${e.diagnosticInfo})", e)
                            watchdogHandler.post { onEncoderFailed(codec, "codecError") }
                            break
                        }
                    }
                } catch (t: Throwable) {
                    if (!isRunning.get() || encoder !== codec) break
                    Log.e(TAG, "Encoder drain failed", t)
                    watchdogHandler.post { onEncoderFailed(codec, "codecError") }
                    break
                }
            }
        }, "CircularBufferDrain")
        drainThread!!.start()
    }

    private fun onFrameEncoded(frame: EncodedFrame) {
        // No auto-stop target here -- a manual recording only ends when
        // stopManualRecording() is called explicitly.
        val save = pendingSave ?: return
        synchronized(save.tailFrames) { save.tailFrames.add(frame) }
    }

    /**
     * Starts the mic capture + AAC encoder pair. Unlike the video encoder
     * (which is fed by the Camera2 surface and drained on its own thread),
     * audio has no Surface source: a single thread both reads PCM off
     * [AudioRecord] and drives the encoder's input/output buffer queues
     * directly, since buffer-mode `MediaCodec` encoding is a plain
     * synchronous request/response with no separate producer.
     *
     * Throws [SecurityException] if RECORD_AUDIO isn't granted (caller
     * treats that as fatal, mirroring the existing camera-permission
     * handling in [openCameraAndStart]); any other failure is left for the
     * caller to treat as non-fatal (video-only degrade).
     */
    @Suppress("MissingPermission")
    private fun startAudioCapture() {
        val minBufferSize = AudioRecord.getMinBufferSize(AUDIO_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minBufferSize > 0) { "AudioRecord.getMinBufferSize falhou" }

        val record = AudioRecord(
            MediaRecorder.AudioSource.CAMCORDER,
            AUDIO_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            minBufferSize * 4,
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            error("AudioRecord não inicializou")
        }

        val format = MediaFormat.createAudioFormat(AUDIO_MIME_TYPE, AUDIO_SAMPLE_RATE, AUDIO_CHANNEL_COUNT).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BIT_RATE)
        }
        val encoder = MediaCodec.createEncoderByType(AUDIO_MIME_TYPE)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()

        audioRecord = record
        audioEncoder = encoder
        record.startRecording()
        isAudioRunning.set(true)

        audioThread = Thread({
            runAudioEncodeLoop(record, encoder)
            // The loop only exits on its own (isAudioRunning still true) when
            // the mic or AAC encoder died under it -- previously that left
            // clips silently video-only for the rest of the session.
            if (isAudioRunning.get() && audioEncoder === encoder) {
                watchdogHandler.post { restartAudioCapture(encoder) }
            }
        }, "CircularBufferAudio").apply { start() }
    }

    /**
     * Best-effort audio self-heal, bounded to [MAX_AUDIO_RESTARTS_PER_SESSION]
     * per camera session so a permanently broken mic can't loop. The new AAC
     * encoder has the identical configuration (AAC-LC, 44.1 kHz mono, same
     * bitrate), so its output format -- and csd -- match the old one's, and
     * an in-flight recording's audio track stays consistent across the swap.
     */
    @Synchronized
    private fun restartAudioCapture(failed: MediaCodec) {
        if (audioEncoder !== failed || !(isRunning.get() || isOpening.get())) return
        isAudioRunning.set(false)
        audioThread?.join(500)
        audioThread = null
        releaseAudioCapture()
        if (audioRestarts >= MAX_AUDIO_RESTARTS_PER_SESSION) {
            Log.e(TAG, "Audio capture failed repeatedly, continuing video-only")
            return
        }
        audioRestarts++
        try {
            startAudioCapture()
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to restart audio capture, continuing video-only", t)
            releaseAudioCapture()
        }
    }

    /**
     * PCM chunks have no capture-hardware timestamp of their own (unlike the
     * video encoder's Camera2 surface buffers), so each chunk's
     * presentation time is derived from a running sample count seeded at
     * `System.nanoTime()` when recording starts -- the same basis Camera2's
     * own surface-buffer timestamps use on most devices. This is a relative,
     * not hardware-clock-exact, alignment: acceptable drift (a few ms over a
     * sub-60s clip) for this app, not achievable to tighten further without
     * much more machinery. See DECISIONS.md "Audio".
     */
    private fun runAudioEncodeLoop(record: AudioRecord, encoder: MediaCodec) {
        val pcmBuffer = ByteArray(4096)
        val audioStartUs = System.nanoTime() / 1_000L
        var totalSamplesEncoded = 0L
        val bufferInfo = MediaCodec.BufferInfo()
        // Bytes read from AudioRecord but not yet handed to the encoder --
        // carried across loop iterations so a too-small encoder input
        // buffer (see below) never causes audio data to be silently
        // dropped. Previously this was clamped and discarded per read,
        // which desynced the clip: the clock still advanced by the full
        // amount read while only part of it was actually encoded, so
        // clips played back with audio (and, by extension, A/V-synced
        // playback) running roughly 2x too fast on devices whose AAC
        // encoder buffer is about half of pcmBuffer's size.
        var pending = ByteArray(0)

        while (isAudioRunning.get()) {
            val bytesRead = try {
                record.read(pcmBuffer, 0, pcmBuffer.size)
            } catch (t: Throwable) {
                break
            }
            // ERROR_DEAD_OBJECT means the AudioRecord is gone for good (audio
            // server restarted, mic revoked) -- previously this `continue`d,
            // spinning a CPU core at 100% forever. Exit so the restart path
            // above kicks in. Other negative codes are momentary; yield.
            if (bytesRead == AudioRecord.ERROR_DEAD_OBJECT) break
            if (bytesRead < 0) {
                try {
                    Thread.sleep(10)
                } catch (_: InterruptedException) {
                    break
                }
                continue
            }
            if (bytesRead == 0) continue

            val chunk = if (pending.isEmpty()) pcmBuffer.copyOf(bytesRead) else pending + pcmBuffer.copyOf(bytesRead)
            pending = ByteArray(0)

            var offset = 0
            var encoderFailed = false
            while (offset < chunk.size) {
                val inputIndex = try {
                    encoder.dequeueInputBuffer(AUDIO_OUTPUT_TIMEOUT_US)
                } catch (t: Throwable) {
                    encoderFailed = true
                    break
                }
                if (inputIndex < 0) {
                    // No input buffer free right now -- keep the rest for
                    // the next iteration instead of spinning or dropping it.
                    pending = chunk.copyOfRange(offset, chunk.size)
                    break
                }
                try {
                    val inputBuffer = encoder.getInputBuffer(inputIndex)
                    inputBuffer?.clear()
                    // Some devices' AAC encoders hand back an input buffer
                    // smaller than pcmBuffer's 4096 bytes; writing more than it
                    // can hold throws BufferOverflowException, so clamp to its
                    // capacity and carry the remainder into the next buffer.
                    val writeSize = minOf(chunk.size - offset, inputBuffer?.remaining() ?: (chunk.size - offset))
                    inputBuffer?.put(chunk, offset, writeSize)
                    val presentationTimeUs = audioStartUs + (totalSamplesEncoded * 1_000_000L / AUDIO_SAMPLE_RATE)
                    encoder.queueInputBuffer(inputIndex, 0, writeSize, presentationTimeUs, 0)
                    totalSamplesEncoded += writeSize / 2 // 16-bit mono: 2 bytes/sample
                    offset += writeSize
                } catch (t: Throwable) {
                    encoderFailed = true
                    break
                }
            }
            if (encoderFailed) break

            if (!drainAudioEncoder(encoder, bufferInfo)) break
        }

        // Flush whatever's left once buffering stops.
        drainAudioEncoder(encoder, bufferInfo)
    }

    /** @return false if the encoder threw (it's unusable; the caller exits its loop). */
    private fun drainAudioEncoder(encoder: MediaCodec, bufferInfo: MediaCodec.BufferInfo): Boolean {
        while (true) {
            try {
                val outIndex = encoder.dequeueOutputBuffer(bufferInfo, 0)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        audioEncoderOutputFormat = encoder.outputFormat
                    }
                    outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> return true
                    outIndex >= 0 -> {
                        val outputBuffer = encoder.getOutputBuffer(outIndex)
                        if (outputBuffer != null && bufferInfo.size > 0 &&
                            (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                        ) {
                            outputBuffer.position(bufferInfo.offset)
                            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                            val data = ByteArray(bufferInfo.size)
                            outputBuffer.get(data)
                            val frame = EncodedFrame(data, bufferInfo.presentationTimeUs, true)
                            audioRingBuffer?.add(frame)
                            onAudioFrameEncoded(frame)
                        }
                        encoder.releaseOutputBuffer(outIndex, false)
                    }
                    else -> return true
                }
            } catch (t: Throwable) {
                return false
            }
        }
    }

    private fun onAudioFrameEncoded(frame: EncodedFrame) {
        val save = pendingSave ?: return
        synchronized(save.audioTailFrames) { save.audioTailFrames.add(frame) }
    }

    /**
     * Starts a manual recording: snapshots the current pre-roll buffer
     * (governed by the configured `bufferSeconds`) as the clip's head, then
     * keeps accumulating every new frame as the tail until the user taps
     * stop ([stopManualRecording]) -- the manually-recorded portion's length
     * is however long the user keeps recording, not a fixed post-roll.
     */
    @Synchronized
    fun startManualRecording(moviesDir: File, callback: StartRecordingCallback) {
        val buffer = ringBuffer
        if (!isRunning.get() || buffer == null) {
            callback.onFailed(CircularBufferErrorCodes.NOT_BUFFERING, "O buffer não está ativo.")
            return
        }
        if (pendingSave != null) {
            callback.onFailed(CircularBufferErrorCodes.SAVE_FAILED, "Já existe uma gravação em andamento.")
            return
        }
        if (orphanedSave != null) {
            // JS is starting a new recording without ever having claimed the
            // one the native side finalized early (e.g. a JS reload in
            // between). That clip is already on disk in PegueiClips, so
            // nothing is lost by dropping the claim -- holding it would
            // otherwise block recording forever.
            Log.w(TAG, "Dropping unclaimed early-finalized recording")
            orphanedSave = null
        }

        if (!moviesDir.exists()) moviesDir.mkdirs()
        val freeBytes = moviesDir.usableSpace
        if (freeBytes < MIN_FREE_BYTES) {
            callback.onFailed(CircularBufferErrorCodes.STORAGE_FULL, "Armazenamento insuficiente para gravar o clipe.")
            return
        }

        val head = buffer.snapshotFromOldestKeyframe()
        val audioHead = audioRingBuffer?.snapshot() ?: emptyList()
        val outputFile = File(moviesDir, "clip_${System.currentTimeMillis()}.mp4")
        pendingSave = PendingSave(head, mutableListOf(), audioHead, mutableListOf(), outputFile)
        callback.onStarted()
    }

    @Synchronized
    fun stopManualRecording(callback: SaveClipCallback) {
        val save = pendingSave
        if (save == null) {
            // The recording was cut short by an encoder rebuild / pipeline
            // restart and already finalized natively -- hand JS that clip.
            val orphan = orphanedSave
            if (orphan != null) {
                orphanedSave = null
                orphan.await { deliverSaveOutcome(it, callback) }
                return
            }
            callback.onFailed(CircularBufferErrorCodes.SAVE_FAILED, "Nenhuma gravação em andamento.")
            return
        }
        pendingSave = null
        // This clip's frames are already captured into `save` (headFrames/
        // tailFrames), decoupled from the ring buffers -- so clearing them
        // here is safe and necessary: otherwise footage already saved in
        // this clip's tail keeps sitting in the ring buffer and resurfaces
        // as pre-roll ("head") for whatever manual recording starts next,
        // duplicating content across consecutive clips.
        ringBuffer?.clear()
        audioRingBuffer?.clear()
        finalizeSave(save) { deliverSaveOutcome(it, callback) }
    }

    private fun deliverSaveOutcome(outcome: SaveOutcome, callback: SaveClipCallback) {
        when (outcome) {
            is SaveOutcome.Saved -> callback.onSaved(outcome.path, outcome.durationSeconds)
            is SaveOutcome.Failed -> callback.onFailed(outcome.code, outcome.message)
        }
    }

    /**
     * An in-flight manual recording whose encoder (or whole pipeline) is
     * about to be torn down by recovery: finalize it now with exactly the
     * frames it has, under the format of the encoder that produced them
     * (finalizeSave snapshots the formats synchronously, before the caller
     * swaps them), and park the outcome for JS's stopManualRecording(). The
     * frames recorded after the rebuild aren't part of this clip -- splicing
     * two encoders' bitstreams into one track is exactly the format mixing
     * the plan rules out -- so the user gets the clip up to the failure,
     * not a corrupt one.
     */
    private fun finalizeInFlightRecording() {
        val save = pendingSave ?: return
        pendingSave = null
        Log.w(TAG, "Finalizing in-flight recording early (pipeline recovery)")
        val deferred = DeferredSaveOutcome()
        orphanedSave = deferred
        finalizeSave(save) { deferred.complete(it) }
    }

    private fun finalizeSave(save: PendingSave, onOutcome: (SaveOutcome) -> Unit) {
        // Snapshot formats and frame lists on the calling thread: by the time
        // the mux thread runs, recovery may already have swapped in a new
        // encoder (and nulled/replaced encoderOutputFormat).
        val videoFormat = encoderOutputFormat
        val audioFormat = audioEncoderOutputFormat
        val allVideoFrames = save.headFrames + synchronized(save.tailFrames) { save.tailFrames.toList() }
        val allAudioFrames = save.audioHeadFrames + synchronized(save.audioTailFrames) { save.audioTailFrames.toList() }

        Thread({
            var muxer: MediaMuxer? = null
            try {
                val format = videoFormat
                    ?: throw EncoderInitException("Formato do encoder ainda não disponível.")
                if (allVideoFrames.isEmpty()) throw EncoderInitException("Nenhum quadro de vídeo foi capturado.")
                muxer = MediaMuxer(save.outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                // The encoder input surface is fed directly from the Camera2
                // session in the back camera's native sensor orientation
                // (landscape); the app is portrait-only, so stamp a fixed
                // 90° rotation hint or players show the clip on its side.
                muxer.setOrientationHint(90)
                val videoTrackIndex = muxer.addTrack(format)

                // Audio is added only if a track actually got captured this
                // session -- if the mic never produced output (e.g. a
                // transient AudioRecord/encoder failure), the clip still
                // saves successfully as video-only rather than failing the
                // whole save.
                val audioTrackIndex = if (audioFormat != null && allAudioFrames.isNotEmpty()) {
                    muxer.addTrack(audioFormat)
                } else {
                    -1
                }

                muxer.start()

                val startUs = allVideoFrames.first().presentationTimeUs

                data class MuxItem(val frame: EncodedFrame, val trackIndex: Int)
                // Audio capture starts independently of video (separate
                // AudioRecord + System.nanoTime()-seeded clock), so an
                // audio frame can predate the video's own start. Rebasing
                // those to a negative presentationTimeUs against startUs
                // is rejected by MediaMuxer -- drop them, a few
                // milliseconds of lost pre-roll audio at most.
                val items = allVideoFrames.map { MuxItem(it, videoTrackIndex) } +
                    if (audioTrackIndex >= 0) {
                        allAudioFrames.filter { it.presentationTimeUs >= startUs }.map { MuxItem(it, audioTrackIndex) }
                    } else {
                        emptyList()
                    }
                val sortedItems = items.sortedBy { it.frame.presentationTimeUs }

                val info = MediaCodec.BufferInfo()
                for (item in sortedItems) {
                    val frame = item.frame
                    val buffer = ByteBuffer.wrap(frame.data)
                    info.set(
                        0,
                        frame.data.size,
                        frame.presentationTimeUs - startUs,
                        if (frame.isKeyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0,
                    )
                    muxer.writeSampleData(item.trackIndex, buffer, info)
                }

                muxer.stop()
                muxer.release()
                muxer = null

                // Save verification: only resolve once the file is really
                // there with content (JS plays the "saved" cue on resolve).
                val file = save.outputFile
                if (!isSavedClipValid(file.exists(), file.length())) {
                    throw IllegalStateException("Arquivo do clipe ausente ou vazio após salvar.")
                }

                val durationSeconds = if (allVideoFrames.size >= 2) {
                    (allVideoFrames.last().presentationTimeUs - startUs) / 1_000_000.0
                } else {
                    0.0
                }
                onOutcome(SaveOutcome.Saved(file.absolutePath, durationSeconds))
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to mux clip", t)
                try {
                    muxer?.release()
                } catch (_: Throwable) {
                }
                // Never leave a truncated/0-byte file behind for the gallery to list.
                try {
                    save.outputFile.delete()
                } catch (_: Throwable) {
                }
                onOutcome(SaveOutcome.Failed(CircularBufferErrorCodes.SAVE_FAILED, "Falha ao gerar o arquivo de vídeo: ${t.message}"))
            }
        }, "CircularBufferMux").start()
    }

    /**
     * Reads the zoom range for the currently-open camera. `hasUltraWide` is
     * true only when the device actually reports a zoom-ratio minimum below
     * 1.0 (a logical multi-camera whose set includes an ultra-wide lens) --
     * the crop-region digital-zoom fallback below API 30 (or on a device
     * that simply doesn't report a range) can never go below 1.0, so
     * `hasUltraWide` correctly comes back false there, and the JS side hides
     * the 0.5x pill rather than showing one that wouldn't do anything.
     */
    @Synchronized
    fun getZoomInfo(): ZoomInfo? {
        if (!isRunning.get()) return null
        val range = zoomRatioRange
        return if (range != null) {
            ZoomInfo(range.lower.toDouble(), range.upper.toDouble(), range.lower <= 0.6f)
        } else {
            ZoomInfo(1.0, maxDigitalZoom.toDouble(), false)
        }
    }

    /**
     * Live zoom, safe to call at any point while buffering/recording: this
     * only mutates the existing repeating request's zoom parameter and
     * resubmits it via `setRepeatingRequest` on the same builder/session --
     * it never touches `createCaptureSession`/the surfaces/inputs, so it
     * cannot restart the capture session or interrupt an in-flight manual
     * recording. See DECISIONS.md "Zoom".
     */
    @Synchronized
    fun setZoom(factor: Float): Float {
        val session = captureSession ?: throw IllegalStateException("O buffer não está ativo.")
        val builder = requestBuilder ?: throw IllegalStateException("O buffer não está ativo.")

        val range = zoomRatioRange
        val applied: Float
        if (range != null) {
            applied = factor.coerceIn(range.lower, range.upper)
            builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, applied)
        } else {
            applied = factor.coerceIn(1f, maxDigitalZoom)
            sensorActiveArraySize?.let { activeArray ->
                builder.set(CaptureRequest.SCALER_CROP_REGION, cropRegionForZoom(activeArray, applied))
            }
        }
        session.setRepeatingRequest(builder.build(), null, cameraHandler)
        appliedZoom = applied
        return applied
    }

    /**
     * Prefers the widest range that still caps at `fps`, not the
     * tightest/exact one: a fixed (fps,fps) range forces the ISP to hold
     * frame rate even in dim light, which it does by cranking ISO gain --
     * visibly grainy footage. A wide floor (e.g. 15-30) lets it drop to a
     * lower, still-smooth rate and extend exposure instead, trading a
     * little frame-rate consistency for much cleaner frames.
     *
     * Expressed over the plain `FpsRange` (not `android.util.Range`) so this
     * decision logic is testable in a plain JUnit test: this project's unit
     * tests run against the unmocked Android SDK stub (no Robolectric),
     * which throws at runtime for any `android.util.*` call, `Range`
     * included -- mirrors why `FrameRingBuffer` itself is kept
     * Android-SDK-free. See PickTargetFpsRangeTest.kt.
     */
    internal fun pickTargetFpsRange(available: List<FpsRange>, fps: Int): FpsRange? {
        return available.filter { it.upper == fps }.minByOrNull { it.lower }
            ?: available.filter { it.upper >= fps }.minByOrNull { it.lower }
            ?: available.maxByOrNull { it.upper }
    }

    private fun cropRegionForZoom(activeArray: Rect, zoom: Float): Rect {
        val centerX = activeArray.width() / 2
        val centerY = activeArray.height() / 2
        val halfWidth = (0.5f * activeArray.width() / zoom).toInt()
        val halfHeight = (0.5f * activeArray.height() / zoom).toInt()
        return Rect(centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight)
    }

    @Synchronized
    fun stop() {
        pendingConfig = null
        cancelScheduledReopen()
        reopenAttempt = 0
        stopWatchdogTicks()
        watchdog.reset()
        unregisterThermalListener()
        // An explicit stop doesn't claim an early-finalized clip; it's on disk regardless.
        orphanedSave = null
        isPocketMode = false
        stopInternal()
        healthInterrupted = false
        healthRecovering = false
        healthThrottled = false
        updateHealth(null)
    }

    /**
     * Tears the whole pipeline down (camera, session, encoders, threads,
     * buffers). Does NOT clear [pendingConfig] -- that's [stop]'s job -- so
     * recovery can reopen with the same config afterwards.
     *
     * @param keepZoom keep [appliedZoom] for a native-initiated reopen (JS
     *   doesn't know one happened, so nothing else would restore the zoom).
     */
    private fun stopInternal(keepZoom: Boolean = false) {
        deviceGen++
        sessionGen++
        isRunning.set(false)
        isOpening.set(false)
        isRecoveryOpen = false
        isAudioRunning.set(false)
        pendingSave = null
        requestBuilder = null
        sessionPreviewSurface = null
        zoomRatioRange = null
        maxDigitalZoom = 1f
        sensorActiveArraySize = null
        targetFpsRange = null
        availableFpsRanges = emptyList()
        if (!keepZoom) appliedZoom = null

        try {
            captureSession?.stopRepeating()
            captureSession?.close()
        } catch (_: Throwable) {
        }
        captureSession = null

        try {
            cameraDevice?.close()
        } catch (_: Throwable) {
        }
        cameraDevice = null

        drainThread?.join(500)
        drainThread = null
        drainCodec = null

        releaseEncoder()

        audioThread?.join(500)
        audioThread = null

        releaseAudioCapture()

        cameraThread?.quitSafely()
        cameraThread = null
        cameraHandler = null

        ringBuffer?.clear()
        ringBuffer = null
        encoderOutputFormat = null

        audioRingBuffer?.clear()
        audioRingBuffer = null
        audioEncoderOutputFormat = null
    }

    private fun releaseEncoder() {
        try {
            encoder?.stop()
        } catch (_: Throwable) {
        }
        try {
            encoder?.release()
        } catch (_: Throwable) {
        }
        encoder = null
        encoderInputSurface?.release()
        encoderInputSurface = null
    }

    private fun releaseAudioCapture() {
        try {
            audioRecord?.stop()
        } catch (_: Throwable) {
        }
        try {
            audioRecord?.release()
        } catch (_: Throwable) {
        }
        audioRecord = null
        try {
            audioEncoder?.stop()
        } catch (_: Throwable) {
        }
        try {
            audioEncoder?.release()
        } catch (_: Throwable) {
        }
        audioEncoder = null
    }

    private fun pickBackCameraId(manager: CameraManager): String? {
        for (id in manager.cameraIdList) {
            val characteristics = manager.getCameraCharacteristics(id)
            if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) {
                return id
            }
        }
        return manager.cameraIdList.firstOrNull()
    }

    /**
     * Reports which quality presets this device's back camera actually
     * offers, and which of CANDIDATE_FPS_OPTIONS each of those qualities can
     * run at -- SettingsScreen uses this to disable/hide options the
     * hardware can't deliver instead of letting the user pick "4K" or
     * "60fps" on a device that can't actually produce it (pre-fix, such a
     * setting was simply ignored). Returns everything unsupported (empty
     * lists) if there's no back camera or no stream configuration data at
     * all, rather than throwing -- the JS side treats an empty capabilities
     * response as "couldn't determine, don't restrict anything".
     */
    fun captureCapabilities(context: Context): CaptureCapabilities {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = pickBackCameraId(manager) ?: return CaptureCapabilities(emptyList(), emptyMap())
        val characteristics = manager.getCameraCharacteristics(cameraId)
        val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?: return CaptureCapabilities(emptyList(), emptyMap())
        val fpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?.map { FpsRange(it.lower, it.upper) } ?: emptyList()
        val outputSizes = map.getOutputSizes(SurfaceTexture::class.java)?.toList() ?: emptyList()

        val supportedQualities = mutableListOf<String>()
        val fpsByQuality = mutableMapOf<String, List<Int>>()
        for ((quality, width, height) in QUALITY_PRESET_SIZES) {
            if (outputSizes.none { it.width == width && it.height == height }) continue
            supportedQualities.add(quality)

            // getOutputMinFrameDuration reports how fast this exact size can
            // actually be streamed (0 means "no data" on some devices, not
            // "zero duration") -- a candidate fps must fit under that cap
            // *and* fall inside one of the AE-exposed target ranges, mirroring
            // pickTargetFpsRange's own real-world constraint.
            val minDurationNs = map.getOutputMinFrameDuration(SurfaceTexture::class.java, Size(width, height))
            val maxFpsAtSize = if (minDurationNs > 0) 1_000_000_000.0 / minDurationNs else Double.MAX_VALUE
            fpsByQuality[quality] = CANDIDATE_FPS_OPTIONS.filter { candidate ->
                candidate <= maxFpsAtSize && fpsRanges.any { candidate >= it.lower && candidate <= it.upper }
            }
        }
        return CaptureCapabilities(supportedQualities, fpsByQuality)
    }

    private fun estimateBitRate(config: BufferConfig): Int {
        // ~0.12 bits per pixel per frame is a reasonable H.264 target for action-cam footage.
        return (config.width * config.height * config.fps * 0.12).toInt().coerceAtLeast(1_000_000)
    }

    private const val MIN_FREE_BYTES = 50L * 1024 * 1024 // 50MB safety margin
}
