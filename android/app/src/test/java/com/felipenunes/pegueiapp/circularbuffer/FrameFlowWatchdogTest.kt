package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Covers FrameFlowWatchdog, the SDK-free escalation policy behind
 * CameraEncoderController.onWatchdogTick()/onEncoderFailed(): stall > 3 s ->
 * rebuild encoder -> (still stalled one window later) full pipeline restart
 * -> ... -> give up, with RECOVERED as soon as a frame arrives after any
 * action. Split out of the Camera2/MediaCodec-bound controller for the same
 * Robolectric-free reason as pickTargetFpsRange (see PickTargetFpsRangeTest).
 */
class FrameFlowWatchdogTest {

    private val threshold = 3_000L

    @Test
    fun `does nothing while frames keep flowing`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.noteSessionStarted(0)
        for (t in 1_000L..20_000L step 1_000L) {
            assertEquals(WatchdogAction.NONE, watchdog.evaluate(nowMs = t, lastFrameAtMs = t - 33, active = true))
        }
    }

    @Test
    fun `a session that just started gets a full window before its first frame counts as a stall`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.noteSessionStarted(10_000)
        assertEquals(WatchdogAction.NONE, watchdog.evaluate(nowMs = 13_000, lastFrameAtMs = 0, active = true))
        assertEquals(WatchdogAction.RESTART_ENCODER, watchdog.evaluate(nowMs = 13_001, lastFrameAtMs = 0, active = true))
    }

    @Test
    fun `never acts while inactive (not running, opening, or backgrounded without background recording)`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.noteSessionStarted(0)
        assertEquals(WatchdogAction.NONE, watchdog.evaluate(nowMs = 60_000, lastFrameAtMs = 0, active = false))
        assertEquals(0, watchdog.stage)
    }

    @Test
    fun `escalates encoder rebuild then pipeline restarts then gives up, one window apart`() {
        val watchdog = FrameFlowWatchdog(threshold, maxPipelineRestarts = 2)
        watchdog.noteSessionStarted(0)
        val lastFrame = 500L

        assertEquals(WatchdogAction.RESTART_ENCODER, watchdog.evaluate(4_000, lastFrame, true))
        // Within the new window measured from the action itself: wait.
        assertEquals(WatchdogAction.NONE, watchdog.evaluate(6_000, lastFrame, true))
        assertEquals(WatchdogAction.RESTART_PIPELINE, watchdog.evaluate(7_001, lastFrame, true))
        assertEquals(WatchdogAction.RESTART_PIPELINE, watchdog.evaluate(10_002, lastFrame, true))
        assertEquals(WatchdogAction.GIVE_UP, watchdog.evaluate(13_003, lastFrame, true))
    }

    @Test
    fun `a frame after an action reports recovered and resets the ladder`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.noteSessionStarted(0)
        assertEquals(WatchdogAction.RESTART_ENCODER, watchdog.evaluate(4_000, 100, true))
        assertEquals(WatchdogAction.RECOVERED, watchdog.evaluate(5_000, 4_500, true))
        assertEquals(0, watchdog.stage)
        // A later stall starts from the bottom again.
        assertEquals(WatchdogAction.RESTART_ENCODER, watchdog.evaluate(9_000, 4_500, true))
    }

    @Test
    fun `a pipeline restart's reopen time is not counted against it once the session reconfigures`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.noteSessionStarted(0)
        watchdog.evaluate(4_000, 100, true) // RESTART_ENCODER
        assertEquals(WatchdogAction.RESTART_PIPELINE, watchdog.evaluate(7_500, 100, true))
        // Camera reopen takes 2.5 s (watchdog inactive meanwhile), then configures.
        watchdog.noteSessionStarted(10_000)
        assertEquals(WatchdogAction.NONE, watchdog.evaluate(12_000, 100, true))
        assertEquals(WatchdogAction.RECOVERED, watchdog.evaluate(13_000, 10_050, true))
    }

    @Test
    fun `codec failures walk the same ladder without waiting out the window`() {
        val watchdog = FrameFlowWatchdog(threshold, maxPipelineRestarts = 1)
        assertEquals(WatchdogAction.RESTART_ENCODER, watchdog.forceEscalation(1_000))
        assertEquals(WatchdogAction.RESTART_PIPELINE, watchdog.forceEscalation(1_100))
        assertEquals(WatchdogAction.GIVE_UP, watchdog.forceEscalation(1_200))
    }

    @Test
    fun `reset returns to a fresh healthy state`() {
        val watchdog = FrameFlowWatchdog(threshold)
        watchdog.forceEscalation(1_000)
        watchdog.reset()
        assertEquals(0, watchdog.stage)
        watchdog.noteSessionStarted(50_000)
        assertEquals(WatchdogAction.NONE, watchdog.evaluate(52_000, 0, true))
    }
}
