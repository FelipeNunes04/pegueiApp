import XCTest
import Foundation

/// Exercises PipelineHealthPolicy.swift directly (the file is compiled into
/// this target alongside the app, like FrameRingBuffer.swift) -- these are
/// the pure decisions CameraEncoderController's recovery paths delegate to.
/// The AVFoundation side of those paths (actually rebuilding a
/// VTCompressionSession, restarting an AVCaptureSession, setting frame
/// durations) still needs on-device verification; see the plan doc.
final class PipelineHealthPolicyTests: XCTestCase {

    // MARK: - FrameFlowWatchdog

    func testWatchdogDoesNothingWhileFramesFlow() {
        var watchdog = FrameFlowWatchdog()
        watchdog.reset(now: 0)
        for second in 1...20 {
            let now = TimeInterval(second)
            XCTAssertEqual(watchdog.evaluate(now: now, lastFrameTime: now - 0.03, isEligible: true), .none)
        }
        XCTAssertEqual(watchdog.stage, .monitoring)
    }

    func testWatchdogGivesTheFreshPipelineAGraceWindowBeforeTheFirstFrame() {
        var watchdog = FrameFlowWatchdog(stallThreshold: 3)
        watchdog.reset(now: 100)
        XCTAssertEqual(watchdog.evaluate(now: 101, lastFrameTime: nil, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 103, lastFrameTime: nil, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 103.5, lastFrameTime: nil, isEligible: true), .rebuildEncoder)
    }

    func testWatchdogEscalatesEncoderThenPipelineRestartsThenGivesUp() {
        var watchdog = FrameFlowWatchdog(stallThreshold: 3, restartGrace: 6, maxPipelineRestarts: 2)
        watchdog.reset(now: 0)
        let lastFrame: TimeInterval = 10

        XCTAssertEqual(watchdog.evaluate(now: 12, lastFrameTime: lastFrame, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 13.5, lastFrameTime: lastFrame, isEligible: true), .rebuildEncoder)
        XCTAssertEqual(watchdog.stage, .encoderRebuilt)

        // The rebuild gets its own full window.
        XCTAssertEqual(watchdog.evaluate(now: 16, lastFrameTime: lastFrame, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 17, lastFrameTime: lastFrame, isEligible: true), .restartPipeline)
        XCTAssertEqual(watchdog.stage, .pipelineRestarted(count: 1))

        // A full restart gets the longer restartGrace window.
        XCTAssertEqual(watchdog.evaluate(now: 21, lastFrameTime: lastFrame, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 23.5, lastFrameTime: lastFrame, isEligible: true), .restartPipeline)
        XCTAssertEqual(watchdog.stage, .pipelineRestarted(count: 2))

        XCTAssertEqual(watchdog.evaluate(now: 30, lastFrameTime: lastFrame, isEligible: true), .giveUp)
        XCTAssertEqual(watchdog.stage, .gaveUp)
        // Giving up is terminal until the next reset -- no repeated giveUp spam.
        XCTAssertEqual(watchdog.evaluate(now: 60, lastFrameTime: lastFrame, isEligible: true), .none)

        watchdog.reset(now: 61)
        XCTAssertEqual(watchdog.stage, .monitoring)
    }

    func testWatchdogReportsRecoveryWhenAFrameArrivesAfterTheLastAction() {
        var watchdog = FrameFlowWatchdog(stallThreshold: 3)
        watchdog.reset(now: 0)
        XCTAssertEqual(watchdog.evaluate(now: 4, lastFrameTime: nil, isEligible: true), .rebuildEncoder)
        // A frame that predates the action is not a recovery.
        XCTAssertEqual(watchdog.evaluate(now: 5, lastFrameTime: 0.5, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 6, lastFrameTime: 5.5, isEligible: true), .recovered)
        XCTAssertEqual(watchdog.stage, .monitoring)
        // And the ladder starts over from the bottom on the next stall.
        XCTAssertEqual(watchdog.evaluate(now: 9.6, lastFrameTime: 5.5, isEligible: true), .rebuildEncoder)
    }

    func testWatchdogNeverActsWhileIneligibleAndRestartsGraceAfterwards() {
        var watchdog = FrameFlowWatchdog(stallThreshold: 3)
        watchdog.reset(now: 0)
        // Interrupted (phone call) for a minute with no frames at all.
        for second in 1...60 {
            XCTAssertEqual(watchdog.evaluate(now: TimeInterval(second), lastFrameTime: 0.5, isEligible: false), .none)
        }
        // Interruption ended: a fresh full window before anything happens.
        XCTAssertEqual(watchdog.evaluate(now: 61, lastFrameTime: 0.5, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 63.9, lastFrameTime: 0.5, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 64.1, lastFrameTime: 0.5, isEligible: true), .rebuildEncoder)
    }

    func testWatchdogRestartWindowKeepsEscalationStage() {
        var watchdog = FrameFlowWatchdog(stallThreshold: 3)
        watchdog.reset(now: 0)
        XCTAssertEqual(watchdog.evaluate(now: 4, lastFrameTime: nil, isEligible: true), .rebuildEncoder)
        watchdog.restartWindow(now: 6)
        XCTAssertEqual(watchdog.stage, .encoderRebuilt)
        XCTAssertEqual(watchdog.evaluate(now: 8.5, lastFrameTime: nil, isEligible: true), .none)
        XCTAssertEqual(watchdog.evaluate(now: 9.5, lastFrameTime: nil, isEligible: true), .restartPipeline)
    }

