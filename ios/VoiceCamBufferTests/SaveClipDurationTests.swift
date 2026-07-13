import XCTest
import Foundation

/// CameraEncoderController.startManualRecording()/stopManualRecording()
/// can't run under plain XCTest logic tests (they drive
/// AVCaptureSession/VTCompressionSession/AVAssetWriter, which need real
/// camera hardware). This mirrors their exact clip-assembly algorithm --
/// `ringBuffer.snapshotFromOldestKeyframe()` for the head at "start" time,
/// then appending live frames indefinitely until "stop" for the tail --
/// against a synthetic frame stream, to pin down the core value
/// proposition: a saved clip must contain the seconds that were *already
/// buffered* before the start tap, concatenated with however long the user
/// actually recorded (start tap to stop tap), not a fixed post-roll. Mirrors
/// the Android JUnit suite (SaveClipDurationTest.kt). See DECISIONS.md and
/// CameraEncoderController.startManualRecording/stopManualRecording.
final class SaveClipDurationTests: XCTestCase {
    private let fps: Int64 = 30
    private var frameIntervalUs: Int64 { 1_000_000 / fps }

    private func syntheticFrame(_ index: Int64, keyFrameEveryN: Int64 = 30) -> EncodedFrame {
        EncodedFrame(
            data: Data([UInt8(index % 256)]),
            presentationTimeUs: index * frameIntervalUs,
            isKeyFrame: index % keyFrameEveryN == 0
        )
    }

    /// Mirrors CameraEncoderController's start/stop + finalizeSave()'s duration math without touching AVFoundation.
    private func simulateRecording(buffer: FrameRingBuffer, framesAlreadyFed: Int64, manualRecordingSeconds: Int64) -> Double {
        // "Start" -- snapshot the pre-roll buffer, exactly like startManualRecording().
        let head = buffer.snapshotFromOldestKeyframe()

        // The user keeps recording for `manualRecordingSeconds` -- frames
        // keep accumulating with no fixed target, exactly like
        // appendToPendingSaveIfNeeded()'s unconditional tailFrames.append()
        // while a recording is in flight.
        var tailFrames: [EncodedFrame] = []
        let framesToRecord = manualRecordingSeconds * fps
        for i in framesAlreadyFed..<(framesAlreadyFed + framesToRecord) {
            let frame = syntheticFrame(i)
            buffer.add(frame)
            tailFrames.append(frame)
        }

        // "Stop" -- finalize using whatever tail frames accumulated so far.
        let allFrames = head + tailFrames
        let startUs = allFrames.first!.presentationTimeUs
        return Double(allFrames.last!.presentationTimeUs - startUs) / 1_000_000.0
    }

    func testRecordingStartedAfterTheBufferWindowIsFullIncludesTheFullPreRollPlusTheManualRecordingLength() {
        let bufferSeconds: Int64 = 30
        let manualRecordingSeconds: Int64 = 5
        let buffer = FrameRingBuffer(windowUs: bufferSeconds * 1_000_000)

        // Simulate the buffer having been running long enough to be completely full.
        let framesFed = bufferSeconds * fps
        for i in 0..<framesFed {
            buffer.add(syntheticFrame(i))
        }

        let durationSeconds = simulateRecording(buffer: buffer, framesAlreadyFed: framesFed, manualRecordingSeconds: manualRecordingSeconds)

        let expected = Double(bufferSeconds + manualRecordingSeconds)
        XCTAssertEqual(durationSeconds, expected, accuracy: 0.5,
                        "clip duration must be ~= full pre-roll window + manual recording length, not just the manual recording")
    }

    func testRecordingStartedShortlyAfterBufferingBeginsOnlyIncludesElapsedPreRollAndIsNeverJustTheManualRecording() {
        let bufferSeconds: Int64 = 30
        let manualRecordingSeconds: Int64 = 5
        let elapsedBeforeStartSeconds: Int64 = 6
        let buffer = FrameRingBuffer(windowUs: bufferSeconds * 1_000_000)

        // The buffer window (30s) is far from full -- only 6s have elapsed since the screen opened.
        let framesFed = elapsedBeforeStartSeconds * fps
        for i in 0..<framesFed {
            buffer.add(syntheticFrame(i))
        }

        let durationSeconds = simulateRecording(buffer: buffer, framesAlreadyFed: framesFed, manualRecordingSeconds: manualRecordingSeconds)

        let expected = Double(elapsedBeforeStartSeconds + manualRecordingSeconds)
        XCTAssertEqual(durationSeconds, expected, accuracy: 0.5,
                        "clip duration must reflect elapsed pre-roll + manual recording length")

        // The regression this guards against: treating the start tap as
        // "start of the whole clip" (discarding pre-roll) would produce a
        // clip whose duration is only ~manualRecordingSeconds.
        XCTAssertGreaterThan(
            abs(durationSeconds - Double(manualRecordingSeconds)), 1.0,
            "clip duration (\(durationSeconds)s) must be meaningfully longer than the manual recording alone (\(manualRecordingSeconds)s) -- " +
            "if this fails, the save is discarding pre-roll and only capturing the manual recording"
        )
    }

    func testALongerManualRecordingExtendsTheClipBeyondThePreRollWindow() {
        let bufferSeconds: Int64 = 30
        let manualRecordingSeconds: Int64 = 20
        let buffer = FrameRingBuffer(windowUs: bufferSeconds * 1_000_000)

        let framesFed = bufferSeconds * fps
        for i in 0..<framesFed {
            buffer.add(syntheticFrame(i))
        }

        let durationSeconds = simulateRecording(buffer: buffer, framesAlreadyFed: framesFed, manualRecordingSeconds: manualRecordingSeconds)

        let expected = Double(bufferSeconds + manualRecordingSeconds)
        XCTAssertEqual(durationSeconds, expected, accuracy: 0.5,
                        "the user controls how long the manual recording lasts -- it isn't capped at a fixed post-roll")
    }
}
