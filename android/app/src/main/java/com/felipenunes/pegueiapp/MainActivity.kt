package com.felipenunes.pegueiapp

import android.content.Context
import android.os.Build
import android.view.KeyEvent
import android.view.accessibility.AccessibilityManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.felipenunes.pegueiapp.circularbuffer.CameraEncoderController
import com.felipenunes.pegueiapp.circularbuffer.CircularBufferModule
import com.felipenunes.pegueiapp.circularbuffer.HardwareKeyTracker
import com.felipenunes.pegueiapp.circularbuffer.KeyDecision
import com.felipenunes.pegueiapp.circularbuffer.hardwareTriggerSource

class MainActivity : ReactActivity() {

  private val hardwareKeyTracker = HardwareKeyTracker()

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Peguei"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Hardware record triggers (bridge contract `setHardwareTriggerEnabled`):
   * volume up/down, the camera key, headset/media play-pause, and ENTER
   * (cheap Bluetooth selfie-shutter remotes send VOLUME_UP or ENTER) toggle
   * recording exactly like the on-screen button, including in pocket mode
   * (window still focused, just dimmed). dispatchKeyEvent rather than
   * onKeyDown/onKeyUp because it sees the event before the focused view
   * (RN's root view / a TextInput) and before the system's own volume
   * handling. What to do with each event is decided by the SDK-free
   * [HardwareKeyTracker] (unit-tested): only while the setting is on AND the
   * buffer is running; the press is consumed so volume doesn't change, and
   * the release emits `CircularBufferHardwareTrigger`.
   *
   * Only works while this Activity has window focus -- with the screen
   * fully off (background recording) Android doesn't route these keys to
   * apps at all, which is why pocket mode dims rather than turns off.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val decision = hardwareKeyTracker.decide(
        enabled = CameraEncoderController.hardwareTriggerEnabled,
        buffering = CameraEncoderController.isBuffering(),
        enterAllowed = event.keyCode == KeyEvent.KEYCODE_ENTER && isEnterTriggerAllowed(event),
        keyCode = event.keyCode,
        isDown = event.action == KeyEvent.ACTION_DOWN,
        isUp = event.action == KeyEvent.ACTION_UP,
        repeatCount = event.repeatCount,
        isCanceled = event.isCanceled,
    )
    return when (decision) {
      KeyDecision.PASS_THROUGH -> super.dispatchKeyEvent(event)
      KeyDecision.CONSUME -> true
      KeyDecision.TRIGGER -> {
        hardwareTriggerSource(event.keyCode)?.let { emitHardwareTrigger(it) }
        true
      }
    }
  }

  /**
   * ENTER is how on-screen focus gets activated from a keyboard or by switch
   * access, so it only counts as a shutter remote's trigger when it demonstrably
   * came from an external device (needs InputDevice.isExternal, API 29+; below
   * that, never) and no accessibility service is running. AccessibilityManager
   * can't single out switch access, hence any enabled service.
   */
  private fun isEnterTriggerAllowed(event: KeyEvent): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    if (event.device?.isExternal != true) return false
    val accessibility = getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    return accessibility?.isEnabled == false
  }

  /** Same ReactHost.currentReactContext emission path CircularBufferForegroundService uses --
   *  this Activity has no ReactApplicationContext of its own. */
  private fun emitHardwareTrigger(source: String) {
    val reactContext = (application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    if (!reactContext.hasActiveReactInstance()) return
    val params = Arguments.createMap()
    params.putString("source", source)
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(CircularBufferModule.EVENT_HARDWARE_TRIGGER, params)
  }
}
