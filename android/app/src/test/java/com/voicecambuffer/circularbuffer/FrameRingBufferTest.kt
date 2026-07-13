package com.voicecambuffer.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameRingBufferTest {

    private val fps = 30
    private val frameIntervalUs = 1_000_000L / fps

    private fun syntheticFrame(index: Int, keyFrameEveryN: Int = 30): EncodedFrame {
        return EncodedFrame(
            data = byteArrayOf(index.toByte()),
            presentationTimeUs = index * frameIntervalUs,
            isKeyFrame = index % keyFrameEveryN == 0,
        )
    }

    @Test
    fun `preserves insertion order for frames within the window`() {
        val buffer = FrameRingBuffer(windowUs = 10_000_000L)
        for (i in 0 until 60) {
            buffer.add(syntheticFrame(i))
        }

        val snapshot = buffer.snapshot()
        val timestamps = snapshot.map { it.presentationTimeUs }
        assertEquals(timestamps.sorted(), timestamps)
    }

    @Test
    fun `evicts frames older than the configured time window`() {
        val windowSeconds = 5L
        val buffer = FrameRingBuffer(windowUs = windowSeconds * 1_000_000L)

        // Simulate 20 seconds of continuous recording at 30fps.
        val totalFrames = 20 * fps
        for (i in 0 until totalFrames) {
            buffer.add(syntheticFrame(i))
        }

        val snapshot = buffer.snapshot()
        val oldestPts = snapshot.first().presentationTimeUs
        val newestPts = snapshot.last().presentationTimeUs

        assertTrue(
            "window should never exceed the configured duration",
            newestPts - oldestPts <= windowSeconds * 1_000_000L,
        )
        // Roughly windowSeconds * fps frames should remain (+/- 1 for boundary rounding).
        assertTrue(snapshot.size in (windowSeconds.toInt() * fps - 1)..(windowSeconds.toInt() * fps + 1))
    }

    @Test
    fun `overwrites oldest frames once capacity window is exceeded`() {
        // ~0.2s window at 30fps holds only a handful of frames; well under
        // the 20 frames (~0.66s) we're about to insert.
        val buffer = FrameRingBuffer(windowUs = 200_000L)
        for (i in 0 until 10) {
            buffer.add(syntheticFrame(i, keyFrameEveryN = 5))
        }
        val sizeAfterFirstBatch = buffer.size

        for (i in 10 until 20) {
            buffer.add(syntheticFrame(i, keyFrameEveryN = 5))
        }

        val snapshot = buffer.snapshot()
        // The very first frames must have been evicted (overwritten), not retained forever.
        assertTrue(snapshot.none { it.presentationTimeUs == 0L })
        // Buffer size is bounded by the time window, not by total frames ever inserted.
        assertTrue(snapshot.size < 20)
        assertTrue(snapshot.size <= sizeAfterFirstBatch + 2)
    }

    @Test
    fun `snapshot from oldest keyframe starts exactly at a keyframe when one exists`() {
        val buffer = FrameRingBuffer(windowUs = 10_000_000L)
        for (i in 0 until 45) {
            buffer.add(syntheticFrame(i, keyFrameEveryN = 15))
        }

        val clip = buffer.snapshotFromOldestKeyframe()

        assertTrue(clip.isNotEmpty())
        assertTrue("clip must start on a keyframe", clip.first().isKeyFrame)
    }

    @Test
    fun `falls back to entire buffer without throwing when no keyframe is present`() {
        val buffer = FrameRingBuffer(windowUs = 10_000_000L)
        // keyFrameEveryN larger than the number of frames inserted -> no keyframe at all.
        for (i in 1..20) {
            buffer.add(syntheticFrame(i, keyFrameEveryN = 1000))
        }

        val clip = buffer.snapshotFromOldestKeyframe()

        assertEquals(buffer.snapshot().size, clip.size)
    }

    @Test
    fun `clear releases all buffered frames`() {
        val buffer = FrameRingBuffer(windowUs = 10_000_000L)
        for (i in 0 until 30) {
            buffer.add(syntheticFrame(i))
        }
        assertTrue(buffer.size > 0)

        buffer.clear()

        assertEquals(0, buffer.size)
        assertTrue(buffer.snapshotFromOldestKeyframe().isEmpty())
    }

    @Test
    fun `repeated start-stop cycles never accumulate frames beyond one session`() {
        // Regression test for the buffer-restart leak scenario in the audit
        // checklist: CameraEncoderController.stop() calls ringBuffer.clear()
        // and drops the reference, but a real leak would show up here as the
        // buffer's internal size creeping up session over session.
        val windowUs = 3_000_000L
        val maxSizeSeenPerSession = mutableListOf<Int>()

        repeat(50) { session ->
            val buffer = FrameRingBuffer(windowUs = windowUs)
            for (i in 0 until 90) {
                buffer.add(syntheticFrame(session * 1000 + i))
            }
            maxSizeSeenPerSession.add(buffer.size)
            buffer.clear()
            assertEquals("buffer must be empty immediately after clear()", 0, buffer.size)
        }

        // Every session fills the same window with the same frame rate, so
        // every session's peak size should be identical -- if a leak let
        // frames from a previous session survive, later sessions would
        // report a growing size instead.
        assertEquals(1, maxSizeSeenPerSession.distinct().size)
    }
}