    // MARK: - ThermalFpsPolicy

    func testThermalStepDownMapping() {
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .nominal), 30)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .fair), 30)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .serious), 24)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .critical), 15)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .shutdown), 15)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 60, level: .serious), 24)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 60, level: .nominal), 60)
    }

    func testThermalStepDownNeverExceedsConfiguredFps() {
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 24, level: .serious), 24)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 24, level: .critical), 15)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 12, level: .critical), 12)
        // Even a format minimum above the configured rate can't push it up.
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 12, level: .critical, minSupportedFps: 20), 12)
    }

    func testThermalStepDownRespectsTheFormatMinimum() {
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .critical, minSupportedFps: 20), 20)
        XCTAssertEqual(ThermalFpsPolicy.targetFps(configuredFps: 30, level: .critical, minSupportedFps: 2), 15)
    }

    func testThrottledFlag() {
        XCTAssertTrue(ThermalFpsPolicy.isThrottled(configuredFps: 30, targetFps: 24))
        XCTAssertFalse(ThermalFpsPolicy.isThrottled(configuredFps: 30, targetFps: 30))
        XCTAssertFalse(ThermalFpsPolicy.isThrottled(configuredFps: 24, targetFps: 24))
    }

    // MARK: - EncoderErrorPolicy

    func testInvalidSessionErrorRecreatesImmediately() {
        var policy = EncoderErrorPolicy(maxConsecutiveErrors: 10)
        XCTAssertTrue(policy.recordError(status: -12903))
    }

    func testEncoderMalfunctionRecreatesImmediately() {
        var policy = EncoderErrorPolicy(maxConsecutiveErrors: 10)
        XCTAssertTrue(policy.recordError(status: -12911))
    }

    func testTransientErrorsOnlyEscalateWhenConsecutive() {
        var policy = EncoderErrorPolicy(maxConsecutiveErrors: 3)
        XCTAssertFalse(policy.recordError(status: -12902))
        XCTAssertFalse(policy.recordError(status: -12902))
        policy.recordSuccess()
        XCTAssertFalse(policy.recordError(status: -12902))
        XCTAssertFalse(policy.recordError(status: -12902))
        XCTAssertTrue(policy.recordError(status: -12902))
    }

    func testRecreateIsRequestedOnlyOnceUntilReset() {
        var policy = EncoderErrorPolicy(maxConsecutiveErrors: 3)
        XCTAssertTrue(policy.recordError(status: -12903))
        for _ in 0..<30 {
            XCTAssertFalse(policy.recordError(status: -12903))
        }
        policy.reset()
        XCTAssertEqual(policy.consecutiveErrors, 0)
        XCTAssertTrue(policy.recordError(status: -12903))
    }

    // MARK: - SessionRestartBackoff

    func testSessionRestartBackoffDoublesAndCaps() {
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 0), 0.5)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 1), 1)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 2), 2)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 3), 4)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 4), 8)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: 50), 8)
        XCTAssertEqual(SessionRestartBackoff.delay(forAttempt: -1), 0.5)
    }

    // MARK: - SaveVerification

    func testSaveVerificationAcceptsARealClip() {
        XCTAssertNil(SaveVerification.failureReason(fileExists: true, fileSizeBytes: 1_234_567, videoTrackCount: 1))
    }

    func testSaveVerificationRejectsMissingEmptyOrTracklessFiles() {
        XCTAssertNotNil(SaveVerification.failureReason(fileExists: false, fileSizeBytes: 0, videoTrackCount: 0))
        XCTAssertNotNil(SaveVerification.failureReason(fileExists: true, fileSizeBytes: 0, videoTrackCount: 1))
        XCTAssertNotNil(SaveVerification.failureReason(fileExists: true, fileSizeBytes: 4096, videoTrackCount: 0))
    }

    // MARK: - BufferHealthTracker

    func testHealthPriorityOrder() {
        XCTAssertEqual(BufferHealthTracker.resolve(isInterrupted: true, isRecovering: true, isThrottled: true), .interrupted)
        XCTAssertEqual(BufferHealthTracker.resolve(isInterrupted: false, isRecovering: true, isThrottled: true), .recovering)
        XCTAssertEqual(BufferHealthTracker.resolve(isInterrupted: false, isRecovering: false, isThrottled: true), .throttled)
        XCTAssertEqual(BufferHealthTracker.resolve(isInterrupted: false, isRecovering: false, isThrottled: false), .healthy)
    }

    func testHealthTrackerEmitsOnlyTransitions() {
        var tracker = BufferHealthTracker()
        XCTAssertEqual(tracker.takeTransition(), .healthy)
        XCTAssertNil(tracker.takeTransition())

        tracker.isThrottled = true
        XCTAssertEqual(tracker.takeTransition(), .throttled)
        tracker.isInterrupted = true
        XCTAssertEqual(tracker.takeTransition(), .interrupted)
        // Thermal pressure clearing *during* an interruption isn't visible.
        tracker.isThrottled = false
        XCTAssertNil(tracker.takeTransition())
        tracker.isInterrupted = false
        XCTAssertEqual(tracker.takeTransition(), .healthy)
    }

    func testHealthTrackerResetReemitsTheFirstState() {
        var tracker = BufferHealthTracker()
        XCTAssertEqual(tracker.takeTransition(), .healthy)
        tracker.isRecovering = true
        tracker.reset()
        XCTAssertFalse(tracker.isRecovering)
        XCTAssertEqual(tracker.takeTransition(), .healthy)
    }
}
