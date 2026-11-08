package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Covers the SDK-free error-escalation and health policies in
 * BufferPolicies.kt: MediaCodec.CodecException -> retry vs. rebuild,
 * camera-loss reopen backoff, CircularBufferHealth state resolution, and
 * save verification, and how a manual recording is joined and capped.
 */
class RecoveryPoliciesTest {

    // --- codecErrorAction ---

    @Test
    fun `transient codec errors are retried`() {
        assertEquals(CodecErrorAction.RETRY, codecErrorAction(isTransient = true, consecutiveTransientErrors = 0))
        assertEquals(CodecErrorAction.RETRY, codecErrorAction(isTransient = true, consecutiveTransientErrors = MAX_CONSECUTIVE_TRANSIENT_CODEC_ERRORS - 1))
    }

    @Test
    fun `a transient error that keeps repeating is escalated to a rebuild`() {
        assertEquals(CodecErrorAction.RECREATE_ENCODER, codecErrorAction(isTransient = true, consecutiveTransientErrors = MAX_CONSECUTIVE_TRANSIENT_CODEC_ERRORS))
    }

    @Test
    fun `recoverable and fatal codec errors rebuild the encoder`() {
        assertEquals(CodecErrorAction.RECREATE_ENCODER, codecErrorAction(isTransient = false, consecutiveTransientErrors = 0))
    }

    // --- cameraReopenDelayMs ---

    @Test
    fun `camera loss reopens with exponential backoff then gives up`() {
        val delays = (0 until 10).map { cameraReopenDelayMs(CameraLossKind.DISCONNECTED, it) }
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, null, null, null, null), delays)
    }

    @Test
    fun `camera in use and device or service errors are retried`() {
        for (kind in listOf(CameraLossKind.IN_USE, CameraLossKind.MAX_CAMERAS_IN_USE, CameraLossKind.DEVICE_ERROR, CameraLossKind.SERVICE_ERROR, CameraLossKind.CONFIGURE_FAILED, CameraLossKind.OPEN_FAILED)) {
            assertEquals(1_000L, cameraReopenDelayMs(kind, 0))
        }
    }

    @Test
    fun `a policy-disabled camera is never retried`() {
        assertNull(cameraReopenDelayMs(CameraLossKind.DISABLED, 0))
    }

    @Test
    fun `negative attempts are rejected`() {
        assertNull(cameraReopenDelayMs(CameraLossKind.DISCONNECTED, -1))
    }

    // --- resolveBufferHealth ---

    @Test
    fun `health precedence is interrupted over recovering over throttled over healthy`() {
        assertEquals(BufferHealth.HEALTHY, resolveBufferHealth(interrupted = false, recovering = false, throttled = false))
        assertEquals(BufferHealth.THROTTLED, resolveBufferHealth(interrupted = false, recovering = false, throttled = true))
        assertEquals(BufferHealth.RECOVERING, resolveBufferHealth(interrupted = false, recovering = true, throttled = true))
        assertEquals(BufferHealth.INTERRUPTED, resolveBufferHealth(interrupted = true, recovering = true, throttled = true))
    }

    @Test
    fun `health wire values match the bridge contract`() {
        assertEquals(listOf("healthy", "recovering", "interrupted", "throttled"), BufferHealth.values().map { it.wire })
    }

    // --- save verification ---

    @Test
    fun `a clip only counts as saved when the file exists and is non-empty`() {
        assertTrue(isSavedClipValid(exists = true, lengthBytes = 1))
        assertFalse(isSavedClipValid(exists = true, lengthBytes = 0))
        assertFalse(isSavedClipValid(exists = false, lengthBytes = 0))
        assertFalse(isSavedClipValid(exists = false, lengthBytes = 1234))
    }

    // --- joinHeadAndTail ---

    private fun frame(ptsUs: Long) = EncodedFrame(byteArrayOf(1), ptsUs, false)

    @Test
    fun `a frame that landed in both pre-roll and tail is kept only once`() {
        val shared = frame(200)
        val head = listOf(frame(100), shared)
        val tail = listOf(shared, frame(300))
        assertEquals(listOf(100L, 200L, 300L), joinHeadAndTail(head, tail).map { it.presentationTimeUs })
    }

    @Test
    fun `distinct frames are never dropped, even with an equal or earlier timestamp`() {
        val head = listOf(frame(100), frame(200))
        val tail = listOf(frame(200), frame(150))
        assertEquals(4, joinHeadAndTail(head, tail).size)
    }

    @Test
    fun `either side may be empty`() {
        val f = frame(100)
        assertEquals(listOf(f), joinHeadAndTail(emptyList(), listOf(f)))
        assertEquals(listOf(f), joinHeadAndTail(listOf(f), emptyList()))
        assertTrue(joinHeadAndTail(emptyList(), emptyList()).isEmpty())
    }

    // --- manualRecordingByteCap ---

    private val mib = 1024L * 1024L

    @Test
    fun `recording cap is half the heap limit`() {
        assertEquals(128 * mib, manualRecordingByteCap(256 * mib))
        assertEquals(256 * mib, manualRecordingByteCap(512 * mib))
    }

    @Test
    fun `recording cap is clamped on very small and very large heaps`() {
        assertEquals(64 * mib, manualRecordingByteCap(96 * mib))
        assertEquals(384 * mib, manualRecordingByteCap(4096 * mib))
    }

    // --- RecordingFinalizeReason ---

    @Test
    fun `finalize reasons match the bridge contract`() {
        assertEquals(
            listOf("stopped", "recovery", "memoryLimit"),
            RecordingFinalizeReason.values().map { it.wire },
        )
    }
}
