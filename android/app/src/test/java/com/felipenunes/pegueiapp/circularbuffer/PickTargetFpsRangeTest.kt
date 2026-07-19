package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Covers CameraEncoderController.pickTargetFpsRange(available: List<FpsRange>, fps: Int),
 * the pure decision logic split out from the CameraCharacteristics-reading
 * overload specifically so it's testable without Robolectric/an emulator --
 * this project's unit tests run against the unmocked Android SDK stub, which
 * throws at runtime for any android.util.* call (Range included), so the
 * testable overload is expressed over the Android-SDK-free FpsRange instead.
 */
class PickTargetFpsRangeTest {

    @Test
    fun `prefers the widest range that still caps exactly at the requested fps over a tighter fixed one`() {
        val available = listOf(FpsRange(15, 30), FpsRange(30, 30), FpsRange(24, 24))

        val picked = CameraEncoderController.pickTargetFpsRange(available, 30)

        assertEquals(FpsRange(15, 30), picked)
    }

    @Test
    fun `picks the range with the smallest lower bound among those that cover the requested fps`() {
        val available = listOf(FpsRange(10, 60), FpsRange(20, 45), FpsRange(5, 40))

        val picked = CameraEncoderController.pickTargetFpsRange(available, 30)

        assertEquals(FpsRange(5, 40), picked)
    }

    @Test
    fun `falls back to the highest available max fps when nothing covers the requested fps`() {
        val available = listOf(FpsRange(7, 15), FpsRange(15, 24))

        val picked = CameraEncoderController.pickTargetFpsRange(available, 30)

        assertEquals(FpsRange(15, 24), picked)
    }

    @Test
    fun `returns null when no ranges are available at all`() {
        val picked = CameraEncoderController.pickTargetFpsRange(emptyList(), 30)

        assertNull(picked)
    }

    @Test
    fun `works for a 60fps request the same way it does for 30fps`() {
        val available = listOf(FpsRange(15, 30), FpsRange(30, 60))

        val picked = CameraEncoderController.pickTargetFpsRange(available, 60)

        assertEquals(FpsRange(30, 60), picked)
    }
}
