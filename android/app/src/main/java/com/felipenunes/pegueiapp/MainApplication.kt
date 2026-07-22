package com.felipenunes.pegueiapp

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.felipenunes.pegueiapp.circularbuffer.CameraEncoderController
import com.felipenunes.pegueiapp.circularbuffer.CircularBufferPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(CircularBufferPackage())
        },
    )
  }

  // Started-activity count, not ProcessLifecycleOwner: this app is a single
  // Activity (singleTask), so a plain counter is sufficient and needs no new
  // dependency. onActivityStopped fires both when the user switches away to
  // another app AND when the screen turns off (Activity.onStop covers both --
  // there's no window still visible in either case), which is exactly the
  // pair of triggers background recording needs to survive. See
  // CameraEncoderController.enterBackgroundMode/exitBackgroundMode.
  private var startedActivityCount = 0

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    registerActivityLifecycleCallbacks(
      object : ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
          startedActivityCount++
          if (startedActivityCount == 1) CameraEncoderController.exitBackgroundMode()
        }

        override fun onActivityStopped(activity: Activity) {
          startedActivityCount--
          if (startedActivityCount == 0) CameraEncoderController.enterBackgroundMode()
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
      },
    )
  }
}
