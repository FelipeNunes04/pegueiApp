package com.felipenunes.pegueiapp.circularbuffer

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.MediaActionSound
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.felipenunes.pegueiapp.FeatureFlags
import java.io.File

class CircularBufferModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CircularBufferModule"

    // START_VIDEO_RECORDING/STOP_VIDEO_RECORDING are the platform's built-in
    // recording cues (same ones the stock Camera app uses), so no bundled
    // audio asset is needed here.
    private val mediaActionSound by lazy { MediaActionSound() }

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

    /**
     * `CircularBufferHealth` (bridge contract): `{ state, reason? }`, emitted by
     * CameraEncoderController only on transitions -- see BufferHealth /
     * resolveBufferHealth in BufferPolicies.kt for the states and their
     * precedence. Same emission path as [emitError].
     */
    private fun emitHealth(state: String, reason: String?) {
        val params = Arguments.createMap()
        params.putString("state", state)
        if (reason != null) params.putString("reason", reason)
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_HEALTH, params)
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

                    override fun onHealth(state: String, reason: String?) {
                        emitHealth(state, reason)
                    }
                },
            )
            // Always started alongside buffering (never only-when-backgrounded), so it's
            // always started from this foreground-privileged call -- sidesteps Android
            // 12+'s restriction on starting a foreground service from the background
            // entirely. Wrapped defensively: if the OS refuses foreground promotion for
            // any reason, buffering still works fine while the app stays foregrounded --
            // only background survival degrades, not the core feature.
            if (FeatureFlags.BACKGROUND_RECORDING_ENABLED) {
                try {
                    CircularBufferForegroundService.start(reactApplicationContext)
                } catch (_: Throwable) {
                    // non-fatal, see comment above
                }
            }
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
            CircularBufferForegroundService.stop(reactApplicationContext)
            // stop() also clears the controller's pocket-mode flag; never leave the
            // window dimmed behind a buffer that's no longer running.
            applyPocketBrightness(false)
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
    fun playRecordingStartSound() {
        mediaActionSound.play(MediaActionSound.START_VIDEO_RECORDING)
    }

    @ReactMethod
    fun playRecordingStopSound() {
        mediaActionSound.play(MediaActionSound.STOP_VIDEO_RECORDING)
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

    // Queried once by SettingsScreen (and defensively by useCircularBuffer
    // before starting the buffer) so quality/fps options the hardware
    // doesn't actually support are disabled/clamped instead of silently
    // ignored or failing to start. Reads CameraCharacteristics directly, so
    // this can run standalone without a running buffer.
    @ReactMethod
    fun getCaptureCapabilities(promise: Promise) {
        try {
            val capabilities = CameraEncoderController.captureCapabilities(reactApplicationContext)
            val result = WritableNativeMap()
            val qualities = WritableNativeArray()
            capabilities.supportedQualities.forEach { qualities.pushString(it) }
            result.putArray("supportedQualities", qualities)
            val fpsByQuality = WritableNativeMap()
            capabilities.fpsByQuality.forEach { (quality, fpsList) ->
                val fpsArray = WritableNativeArray()
                fpsList.forEach { fpsArray.pushInt(it) }
                fpsByQuality.putArray(quality, fpsArray)
            }
            result.putMap("fpsByQuality", fpsByQuality)
            promise.resolve(result)
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.ENCODER_INIT_FAILED, t.message, t)
        }
    }

    /**
     * Pocket mode (bridge contract): dims this Activity's window to
     * [CameraEncoderController.POCKET_MODE_BRIGHTNESS] -- a per-window
     * override, so no WRITE_SETTINGS permission and the system brightness
     * setting is untouched -- and has the controller drop the preview target
     * from the repeating request (same path as background mode; capture and
     * encoding keep running). Exiting restores BRIGHTNESS_OVERRIDE_NONE (the
     * user's own brightness) and re-adds the preview unless the app is also
     * backgrounded. Resolves even with no current Activity: the camera-side
     * half still applies, and the window will be fresh (undimmed) when one
     * comes back anyway.
     */
    @ReactMethod
    fun setPocketMode(enabled: Boolean, promise: Promise) {
        try {
            CameraEncoderController.setPocketMode(enabled)
            applyPocketBrightness(enabled)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.NOT_BUFFERING, t.message, t)
        }
    }

    private fun applyPocketBrightness(enabled: Boolean) {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            val window = activity.window ?: return@runOnUiThread
            val attributes = window.attributes
            attributes.screenBrightness = if (enabled) {
                CameraEncoderController.POCKET_MODE_BRIGHTNESS
            } else {
                WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            }
            window.attributes = attributes
        }
    }

    /**
     * Gates MainActivity.dispatchKeyEvent's interception of volume / camera /
     * media / enter keys (see decideHardwareKey in BufferPolicies.kt). Even
     * when enabled, keys are only intercepted while the buffer is actually
     * running, so volume keeps working everywhere else in the app.
     */
    @ReactMethod
    fun setHardwareTriggerEnabled(enabled: Boolean, promise: Promise) {
        CameraEncoderController.hardwareTriggerEnabled = enabled
        promise.resolve(null)
    }

    /**
     * Whether the user has exempted Peguei from Doze/app-standby battery
     * optimizations -- the JS battery card shows only when this is false.
     * Doze can otherwise defer the foreground service's work on some OEMs
     * during long screen-off buffering.
     */
    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.NO_ACTIVITY, t.message, t)
        }
    }

    /**
     * Opens the system's battery-optimization list
     * (ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) where the user picks
     * Peguei themselves. Deliberately NOT ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
     * (the one-tap dialog): that needs the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
     * permission, which Google Play only allows for a narrow set of app
     * categories this app isn't in. Some OEM builds strip that settings
     * screen, so fall back to this app's own App info page (battery is one
     * tap away from there on those builds).
     */
    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        val context = reactApplicationContext
        val activity = context.currentActivity
        fun launch(intent: Intent) {
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        try {
            launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            promise.resolve(null)
        } catch (_: ActivityNotFoundException) {
            try {
                launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject(CircularBufferErrorCodes.NO_ACTIVITY, t.message, t)
            }
        } catch (t: Throwable) {
            promise.reject(CircularBufferErrorCodes.NO_ACTIVITY, t.message, t)
        }
    }

    companion object {
        const val EVENT_HEALTH = "CircularBufferHealth"
        const val EVENT_HARDWARE_TRIGGER = "CircularBufferHardwareTrigger"
    }
}
