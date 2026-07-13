package com.voicecambuffer.circularbuffer

import java.util.ArrayDeque

/**
 * Pure, Android-framework-free ring buffer of already-encoded frames.
 *
 * Frames are expected to arrive in non-decreasing presentation-time order
 * (as MediaCodec emits them). The buffer evicts frames older than
 * [windowUs] every time a new frame is appended, so memory stays bounded
 * regardless of how long buffering runs.
 *
 * This class intentionally has zero Android SDK dependency so it can run
 * under plain JVM JUnit tests (no instrumentation/emulator needed).
 */
class FrameRingBuffer(windowUs: Long) {

    var windowUs: Long = windowUs
        private set

    private val frames = ArrayDeque<EncodedFrame>()

    val size: Int
        get() = frames.size

    fun updateWindow(newWindowUs: Long) {
        windowUs = newWindowUs
        evictOldFrames()
    }

    @Synchronized
    fun add(frame: EncodedFrame) {
        frames.addLast(frame)
        evictOldFrames()
    }

    private fun evictOldFrames() {
        if (frames.isEmpty()) return
        val newestPts = frames.last.presentationTimeUs
        while (frames.isNotEmpty() && newestPts - frames.first.presentationTimeUs > windowUs) {
            frames.removeFirst()
        }
    }

    @Synchronized
    fun clear() {
        frames.clear()
    }

    /**
     * Returns an immutable snapshot of all frames currently held, starting
     * at the oldest available keyframe (so the result can be muxed into a
     * decodable clip). If the buffer holds no keyframe at all (e.g. GOP
     * length longer than the buffer window), every currently buffered frame
     * is returned instead of failing -- callers must not crash or throw in
     * this case, they simply get a clip that starts mid-GOP.
     */
    @Synchronized
    fun snapshotFromOldestKeyframe(): List<EncodedFrame> {
        val all = frames.toList()
        val firstKeyframeIndex = all.indexOfFirst { it.isKeyFrame }
        return if (firstKeyframeIndex <= 0) all else all.subList(firstKeyframeIndex, all.size)
    }

    @Synchronized
    fun snapshot(): List<EncodedFrame> = frames.toList()
}
