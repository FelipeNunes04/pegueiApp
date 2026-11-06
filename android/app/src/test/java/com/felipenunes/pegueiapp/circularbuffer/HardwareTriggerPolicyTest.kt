package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Covers hardwareTriggerSource/HardwareKeyTracker, the SDK-free half of
 * MainActivity.dispatchKeyEvent. Key codes are spelled out as literals
 * (android.view.KeyEvent values) so the test can't accidentally depend on
 * the stub SDK: VOLUME_UP=24, VOLUME_DOWN=25, CAMERA=27, HEADSETHOOK=79,
 * MEDIA_PLAY_PAUSE=85, MEDIA_PLAY=126, ENTER=66, BACK=4, A=29.
 */
class HardwareTriggerPolicyTest {

    private val tracker = HardwareKeyTracker()

    private fun decide(
        keyCode: Int,
        isDown: Boolean = false,
        isUp: Boolean = false,
        enabled: Boolean = true,
        buffering: Boolean = true,
        enterAllowed: Boolean = true,
        repeatCount: Int = 0,
        isCanceled: Boolean = false,
    ) = tracker.decide(enabled, buffering, enterAllowed, keyCode, isDown, isUp, repeatCount, isCanceled)

    @Test
    fun `maps each trigger key to its contract source`() {
        assertEquals("volumeUp", hardwareTriggerSource(24))
        assertEquals("volumeDown", hardwareTriggerSource(25))
        assertEquals("camera", hardwareTriggerSource(27))
        assertEquals("media", hardwareTriggerSource(79))
        assertEquals("media", hardwareTriggerSource(85))
        assertEquals("media", hardwareTriggerSource(126))
        assertEquals("enter", hardwareTriggerSource(66))
    }

    @Test
    fun `other keys are not triggers`() {
        assertNull(hardwareTriggerSource(4))
        assertNull(hardwareTriggerSource(29))
    }

    @Test
    fun `press is consumed and release triggers while enabled and buffering`() {
        assertEquals(KeyDecision.CONSUME, decide(24, isDown = true))
        assertEquals(KeyDecision.TRIGGER, decide(24, isUp = true))
    }

    @Test
    fun `auto-repeats of a claimed press are consumed and it still fires only once`() {
        assertEquals(KeyDecision.CONSUME, decide(25, isDown = true))
        assertEquals(KeyDecision.CONSUME, decide(25, isDown = true, repeatCount = 3))
        assertEquals(KeyDecision.TRIGGER, decide(25, isUp = true))
        assertEquals(KeyDecision.PASS_THROUGH, decide(25, isUp = true))
    }

    @Test
    fun `a claimed release with a repeat count or a canceled press is consumed without triggering`() {
        decide(25, isDown = true)
        assertEquals(KeyDecision.CONSUME, decide(25, isUp = true, repeatCount = 1))
        decide(25, isDown = true)
        assertEquals(KeyDecision.CONSUME, decide(25, isUp = true, isCanceled = true))
    }

    @Test
    fun `everything passes through when the setting is off`() {
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isDown = true, enabled = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isUp = true, enabled = false))
    }

    @Test
    fun `everything passes through when not buffering, so volume and enter keep working elsewhere`() {
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isDown = true, buffering = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(66, isDown = true, buffering = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(66, isUp = true, buffering = false))
    }

    @Test
    fun `a press that passed through never triggers, even if buffering starts before its release`() {
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isDown = true, buffering = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isDown = true, repeatCount = 1, buffering = true))
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isUp = true, buffering = true))
    }

    @Test
    fun `a claimed press stays consumed but does not fire if buffering stops before its release`() {
        assertEquals(KeyDecision.CONSUME, decide(24, isDown = true))
        assertEquals(KeyDecision.CONSUME, decide(24, isDown = true, repeatCount = 1, buffering = false))
        assertEquals(KeyDecision.CONSUME, decide(24, isUp = true, buffering = false))
    }

    @Test
    fun `a release lost to a focus change does not leave the key claimed`() {
        assertEquals(KeyDecision.CONSUME, decide(24, isDown = true))
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isDown = true, enabled = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(24, isUp = true, enabled = false))
    }

    @Test
    fun `presses of different keys are tracked independently`() {
        decide(24, isDown = true)
        assertEquals(KeyDecision.PASS_THROUGH, decide(25, isUp = true))
        assertEquals(KeyDecision.TRIGGER, decide(24, isUp = true))
    }

    @Test
    fun `enter passes through unless allowed, and the setting only concerns enter`() {
        assertEquals(KeyDecision.PASS_THROUGH, decide(66, isDown = true, enterAllowed = false))
        assertEquals(KeyDecision.PASS_THROUGH, decide(66, isUp = true, enterAllowed = false))
        assertEquals(KeyDecision.CONSUME, decide(24, isDown = true, enterAllowed = false))
        assertEquals(KeyDecision.TRIGGER, decide(24, isUp = true, enterAllowed = false))
    }

    @Test
    fun `enter from an allowed device behaves like any other trigger`() {
        assertEquals(KeyDecision.CONSUME, decide(66, isDown = true, enterAllowed = true))
        assertEquals(KeyDecision.TRIGGER, decide(66, isUp = true, enterAllowed = true))
    }

    @Test
    fun `non-trigger keys always pass through`() {
        assertEquals(KeyDecision.PASS_THROUGH, decide(4, isDown = true))
        assertEquals(KeyDecision.PASS_THROUGH, decide(4, isUp = true))
    }
}
