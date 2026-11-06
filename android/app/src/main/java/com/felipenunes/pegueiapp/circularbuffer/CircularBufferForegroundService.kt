package com.felipenunes.pegueiapp.circularbuffer

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.felipenunes.pegueiapp.R

/**
 * Holds the persistent notification + elevated process priority that let
 * [CameraEncoderController] keep its Camera2 session alive while the app is
 * backgrounded or the screen is off -- see [CameraEncoderController.enterBackgroundMode].
 * Owns no camera state itself; [start]/[stop] are always called from
 * [CircularBufferModule] in lockstep with `startBuffering()`/`stopBuffering()`
 * (never dynamically only-when-backgrounded), so it's always started from a
 * foreground-privileged Activity context -- sidesteps Android 12+'s
 * restriction on starting a foreground service from the background entirely.
 */
class CircularBufferForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Keeps the CPU awake while buffering with the screen off. A foreground
     * service only protects the process from being killed -- it does not stop
     * the CPU from suspending, and on several OEMs (and under Doze) the
     * drain/audio/watchdog threads were otherwise left starved between
     * camera interrupts, stalling the encoder output the ring buffer depends
     * on. Partial (CPU only -- screen and keyboard backlight are untouched),
     * non-reference-counted so repeated onStartCommand calls can't stack it,
     * and held for exactly the service's lifetime, which is already exactly
     * the buffer's lifetime (started/stopped in lockstep with
     * startBuffering()/stopBuffering()) -- hence no timeout.
     */
    private var wakeLock: PowerManager.WakeLock? = null

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (t: Throwable) {
            // Non-fatal, same philosophy as the foreground promotion below.
            Log.e(TAG, "Failed to acquire wake lock", t)
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to release wake lock", t)
        }
        wakeLock = null
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            synchronized(lock) { wantRunning = false }
            CameraEncoderController.stop()
            releaseWakeLock()
            emitStoppedExternally()
            stopSelfResult(startId)
            return START_NOT_STICKY
        }
        // Unconditional, even if stop() has been requested since: every
        // startForegroundService() must be answered by startForeground(), or
        // the system crashes the app with "did not then call startForeground()".
        val promoted = promoteToForeground()
        val shouldRun = synchronized(lock) {
            if (pendingStarts > 0) pendingStarts--
            wantRunning
        }
        if (shouldRun && promoted) {
            acquireWakeLock()
        } else {
            releaseWakeLock()
            // By id, not stopSelf(): if another start is already queued, this is
            // a no-op and that start's onStartCommand gets to answer it.
            stopSelfResult(startId)
        }
        return START_NOT_STICKY
    }

    /**
     * Best-effort: if the OS refuses foreground promotion for any reason,
     * buffering still works normally while the app stays in the foreground --
     * only background survival degrades, matching this app's existing
     * "non-fatal, keep recording" philosophy (see e.g.
     * CameraEncoderController's audio-capture fallback).
     *
     * The second attempt covers failures building the full notification. It
     * can't help with a refusal based on app state (Android 14+ SecurityException
     * for camera/microphone types when the app was backgrounded between the
     * start call and here), as any FGS type this service may use has the same
     * requirement. Nothing more can be done in that case but stop; whether the
     * system still counts that as an unanswered start hasn't been verified on a
     * device.
     */
    private fun promoteToForeground(): Boolean {
        val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        try {
            createChannelIfNeeded()
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types)
            return true
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start foreground notification", t)
        }
        try {
            createChannelIfNeeded()
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildFallbackNotification(), types)
            return true
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start foreground with the fallback notification", t)
        }
        return false
    }

    private fun buildFallbackNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.recording_notification_title))
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setOngoing(true)
            .build()

    private fun createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.recording_notification_channel_name), NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun buildNotification(): Notification {
        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE)
        }
        val stopIntent = Intent(this, CircularBufferForegroundService::class.java).setAction(ACTION_STOP)
        val stopPendingIntent = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.recording_notification_title))
            .setContentText(getString(R.string.recording_notification_text))
            .setSmallIcon(R.drawable.ic_notification_recording)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .addAction(0, getString(R.string.recording_notification_stop_action), stopPendingIntent)
            .build()
    }

    /**
     * Mirrors CircularBufferModule.emitError's event-emission pattern, but
     * reached from a Service (no ReactApplicationContext of its own) via
     * ReactHost.currentReactContext instead. Lets useCircularBuffer.ts learn
     * that buffering was stopped from the notification's action button,
     * not from its own stopBuffering() call, so the UI phase updates
     * correctly even if the app is still backgrounded when it happens.
     */
    private fun emitStoppedExternally() {
        val reactContext = (applicationContext as? ReactApplication)?.reactHost?.currentReactContext ?: return
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_STOPPED_EXTERNALLY, null)
    }

    companion object {
        private const val TAG = "CircularBuffer"
        private const val CHANNEL_ID = "circular_buffer_recording"
        private const val NOTIFICATION_ID = 1001
        private const val WAKE_LOCK_TAG = "Peguei:buffer"
        private const val ACTION_STOP = "com.felipenunes.pegueiapp.circularbuffer.ACTION_STOP"
        const val EVENT_STOPPED_EXTERNALLY = "CircularBufferStoppedExternally"

        private val lock = Any()

        /** Whether the latest of start()/stop() was a start. */
        private var wantRunning = false

        /** startForegroundService() calls onStartCommand hasn't answered yet. */
        private var pendingStarts = 0

        fun start(context: Context) {
            synchronized(lock) {
                wantRunning = true
                pendingStarts++
            }
            try {
                ContextCompat.startForegroundService(context, Intent(context, CircularBufferForegroundService::class.java))
            } catch (t: Throwable) {
                synchronized(lock) { pendingStarts-- }
                throw t
            }
        }

        /**
         * stopService() while a start is still unanswered destroys the service
         * before it ever calls startForeground(), which the system punishes by
         * crashing the app -- very reachable with a rapid stop/start on a settings
         * change. So in that case only the intent is recorded, and onStartCommand
         * promotes and then stops itself. Idempotent, and safe from the background,
         * which delivering a stop intent wouldn't be: startService() and
         * startForegroundService() can both throw there, and this is also called
         * by give-up paths on an app that may be backgrounded.
         */
        fun stop(context: Context) {
            synchronized(lock) {
                wantRunning = false
                if (pendingStarts > 0) return
            }
            context.stopService(Intent(context, CircularBufferForegroundService::class.java))
        }
    }
}
