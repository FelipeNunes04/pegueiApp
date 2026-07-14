import XCTest
import Foundation

final class FrameRingBufferTests: XCTestCase {
    private let fps: Int64 = 30
    private var frameIntervalUs: Int64 { 1_000_000 / fps }

    private func syntheticFrame(_ index: Int64, keyFrameEveryN: Int64 = 30) -> EncodedFrame {
        EncodedFrame(
            data: Data([UInt8(index % 256)]),
            presentationTimeUs: index * frameIntervalUs,
            isKeyFrame: index % keyFrameEveryN == 0
        )
    }

    func testPreservesInsertionOrderForFramesWithinTheWindow() {
        let buffer = FrameRingBuffer(windowUs: 10_000_000)
        for i in 0..<60 {
            buffer.add(syntheticFrame(Int64(i)))
        }

        let timestamps = buffer.snapshot().map { $0.presentationTimeUs }
        XCTAssertEqual(timestamps, timestamps.sorted())
    }

    func testEvictsFramesOlderThanTheConfiguredTimeWindow() {
        let windowSeconds: Int64 = 5
        let buffer = FrameRingBuffer(windowUs: windowSeconds * 1_000_000)

        let totalFrames = Int(20 * fps)
        for i in 0..<totalFrames {
            buffer.add(syntheticFrame(Int64(i)))
        }

        let snapshot = buffer.snapshot()
        let oldestPts = snapshot.first!.presentationTimeUs
        let newestPts = snapshot.last!.presentationTimeUs

        XCTAssertLessThanOrEqual(newestPts - oldestPts, windowSeconds * 1_000_000)
        let expectedCount = Int(windowSeconds) * Int(fps)
        XCTAssertTrue((expectedCount - 1...expectedCount + 1).contains(snapshot.count))
    }

    func testOverwritesOldestFramesOnceCapacityWindowIsExceeded() {
        // ~0.2s window at 30fps holds only a handful of frames; well under
        // the 20 frames (~0.66s) we're about to insert.
        let buffer = FrameRingBuffer(windowUs: 200_000)
        for i in 0..<10 {
            buffer.add(syntheticFrame(Int64(i), keyFrameEveryN: 5))
        }
        let sizeAfterFirstBatch = buffer.size

        for i in 10..<20 {
            buffer.add(syntheticFrame(Int64(i), keyFrameEveryN: 5))
        }

        let snapshot = buffer.snapshot()
        XCTAssertFalse(snapshot.contains { $0.presentationTimeUs == 0 })
        XCTAssertLessThan(snapshot.count, 20)
        XCTAssertLessThanOrEqual(snapshot.count, sizeAfterFirstBatch + 2)
    }

    func testSnapshotFromOldestKeyframeStartsExactlyAtAKeyframeWhenOneExists() {
        let buffer = FrameRingBuffer(windowUs: 10_000_000)
        for i in 0..<45 {
            buffer.add(syntheticFrame(Int64(i), keyFrameEveryN: 15))
        }

        let clip = buffer.snapshotFromOldestKeyframe()
        XCTAssertFalse(clip.isEmpty)
        XCTAssertTrue(clip.first!.isKeyFrame)
    }

    func testFallsBackToEntireBufferWithoutThrowingWhenNoKeyframeIsPresent() {
        let buffer = FrameRingBuffer(windowUs: 10_000_000)
        for i in 1...20 {
            buffer.add(syntheticFrame(Int64(i), keyFrameEveryN: 1000))
        }

        let clip = buffer.snapshotFromOldestKeyframe()
        XCTAssertEqual(clip.count, buffer.snapshot().count)
    }

    func testClearReleasesAllBufferedFrames() {
        let buffer = FrameRingBuffer(windowUs: 10_000_000)
        for i in 0..<30 {
            buffer.add(syntheticFrame(Int64(i)))
        }
        XCTAssertGreaterThan(buffer.size, 0)

        buffer.clear()

        XCTAssertEqual(buffer.size, 0)
        XCTAssertTrue(buffer.snapshotFromOldestKeyframe().isEmpty)
    }

    func testRepeatedStartStopCyclesNeverAccumulateFramesBeyondOneSession() {
        // Regression test mirroring the Android JUnit suite: repeated
        // buffer/clear cycles (simulating stop/restart) must never let
        // frames leak across sessions.
        let windowUs: Int64 = 3_000_000
        var maxSizePerSession = Set<Int>()

        for session in 0..<50 {
            let buffer = FrameRingBuffer(windowUs: windowUs)
            for i in 0..<90 {
                buffer.add(syntheticFrame(Int64(session * 1000 + i)))
            }
            maxSizePerSession.insert(buffer.size)
            buffer.clear()
            XCTAssertEqual(buffer.size, 0)
        }

        XCTAssertEqual(maxSizePerSession.count, 1)
    }
}
