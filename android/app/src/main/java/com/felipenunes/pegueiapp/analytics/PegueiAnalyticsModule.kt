package com.felipenunes.pegueiapp.analytics

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
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
