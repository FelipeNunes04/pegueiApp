package com.felipenunes.pegueiapp.circularbuffer

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class CircularBufferModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CircularBufferModule"

    // Must match RNFS.DocumentDirectoryPath + "/PegueiClips" (files.ts CLIPS_DIR),
    // which is what the JS gallery reads from -- mirrors the iOS module's
    // documentDirectory/PegueiClips. Previously this pointed at
    // getExternalFilesDir(Movies), a different directory entirely, so saved
    // clips never showed up in the app's gallery.
    private fun moviesDir(): File {
        val dir = File(reactApplicationContext.filesDir, "PegueiClips")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /**
     * Camera errors (busy, disconnected) surface asynchronously, well after
     * startBuffering's promise already resolved -- there is no pending
     * Promise left to reject, so they're emitted as a JS event instead.
     * useCircularBuffer.ts subscribes via circularBufferEvents and routes
     * this into the same error banner as a rejected saveClip().
     */
    private fun emitError(code: String, message: String) {
        val params = WritableNativeMap()
        params.putString("code", code)
        params.putString("message", message)
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("CircularBufferError", params)
        }
    }

    @ReactMethod
    fun startBuffering(config: ReadableMap, promise: Promise) {
        try {
            val bufferConfig = BufferConfig(
                bufferSeconds = config.getInt("bufferSeconds"),
                width = config.getInt("width"),
                height = config.getInt("height"),
                fps = config.getInt("fps"),
            )
            CameraEncoderController.configureAndArm(
                reactApplicationContext,
                bufferConfig,
                object : CameraEncoderCallback {
                    override fun onError(code: String, message: String) {
                        emitError(code, message)
                    }
                },
            )
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.ENCODER_INIT_FAILED, t.message, t)
        }
    }

    // NativeEventEmitter(NativeModules.CircularBufferModule) on the JS side
    // calls these on subscribe/unsubscribe; they're no-ops because events are
    // emitted straight through RCTDeviceEventEmitter above, not tracked here.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    @ReactMethod
    fun stopBuffering(promise: Promise) {
        try {
            CameraEncoderController.stop()
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.SAVE_FAILED, t.message, t)
        }
    }

    @ReactMethod
    fun startManualRecording(promise: Promise) {
        CameraEncoderController.startManualRecording(
            moviesDir(),
            object : StartRecordingCallback {
                override fun onStarted() {
                    promise.resolve(null)
                }

                override fun onFailed(code: String, message: String) {
                    promise.reject(code, message)
                }
            },
        )
    }

    @ReactMethod
    fun stopManualRecording(promise: Promise) {
        CameraEncoderController.stopManualRecording(
            object : SaveClipCallback {
                override fun onSaved(path: String, durationSeconds: Double) {
                    val result = WritableNativeMap()
                    result.putString("path", path)
                    result.putDouble("durationSeconds", durationSeconds)
                    promise.resolve(result)
                }

                override fun onFailed(code: String, message: String) {
                    promise.reject(code, message)
                }
            },
        )
    }

    @ReactMethod
    fun isBuffering(promise: Promise) {
        promise.resolve(CameraEncoderController.isBuffering())
    }

    @ReactMethod
    fun setZoom(factor: Double, promise: Promise) {
        try {
            val applied = CameraEncoderController.setZoom(factor.toFloat())
            promise.resolve(applied.toDouble())
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.NOT_BUFFERING, t.message, t)
        }
    }

    @ReactMethod
    fun getZoomInfo(promise: Promise) {
        val info = CameraEncoderController.getZoomInfo()
        if (info == null) {
            promise.reject(CircularBufferErrorCodes.NOT_BUFFERING, "O buffer não está ativo.")
            return
        }
        val result = WritableNativeMap()
        result.putDouble("minZoom", info.minZoom)
        result.putDouble("maxZoom", info.maxZoom)
        result.putBoolean("hasUltraWide", info.hasUltraWide)
        promise.resolve(result)
    }
}
