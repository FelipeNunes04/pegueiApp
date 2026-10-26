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
 * save verification + the early-finalized-recording rendezvous.
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

    // --- DeferredSaveOutcome ---

    @Test
    fun `an outcome that arrives before stop is delivered when stop awaits it`() {
        val deferred = DeferredSaveOutcome()
        deferred.complete(SaveOutcome.Saved("/clips/a.mp4", 12.5))
        var received: SaveOutcome? = null
        deferred.await { received = it }
        assertEquals(SaveOutcome.Saved("/clips/a.mp4", 12.5), received)
    }

    @Test
    fun `stop awaiting before the mux finishes gets the outcome once it completes`() {
        val deferred = DeferredSaveOutcome()
        var received: SaveOutcome? = null
        deferred.await { received = it }
        assertNull(received)
        deferred.complete(SaveOutcome.Failed(CircularBufferErrorCodes.SAVE_FAILED, "boom"))
        assertEquals(SaveOutcome.Failed(CircularBufferErrorCodes.SAVE_FAILED, "boom"), received)
    }

    @Test
    fun `only the first outcome is ever delivered`() {
        val deferred = DeferredSaveOutcome()
        val received = mutableListOf<SaveOutcome>()
        deferred.await { received.add(it) }
        deferred.complete(SaveOutcome.Saved("/clips/a.mp4", 1.0))
        deferred.complete(SaveOutcome.Saved("/clips/b.mp4", 2.0))
        assertEquals(listOf<SaveOutcome>(SaveOutcome.Saved("/clips/a.mp4", 1.0)), received)
    }
}
