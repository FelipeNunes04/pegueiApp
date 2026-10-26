package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Covers the SDK-free battery policies in BufferPolicies.kt: thermal status
 * -> fps step-down (and the AE range picked for it), and the 720p preview
 * cap. PowerManager.THERMAL_STATUS_* are compile-time int constants (inlined),
 * so they're spelled out as literals here to keep the test obviously
 * independent of the stub SDK: NONE=0, LIGHT=1, MODERATE=2, SEVERE=3,
 * CRITICAL=4, EMERGENCY=5, SHUTDOWN=6.
 */
class BatteryPoliciesTest {

    // --- thermal ---

    @Test
    fun `no cap below SEVERE`() {
        for (status in 0..2) assertNull(thermalFpsCap(status))
    }

    @Test
    fun `SEVERE caps at 24 and CRITICAL and above at 15`() {
        assertEquals(24, thermalFpsCap(3))
        assertEquals(15, thermalFpsCap(4))
        assertEquals(15, thermalFpsCap(5))
        assertEquals(15, thermalFpsCap(6))
    }

    @Test
    fun `effective fps is the configured fps capped, never raised`() {
        assertEquals(30, effectiveFps(configuredFps = 30, thermalStatus = 2))
        assertEquals(24, effectiveFps(configuredFps = 30, thermalStatus = 3))
        assertEquals(24, effectiveFps(configuredFps = 60, thermalStatus = 3))
        assertEquals(15, effectiveFps(configuredFps = 60, thermalStatus = 4))
        // Already at/below the cap: unchanged (and therefore not "throttled").
        assertEquals(24, effectiveFps(configuredFps = 24, thermalStatus = 3))
    }

    @Test
    fun `throttled range prefers an exact ceiling`() {
        val available = listOf(FpsRange(15, 30), FpsRange(30, 30), FpsRange(24, 24), FpsRange(10, 24))
        assertEquals(FpsRange(10, 24), pickThrottledFpsRange(available, 24))
    }

    @Test
    fun `throttled range never picks a range whose ceiling is above the throttled fps when a lower one exists`() {
        // The normal picker would choose 7-30 for a 15 fps request (covers it with the
        // widest floor) -- which wouldn't throttle anything.
        val available = listOf(FpsRange(7, 30), FpsRange(30, 30), FpsRange(8, 8), FpsRange(10, 12))
        assertEquals(FpsRange(10, 12), pickThrottledFpsRange(available, 15))
    }

    @Test
    fun `throttled range falls back to the normal picker when nothing is at or below the target`() {
        val available = listOf(FpsRange(15, 30), FpsRange(30, 30))
        assertEquals(FpsRange(15, 30), pickThrottledFpsRange(available, 10))
    }

    // --- preview size ---

    private val typicalSizes = listOf(
        PixelSize(3840, 2160), PixelSize(1920, 1080), PixelSize(1440, 1080), PixelSize(1280, 960),
        PixelSize(1280, 720), PixelSize(960, 540), PixelSize(640, 480),
    )

    @Test
    fun `1080p and 4K encoders get a 720p preview`() {
        assertEquals(PixelSize(1280, 720), pickPreviewSize(typicalSizes, PixelSize(1920, 1080)))
        assertEquals(PixelSize(1280, 720), pickPreviewSize(typicalSizes, PixelSize(3840, 2160)))
    }

    @Test
    fun `a 720p encoder keeps a 720p preview`() {
        assertEquals(PixelSize(1280, 720), pickPreviewSize(typicalSizes, PixelSize(1280, 720)))
    }

    @Test
    fun `only same-aspect sizes are considered, so the preview frames what is recorded`() {
        val sizes = listOf(PixelSize(1280, 960), PixelSize(1024, 768), PixelSize(960, 540))
        assertEquals(PixelSize(960, 540), pickPreviewSize(sizes, PixelSize(1920, 1080)))
    }

    @Test
    fun `falls back to the encoder size when no capped same-aspect size is supported`() {
        val sizes = listOf(PixelSize(1920, 1080), PixelSize(1280, 960))
        assertEquals(PixelSize(1920, 1080), pickPreviewSize(sizes, PixelSize(1920, 1080)))
        assertEquals(PixelSize(1920, 1080), pickPreviewSize(emptyList(), PixelSize(1920, 1080)))
    }
}
