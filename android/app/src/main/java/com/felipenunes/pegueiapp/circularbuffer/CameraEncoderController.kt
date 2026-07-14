package com.felipenunes.pegueiapp.circularbuffer

import android.content.Context
import android.graphics.Rect
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.view.Surface
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

data class BufferConfig(val bufferSeconds: Int, val width: Int, val height: Int, val fps: Int)

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
 * [FrameRingBuffer] of encoded frames. Video-only (no audio track): the
 * microphone is a single-consumer resource already claimed by the wake-word
 * voice processor while listening, so mixing in an AAC track here would
 * require arbitrating access to the mic between two native consumers. See
 * DECISIONS.md.
 *
 * There is only ever one active session app-wide, hence the singleton.
 */
object CameraEncoderController {
    private const val TAG = "CircularBuffer"
    private const val MIME_TYPE = MediaFormat.MIMETYPE_VIDEO_AVC
    private const val I_FRAME_INTERVAL_SECONDS = 1
    private const val OUTPUT_TIMEOUT_US = 10_000L

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

    private var previewSurface: Surface? = null
    private var previewWidth: Int = 0
    private var previewHeight: Int = 0

    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var drainThread: Thread? = null

    private val isRunning = AtomicBoolean(false)
    private val isOpening = AtomicBoolean(false)

    private var ringBuffer: FrameRingBuffer? = null

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
        if (previewSurface != null && !isRunning.get()) {
            openCameraAndStart()
        }
    }

    /** Called by the native preview view once its SurfaceTexture is ready. */
    @Synchronized
    fun attachPreviewSurface(surface: Surface, width: Int, height: Int) {
        previewSurface = surface
        previewWidth = width
        previewHeight = height
        if (pendingConfig != null && !isRunning.get()) {
            openCameraAndStart()
        }
    }

    @Synchronized
    fun detachPreviewSurface() {
        previewSurface = null
        stopInternal()
    }

    @Synchronized
    private fun openCameraAndStart() {
        val context = appContext ?: return
        val config = pendingConfig ?: return
        val preview = previewSurface ?: return
        if (isOpening.get() || isRunning.get()) return

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
        val outputFile = File(moviesDir, "clip_${System.currentTimeMillis()}.mp4")
        pendingSave = PendingSave(head, mutableListOf(), outputFile)
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
                val trackIndex = muxer.addTrack(format)
                muxer.start()

                val allFrames = save.headFrames + save.tailFrames
                val startUs = allFrames.firstOrNull()?.presentationTimeUs ?: 0L
                val info = MediaCodec.BufferInfo()
                for (frame in allFrames) {
                    val buffer = ByteBuffer.wrap(frame.data)
                    info.set(
                        0,
                        frame.data.size,
                        frame.presentationTimeUs - startUs,
                        if (frame.isKeyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0,
                    )
                    muxer.writeSampleData(trackIndex, buffer, info)
                }

                muxer.stop()
                muxer.release()

                val durationSeconds = if (allFrames.size >= 2) {
                    (allFrames.last().presentationTimeUs - startUs) / 1_000_000.0
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
        pendingSave = null
        requestBuilder = null
        zoomRatioRange = null
        maxDigitalZoom = 1f
        sensorActiveArraySize = null

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

        cameraThread?.quitSafely()
        cameraThread = null
        cameraHandler = null

        ringBuffer?.clear()
        ringBuffer = null
        encoderOutputFormat = null
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

    private fun pickBackCameraId(manager: CameraManager): String? {
        for (id in manager.cameraIdList) {
            val characteristics = manager.getCameraCharacteristics(id)
            if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) {
                return id
            }
        }
        return manager.cameraIdList.firstOrNull()
    }

    private fun estimateBitRate(config: BufferConfig): Int {
        // ~0.12 bits per pixel per frame is a reasonable H.264 target for action-cam footage.
        return (config.width * config.height * config.fps * 0.12).toInt().coerceAtLeast(1_000_000)
    }

    private const val MIN_FREE_BYTES = 50L * 1024 * 1024 // 50MB safety margin
}
