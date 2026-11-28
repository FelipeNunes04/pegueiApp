package com.felipenunes.pegueiapp.analytics

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.StatFs
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.felipenunes.pegueiapp.circularbuffer.CameraEncoderController
import java.util.concurrent.Executors

/**
 * Lets native code send analytics through the same JS `track()` path as the
 * rest of the app (opt-out, development mode, provider).
 *
 * [track] is safe from any thread, the camera and encoder threads included:
 * it only hands the event to a low-priority single thread and returns.
 * Events wait there until JS is listening, capped at [MAX_PENDING].
 */
class PegueiAnalyticsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> {
        val context = reactApplicationContext
        val packageInfo = try {
            context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (_: Exception) {
            null
        }
        @Suppress("DEPRECATION")
        val buildNumber = packageInfo?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode.toString() else it.versionCode.toString()
        } ?: "unknown"
        return mapOf(
            "appVersion" to (packageInfo?.versionName ?: "unknown"),
            "buildNumber" to buildNumber,
            "deviceModel" to "${Build.MANUFACTURER} ${Build.MODEL}",
            "osVersion" to Build.VERSION.RELEASE,
        )
    }

    // NativeEventEmitter calls these when JS subscribes / unsubscribes.
    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
        executor.execute {
            listenerCount++
            listening = this
            flush()
            startConnectionWatch(reactApplicationContext)
            sendConnection()
        }
    }

    /**
     * Battery, temperature, storage, memory and frame count, for the fishing
     * session metrics (src/analytics/deviceStatus.ts). Called from JS on
     * session start, every 5 min at most and on session end; the work runs
     * on the low-priority analytics thread, never on the camera threads.
     */
    @ReactMethod
    fun getDeviceStatus(promise: Promise) {
        val context = reactApplicationContext
        executor.execute {
            try {
                val map = Arguments.createMap()
                val battery = readBattery(context)
                map.putDouble("batteryPct", battery.first)
                map.putBoolean("charging", battery.second)
                map.putString("thermalState", readThermal(context))
                map.putDouble("storageFreeGb", readFreeStorageGb(context))
                map.putDouble("memoryMb", readMemoryMb())
                map.putDouble("encodedFrames", CameraEncoderController.encodedVideoFrameCount().toDouble())
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("E_DEVICE_STATUS", t.message, t)
            }
        }
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        executor.execute {
            listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
            if (listenerCount == 0 && listening === this) listening = null
        }
    }

    override fun invalidate() {
        executor.execute { if (listening === this) listening = null }
        super.invalidate()
    }

    companion object {
        const val NAME = "PegueiAnalytics"
        const val EVENT = "PegueiAnalyticsEvent"
        const val CONNECTION_EVENT = "PegueiConnectionChanged"
        private const val MAX_PENDING = 100

        private val executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "peguei-analytics").apply {
                priority = Thread.MIN_PRIORITY
                isDaemon = true
            }
        }

        // Only touched on [executor].
        private val pending = ArrayDeque<Pair<String, Map<String, Any>>>()
        private var listening: PegueiAnalyticsModule? = null
        private var listenerCount = 0
        private var connection = "unknown"
        private var connectionCallback: ConnectivityManager.NetworkCallback? = null

        // Runs on [executor].
        private fun startConnectionWatch(context: Context) {
            if (connectionCallback != null) return
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    val next = when {
                        !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> "offline"
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "wifi"
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cell"
                        else -> "unknown"
                    }
                    executor.execute { updateConnection(next) }
                }

                override fun onLost(network: Network) {
                    executor.execute { updateConnection("offline") }
                }

                override fun onUnavailable() {
                    executor.execute { updateConnection("offline") }
                }
            }
            try {
                // No active network at all: the callback never fires, so start as offline.
                if (cm.activeNetwork == null) connection = "offline"
                cm.registerDefaultNetworkCallback(callback)
                connectionCallback = callback
            } catch (_: Throwable) {
                // Missing ACCESS_NETWORK_STATE or a vendor bug: connection stays "unknown".
            }
        }

        // Runs on [executor].
        private fun updateConnection(next: String) {
            if (next == connection) return
            connection = next
            sendConnection()
        }

        // Runs on [executor].
        private fun sendConnection() {
            val module = listening ?: return
            val context = module.reactApplicationContext
            if (!context.hasActiveReactInstance()) return
            val body = Arguments.createMap()
            body.putString("connection", connection)
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(CONNECTION_EVENT, body)
        }

        /** (percent or -1, charging). Sticky intent: no receiver is registered. */
        private fun readBattery(context: Context): Pair<Double, Boolean> {
            val intent: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val pct = if (level >= 0 && scale > 0) level * 100.0 / scale else -1.0
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
            return pct to charging
        }

        /** PowerManager.getCurrentThermalStatus (API 29+) on iOS's 4 steps. */
        private fun readThermal(context: Context): String {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unknown"
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return "unknown"
            return when (pm.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "nominal"
                PowerManager.THERMAL_STATUS_LIGHT -> "fair"
                PowerManager.THERMAL_STATUS_MODERATE, PowerManager.THERMAL_STATUS_SEVERE -> "serious"
                PowerManager.THERMAL_STATUS_CRITICAL,
                PowerManager.THERMAL_STATUS_EMERGENCY,
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
                else -> "unknown"
            }
        }

        private fun readFreeStorageGb(context: Context): Double = try {
            StatFs(context.filesDir.absolutePath).availableBytes / 1_000_000_000.0
        } catch (_: Throwable) {
            -1.0
        }

        /** Proportional set size of this process, in MB. A few ms; fine every 5 min off the camera threads. */
        private fun readMemoryMb(): Double = try {
            Debug.getPss() / 1024.0
        } catch (_: Throwable) {
            -1.0
        }

        /** [name] must be one of src/analytics/events.ts; JS drops unknown names. */
        @JvmStatic
        fun track(name: String, props: Map<String, Any> = emptyMap()) {
            executor.execute {
                pending.addLast(name to props)
                while (pending.size > MAX_PENDING) pending.removeFirst()
                flush()
            }
        }

        // Runs on [executor].
        private fun flush() {
            val module = listening ?: return
            val context = module.reactApplicationContext
            if (!context.hasActiveReactInstance()) return
            val emitter = context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            while (pending.isNotEmpty()) {
                val (name, props) = pending.removeFirst()
                val body = Arguments.createMap()
                body.putString("name", name)
                body.putMap("props", toWritableMap(props))
                emitter.emit(EVENT, body)
            }
        }

        private fun toWritableMap(props: Map<String, Any>): WritableMap {
            val map = Arguments.createMap()
            for ((key, value) in props) {
                when (value) {
                    is String -> map.putString(key, value)
                    is Boolean -> map.putBoolean(key, value)
                    is Int -> map.putInt(key, value)
                    is Long -> map.putDouble(key, value.toDouble())
                    is Number -> map.putDouble(key, value.toDouble())
                    else -> map.putString(key, value.toString())
                }
            }
            return map
        }
    }
}
