package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Covers CameraEncoderController.previewTargetIncluded(isBackgroundMode, isRunning),
 * the pure decision logic behind enterBackgroundMode()/exitBackgroundMode()'s
 * repeating-request mutation -- split out for the same Robolectric-free
 * testability reason as pickTargetFpsRange (see PickTargetFpsRangeTest).
 */
class PreviewTargetIncludedTest {

    @Test
    fun `preview target is dropped once backgrounded while running`() {
        assertFalse(CameraEncoderController.previewTargetIncluded(isBackgroundMode = true, isRunning = true))
    }

    @Test
    fun `preview target is restored back in the foreground while running`() {
        assertTrue(CameraEncoderController.previewTargetIncluded(isBackgroundMode = false, isRunning = true))
    }

    @Test
    fun `preview target is never included while not running, backgrounded or not`() {
        assertFalse(CameraEncoderController.previewTargetIncluded(isBackgroundMode = true, isRunning = false))
        assertFalse(CameraEncoderController.previewTargetIncluded(isBackgroundMode = false, isRunning = false))
    }
}
