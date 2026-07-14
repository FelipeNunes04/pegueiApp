package com.felipenunes.pegueiapp.circularbuffer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * CameraEncoderController.startManualRecording()/stopManualRecording() can't
 * run under plain JUnit (they drive Camera2/MediaCodec/MediaMuxer, which
 * need a real device). This test instead replicates their exact
 * clip-assembly algorithm -- `ringBuffer.snapshotFromOldestKeyframe()` for
 * the head at "start" time, then appending live frames indefinitely until
 * "stop" for the tail -- against a synthetic frame stream, to pin down the
 * core value proposition: a saved clip must contain the seconds that were
 * *already buffered* before the start tap, concatenated with however long
 * the user actually recorded (start tap to stop tap), not a fixed post-roll.
 * See DECISIONS.md and CameraEncoderController.startManualRecording/stopManualRecording.
 */
class SaveClipDurationTest {

    private val fps = 30
    private val frameIntervalUs = 1_000_000L / fps

    private fun syntheticFrame(index: Int, keyFrameEveryN: Int = 30): EncodedFrame {
        return EncodedFrame(
            data = byteArrayOf(index.toByte()),
            presentationTimeUs = index * frameIntervalUs,
            isKeyFrame = index % keyFrameEveryN == 0,
        )
    }

    /** Mirrors CameraEncoderController's start/stop + finalizeSave() duration math without touching MediaCodec/MediaMuxer. */
    private fun simulateRecording(
        buffer: FrameRingBuffer,
        framesAlreadyFed: Int,
        manualRecordingSeconds: Int,
    ): Double {
        // "Start" -- snapshot the pre-roll buffer, exactly like startManualRecording().
        val head = buffer.snapshotFromOldestKeyframe()

        // The user keeps recording for `manualRecordingSeconds` -- frames
        // keep accumulating with no fixed target, exactly like
        // onFrameEncoded()'s unconditional tailFrames.add() while a
        // recording is in flight.
        val tailFrames = mutableListOf<EncodedFrame>()
        val framesToRecord = manualRecordingSeconds * fps
        for (i in framesAlreadyFed until framesAlreadyFed + framesToRecord) {
            val frame = syntheticFrame(i)
            buffer.add(frame)
            tailFrames.add(frame)
        }

        // "Stop" -- finalize using whatever tail frames accumulated so far.
        val allFrames = head + tailFrames
        val startUs = allFrames.first().presentationTimeUs
        return (allFrames.last().presentationTimeUs - startUs) / 1_000_000.0
    }

    @Test
    fun `recording started after the buffer window is full includes the full pre-roll plus the manual recording length`() {
        val bufferSeconds = 30
        val manualRecordingSeconds = 5
        val buffer = FrameRingBuffer(windowUs = bufferSeconds * 1_000_000L)

        // Simulate the buffer having been running long enough to be completely full.
        val framesFed = bufferSeconds * fps
        for (i in 0 until framesFed) {
            buffer.add(syntheticFrame(i))
        }

        val durationSeconds = simulateRecording(buffer, framesFed, manualRecordingSeconds)

        val expected = bufferSeconds + manualRecordingSeconds
        assertEquals(
            "clip duration must be ~= full pre-roll window + manual recording length, not just the manual recording",
            expected.toDouble(),
            durationSeconds,
            0.5,
        )
    }

    @Test
    fun `recording started shortly after buffering begins only includes elapsed pre-roll, and is never just the manual recording`() {
        val bufferSeconds = 30
        val manualRecordingSeconds = 5
        val elapsedBeforeStartSeconds = 6
        val buffer = FrameRingBuffer(windowUs = bufferSeconds * 1_000_000L)

        // The buffer window (30s) is far from full -- only 6s have elapsed since the screen opened.
        val framesFed = elapsedBeforeStartSeconds * fps
        for (i in 0 until framesFed) {
            buffer.add(syntheticFrame(i))
        }

        val durationSeconds = simulateRecording(buffer, framesFed, manualRecordingSeconds)

        val expected = elapsedBeforeStartSeconds + manualRecordingSeconds
        assertEquals(
            "clip duration must reflect elapsed pre-roll + manual recording length",
            expected.toDouble(),
            durationSeconds,
            0.5,
        )
        // The regression this guards against: treating the start tap as
        // "start of the whole clip" (discarding pre-roll) would produce a
        // clip whose duration is only ~manualRecordingSeconds.
        assertTrueNotJustManualRecording(durationSeconds, manualRecordingSeconds)
    }

    @Test
    fun `a longer manual recording extends the clip beyond the pre-roll window`() {
        val bufferSeconds = 30
        val manualRecordingSeconds = 20
        val buffer = FrameRingBuffer(windowUs = bufferSeconds * 1_000_000L)

        val framesFed = bufferSeconds * fps
        for (i in 0 until framesFed) {
            buffer.add(syntheticFrame(i))
        }

        val durationSeconds = simulateRecording(buffer, framesFed, manualRecordingSeconds)

        val expected = bufferSeconds + manualRecordingSeconds
        assertEquals(
            "the user controls how long the manual recording lasts -- it isn't capped at a fixed post-roll",
            expected.toDouble(),
            durationSeconds,
            0.5,
        )
    }

    private fun assertTrueNotJustManualRecording(durationSeconds: Double, manualRecordingSeconds: Int) {
        val diff = abs(durationSeconds - manualRecordingSeconds)
        assertTrue(
            "clip duration ($durationSeconds s) must be meaningfully longer than the manual recording alone ($manualRecordingSeconds s) -- " +
                "if this fails, the save is discarding pre-roll and only capturing the manual recording",
            diff > 1.0,
        )
    }
}
