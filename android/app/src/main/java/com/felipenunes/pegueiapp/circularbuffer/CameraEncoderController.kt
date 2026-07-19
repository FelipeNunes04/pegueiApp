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
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import java.io.File
import java.nio.ByteBuffer
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
    // createCaptureSession() -- promoted from a local val to a field so
    // setZoom() can mutate it and resubmit via setRepeatingRequest() without
    // touching the session's surfaces/inputs, i.e. without any risk of
    // restarting the capture session or interrupting an in-flight manual
    // recording. See DECISIONS.md "Zoom".
    private var requestBuilder: CaptureRequest.Builder? = null
    private var zoomRatioRange: Range<Float>? = null
    private var maxDigitalZoom: Float = 1f
    private var sensorActiveArraySize: Rect? = null
    private var targetFpsRange: Range<Int>? = null

    private var previewView: CircularBufferPreviewView? = null
    private var previewSurfaceTexture: SurfaceTexture? = null
    private var previewSurface: Surface? = null

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var drainThread: Thread? = null

    private val isRunning = AtomicBoolean(false)
    private val isOpening = AtomicBoolean(false)

    private var ringBuffer: FrameRingBuffer? = null

    // Continuously-running mic capture + AAC encoder, parallel to the video
    // encoder/drain thread above. isAudioRunning is separate from isRunning:
    // audio starts synchronously right after the video encoder is
    // configured, well before isRunning flips true in createCaptureSession's
    // async onConfigured callback, so reusing isRunning as the audio loop's
    // condition would race it into never starting.
    private var audioRecord: AudioRecord? = null
    private var audioEncoder: MediaCodec? = null
    private var audioEncoderOutputFormat: MediaFormat? = null
    private var audioThread: Thread? = null
    private var audioRingBuffer: FrameRingBuffer? = null
    private val isAudioRunning = AtomicBoolean(false)

    @Volatile
    private var pendingSave: PendingSave? = null

    /**
     * A manual recording in flight: [headFrames] is the pre-roll snapshot
     * taken from the ring buffer the moment recording started; [tailFrames]
     * keeps accumulating every frame the encoder produces for as long as
     * recording continues, with no fixed target duration -- the user's own
     * "stop" tap is what ends it (see [stopManualRecording]).
     */
    private class PendingSave(
        val headFrames: List<EncodedFrame>,
        val tailFrames: MutableList<EncodedFrame>,
        val audioHeadFrames: List<EncodedFrame>,
        val audioTailFrames: MutableList<EncodedFrame>,
        val outputFile: File,
    )

    fun isBuffering(): Boolean = isRunning.get()

    /** Called by CircularBufferModule.startBuffering(). May run before the preview surface exists. */
    @Synchronized
    fun configureAndArm(context: Context, config: BufferConfig, cb: CameraEncoderCallback) {
        appContext = context.applicationContext
        pendingConfig = config
        callback = cb
        ringBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)
        audioRingBuffer = FrameRingBuffer(windowUs = config.bufferSeconds * 1_000_000L)
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
        if (pendingConfig != null && !isRunning.get()) {
            openCameraAndStart()
        }
    }

    @Synchronized
    fun detachPreviewSurface() {
        previewView = null
        previewSurfaceTexture = null
        previewSurface = null
        stopInternal()
    }

    @Synchronized
    private fun openCameraAndStart() {
        val context = appContext ?: return
        val config = pendingConfig ?: return
        val preview = previewSurface ?: return
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

        // Mirrors Google's Camera2Basic sample: the buffer is requested at
        // its native (landscape) size -- the same resolution already used
        // for the encoder, so it's a size the camera is known to support --
        // and the view's own *measured* box is constrained to the rotated
        // (portrait) aspect ratio via setAspectRatio, instead of trying to
        // fix the mismatch with a content Matrix.
        previewSurfaceTexture?.setDefaultBufferSize(config.width, config.height)
        previewView?.let { view -> view.post { view.setAspectRatio(config.height, config.width) } }

        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = pickBackCameraId(manager)
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
        targetFpsRange = pickTargetFpsRange(characteristics, config.fps)

        try {
            encoder = MediaCodec.createEncoderByType(MIME_TYPE)
            val format = MediaFormat.createVideoFormat(MIME_TYPE, config.width, config.height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, estimateBitRate(config))
                setInteger(MediaFormat.KEY_FRAME_RATE, config.fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL_SECONDS)
            }
            encoder!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoderInputSurface = encoder!!.createInputSurface()
            encoder!!.start()
        } catch (t: Throwable) {
            releaseEncoder()
            callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao iniciar o encoder: ${t.message}")
            return
        }

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
        cameraThread = HandlerThread("CircularBufferCamera").apply { start() }
        cameraHandler = Handler(cameraThread!!.looper)

        try {
            @Suppress("MissingPermission")
            manager.openCamera(
                cameraId,
                object : CameraDevice.StateCallback() {
                    override fun onOpened(device: CameraDevice) {
                        cameraDevice = device
                        createCaptureSession(device, preview)
                    }

                    override fun onDisconnected(device: CameraDevice) {
                        device.close()
                        cameraDevice = null
                        isOpening.set(false)
                    }

                    override fun onError(device: CameraDevice, error: Int) {
                        device.close()
                        cameraDevice = null
                        isOpening.set(false)
                        val busy = error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE ||
                            error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE
                        val code = if (busy) CircularBufferErrorCodes.CAMERA_BUSY else CircularBufferErrorCodes.ENCODER_INIT_FAILED
                        callback?.onError(code, "Câmera indisponível (código $error). Verifique se outro app não está usando a câmera.")
                        releaseEncoder()
                    }
                },
                cameraHandler,
            )
        } catch (e: SecurityException) {
            isOpening.set(false)
            releaseEncoder()
            callback?.onError(CircularBufferErrorCodes.CAMERA_PERMISSION, "Permissão de câmera não concedida.")
        } catch (t: Throwable) {
            isOpening.set(false)
            releaseEncoder()
            callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao abrir a câmera: ${t.message}")
        }
    }

    private fun createCaptureSession(device: CameraDevice, preview: Surface) {
        val encInputSurface = encoderInputSurface ?: return
        try {
            val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                addTarget(preview)
                addTarget(encInputSurface)
                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                targetFpsRange?.let { set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
            }
            requestBuilder = builder

            device.createCaptureSession(
                listOf(preview, encInputSurface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        captureSession = session
                        session.setRepeatingRequest(builder.build(), null, cameraHandler)
                        isOpening.set(false)
                        isRunning.set(true)
                        startDrainThread()
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        isOpening.set(false)
                        callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao configurar sessão de captura.")
                        releaseEncoder()
                    }
                },
                cameraHandler,
            )
        } catch (t: Throwable) {
            isOpening.set(false)
            callback?.onError(CircularBufferErrorCodes.ENCODER_INIT_FAILED, "Falha ao criar sessão de captura: ${t.message}")
        }
    }

    private fun startDrainThread() {
        drainThread = Thread({
            val bufferInfo = MediaCodec.BufferInfo()
            while (isRunning.get()) {
                val codec = encoder ?: break
                val outIndex = try {
                    codec.dequeueOutputBuffer(bufferInfo, OUTPUT_TIMEOUT_US)
                } catch (t: Throwable) {
                    break
                }
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
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                    }
                }
            }
        }, "CircularBufferDrain")
        drainThread!!.start()
    }

    private fun onFrameEncoded(frame: EncodedFrame) {
        // No auto-stop target here -- a manual recording only ends when
        // stopManualRecording() is called explicitly.
        pendingSave?.tailFrames?.add(frame)
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

        audioThread = Thread({ runAudioEncodeLoop(record, encoder) }, "CircularBufferAudio").apply { start() }
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
            if (bytesRead <= 0) continue

            val chunk = if (pending.isEmpty()) pcmBuffer.copyOf(bytesRead) else pending + pcmBuffer.copyOf(bytesRead)
            pending = ByteArray(0)

            var offset = 0
            while (offset < chunk.size) {
                val inputIndex = try {
                    encoder.dequeueInputBuffer(AUDIO_OUTPUT_TIMEOUT_US)
                } catch (t: Throwable) {
                    offset = chunk.size
                    break
                }
                if (inputIndex < 0) {
                    // No input buffer free right now -- keep the rest for
                    // the next iteration instead of spinning or dropping it.
                    pending = chunk.copyOfRange(offset, chunk.size)
                    break
                }
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
            }

            drainAudioEncoder(encoder, bufferInfo)
        }

        // Flush whatever's left once buffering stops.
        drainAudioEncoder(encoder, bufferInfo)
    }

    private fun drainAudioEncoder(encoder: MediaCodec, bufferInfo: MediaCodec.BufferInfo) {
        while (true) {
            val outIndex = try {
                encoder.dequeueOutputBuffer(bufferInfo, 0)
            } catch (t: Throwable) {
                return
            }
            when {
                outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    audioEncoderOutputFormat = encoder.outputFormat
                }
                outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> return
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
                else -> return
            }
        }
    }

    private fun onAudioFrameEncoded(frame: EncodedFrame) {
        pendingSave?.audioTailFrames?.add(frame)
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
            callback.onFailed(CircularBufferErrorCodes.SAVE_FAILED, "Nenhuma gravação em andamento.")
            return
        }
        pendingSave = null
        finalizeSave(save, callback)
    }

    private fun finalizeSave(save: PendingSave, callback: SaveClipCallback) {
        Thread({
            try {
                val format = encoderOutputFormat
                    ?: throw EncoderInitException("Formato do encoder ainda não disponível.")
                val muxer = MediaMuxer(save.outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
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
                val allAudioFrames = save.audioHeadFrames + save.audioTailFrames
                val audioFormat = audioEncoderOutputFormat
                val audioTrackIndex = if (audioFormat != null && allAudioFrames.isNotEmpty()) {
                    muxer.addTrack(audioFormat)
                } else {
                    -1
                }

                muxer.start()

                val allVideoFrames = save.headFrames + save.tailFrames
                val startUs = allVideoFrames.firstOrNull()?.presentationTimeUs ?: 0L

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

                val durationSeconds = if (allVideoFrames.size >= 2) {
                    (allVideoFrames.last().presentationTimeUs - startUs) / 1_000_000.0
                } else {
                    0.0
                }
                callback.onSaved(save.outputFile.absolutePath, durationSeconds)
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to mux clip", t)
                callback.onFailed(CircularBufferErrorCodes.SAVE_FAILED, "Falha ao gerar o arquivo de vídeo: ${t.message}")
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
        return applied
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
     */
    private fun pickTargetFpsRange(characteristics: CameraCharacteristics, fps: Int): Range<Int>? {
        val available = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?: return null
        val picked = pickTargetFpsRange(available.map { FpsRange(it.lower, it.upper) }, fps) ?: return null
        return Range(picked.lower, picked.upper)
    }

    /**
     * Prefers the widest range that still caps at `fps`, not the
     * tightest/exact one: a fixed (fps,fps) range forces the ISP to hold
     * frame rate even in dim light, which it does by cranking ISO gain --
     * visibly grainy footage. A wide floor (e.g. 15-30) lets it drop to a
     * lower, still-smooth rate and extend exposure instead, trading a
     * little frame-rate consistency for much cleaner frames.
     *
     * Split out from the `CameraCharacteristics`-reading overload above and
     * expressed over the plain `FpsRange` (not `android.util.Range`) so this
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
        stopInternal()
    }

    private fun stopInternal() {
        isRunning.set(false)
        isAudioRunning.set(false)
        pendingSave = null
        requestBuilder = null
        zoomRatioRange = null
        maxDigitalZoom = 1f
        sensorActiveArraySize = null
        targetFpsRange = null

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
