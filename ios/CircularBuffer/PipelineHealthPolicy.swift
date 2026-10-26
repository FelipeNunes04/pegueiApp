import Foundation

// Pure, AVFoundation/VideoToolbox/UIKit-free decision logic for the capture
// pipeline's self-healing, thermal step-down and save verification (see
// docs/plans/2026-10-21-reliability-battery-triggers.md). Everything here is
// deliberately plain value types fed with plain numbers/booleans: the
// *decisions* (when to rebuild the encoder, when to give up, which fps to
// run at, whether a written file counts as a saved clip) are what actually
// regressed in the field ("Buffer vazio, nada para salvar." after a long
// session), and they're exactly the part that can't be exercised through
// CameraEncoderController.swift itself in a logic-only XCTest bundle (no
// camera, no hardware encoder, no AVAssetWriter). Like FrameRingBuffer.swift
// and EncodedFrame.swift, this file is compiled directly into both the app
// and the PegueiTests target (no `@testable import`), so the tests exercise
// the very same code the controller runs instead of a hand-mirrored copy
// (the way FormatSelectionTests/SaveClipDurationTests have to).

/// The `CircularBufferHealth` event's `state` values. Raw values are the
/// exact strings the JS side receives -- see the bridge contract.
enum BufferHealthState: String {
    case healthy
    case recovering
    case interrupted
    case throttled
}

/// Collapses the pipeline's independent health conditions into the single
/// state JS sees, and reports only *transitions* (the contract says the
/// event fires only when the state changes, so the JS indicator never has
/// to dedupe a 1 Hz stream of identical states).
///
/// Priority is interrupted > recovering > throttled > healthy: an OS
/// interruption (call, Siri, camera taken by another app) explains why no
/// frames flow, so showing "recovering" on top of it would be misleading;
/// a rebuild in progress matters more to the user than a reduced frame
/// rate, because the former means the pre-roll is currently empty.
struct BufferHealthTracker {
    var isInterrupted = false
    var isRecovering = false
    var isThrottled = false
    private(set) var lastEmitted: BufferHealthState?

    static func resolve(isInterrupted: Bool, isRecovering: Bool, isThrottled: Bool) -> BufferHealthState {
        if isInterrupted { return .interrupted }
        if isRecovering { return .recovering }
        if isThrottled { return .throttled }
        return .healthy
    }

    var current: BufferHealthState {
        Self.resolve(isInterrupted: isInterrupted, isRecovering: isRecovering, isThrottled: isThrottled)
    }

    /// Returns the new state if it differs from the last one emitted (and
    /// records it as emitted), or nil when nothing changed.
    mutating func takeTransition() -> BufferHealthState? {
        let state = current
        guard state != lastEmitted else { return nil }
        lastEmitted = state
        return state
    }

    /// Called on every fresh pipeline start: all conditions cleared and
    /// `lastEmitted` forgotten, so the first state after a (re)start is
    /// always emitted even if it equals whatever was last sent before the
    /// pipeline was torn down -- JS may have reset its own indicator in the
    /// meantime (e.g. CameraScreen remounting).
    mutating func reset() {
        isInterrupted = false
        isRecovering = false
        isThrottled = false
        lastEmitted = nil
    }
}

/// Plain mirror of `AVCaptureDevice.SystemPressureState.Level` (a
/// string-backed struct in AVFoundation, which this file can't import).
enum ThermalPressureLevel {
    case nominal
    case fair
    case serious
    case critical
    case shutdown
}

/// Thermal step-down: the frame rate the capture device should run at for
/// a given system-pressure level. Lowering fps is the single most effective
/// lever an always-on capture app has against heat -- sensor readout, ISP,
/// the hardware encoder and the ring buffer's memory churn all scale
/// linearly with it -- and Apple's own guidance for
/// `systemPressureState` is exactly "reduce frame rate at .serious/
/// .critical before the system shuts the camera down at .shutdown".
///
/// Never returns more than the user's configured fps (a 24 fps user stays
/// at 24 at .serious, not bumped up), and never less than the active
/// format's minimum supported rate (setting a frame duration outside the
/// format's `videoSupportedFrameRateRanges` throws an Objective-C exception
/// that Swift can't catch).
enum ThermalFpsPolicy {
    static let seriousFps = 24
    static let criticalFps = 15

    static func targetFps(configuredFps: Int, level: ThermalPressureLevel, minSupportedFps: Int = 1) -> Int {
        let ceiling: Int
        switch level {
        case .nominal, .fair:
            return configuredFps
        case .serious:
            ceiling = seriousFps
        case .critical, .shutdown:
            ceiling = criticalFps
        }
        let stepped = min(configuredFps, ceiling)
        // The floor can never push us *above* the configured rate either.
        return min(configuredFps, max(stepped, minSupportedFps))
    }

    static func isThrottled(configuredFps: Int, targetFps: Int) -> Bool {
        targetFps < configuredFps
    }
}

/// What the frame-flow watchdog wants done after one evaluation tick.
enum WatchdogAction: Equatable {
    case none
    /// Frames are flowing again after an earlier escalation.
    case recovered
    /// First rung: tear down and recreate only the VTCompressionSession.
    case rebuildEncoder
    /// Second rung: full capture pipeline teardown + reopen, keeping the
    /// pending config (repeated up to `maxPipelineRestarts` times).
    case restartPipeline
    /// Nothing worked: stop pretending -- the controller marks itself as not
    /// running so `isBuffering()` tells JS the truth and the AppState
    /// handler / the next screen focus can start over from scratch.
    case giveUp
}

/// Frame-flow watchdog. The controller records the time of the last
/// *encoded* frame (not merely captured -- a capture session happily
/// delivering pixel buffers into a dead VTCompressionSession was the
/// suspected failure mode) and calls `evaluate` on a 1 Hz tick. A pure
/// state machine so its escalation ladder is testable without a camera:
///
///     monitoring --stall--> rebuildEncoder --stall--> restartPipeline
///         ^                                   (x maxPipelineRestarts)
///         |                                            |
///         +-------- frame after last action -----------+--stall--> giveUp
///
/// "Stall" means no encoded frame for longer than the threshold *while
/// eligible* (running, not interrupted by the OS, app active). Any stretch
/// of ineligibility (an interruption, the app going inactive) discards the
/// current observation window, so a fresh full threshold of grace starts
/// when eligibility returns -- the pipeline gets a real chance to resume on
/// its own after e.g. a phone call before anything is torn down.
struct FrameFlowWatchdog {
    enum Stage: Equatable {
        case monitoring
        case encoderRebuilt
        case pipelineRestarted(count: Int)
        case gaveUp
    }

    let stallThreshold: TimeInterval
    /// A full restart reopens the device, renegotiates the format and
    /// starts the session (routinely ~1 s, occasionally more on a cold
    /// sensor), so it gets a longer window than an encoder-only rebuild
    /// before being judged a failure.
    let restartGrace: TimeInterval
    let maxPipelineRestarts: Int

    private(set) var stage: Stage = .monitoring
    private var windowStart: TimeInterval?
    private var lastActionTime: TimeInterval?

    init(stallThreshold: TimeInterval = 3, restartGrace: TimeInterval = 6, maxPipelineRestarts: Int = 2) {
        self.stallThreshold = stallThreshold
        self.restartGrace = restartGrace
        self.maxPipelineRestarts = maxPipelineRestarts
    }

    /// Fresh start (pipeline (re)opened by the normal start path): forget
    /// any escalation and start a new grace window now.
    mutating func reset(now: TimeInterval) {
        stage = .monitoring
        windowStart = now
        lastActionTime = nil
    }

    /// Restart the observation window without forgetting the escalation
    /// stage (interruption ended, app became active again).
    mutating func restartWindow(now: TimeInterval) {
        windowStart = now
    }

    mutating func evaluate(now: TimeInterval, lastFrameTime: TimeInterval?, isEligible: Bool) -> WatchdogAction {
        guard isEligible else {
            windowStart = nil
            return .none
        }
        if windowStart == nil {
            windowStart = now
        }

        if stage != .monitoring, stage != .gaveUp, let lastActionTime, let lastFrameTime, lastFrameTime > lastActionTime {
            stage = .monitoring
            self.lastActionTime = nil
            return .recovered
        }

        let window: TimeInterval
        if case .pipelineRestarted = stage {
            window = restartGrace
        } else {
            window = stallThreshold
        }
        let lastProgress = max(lastFrameTime ?? -.infinity, windowStart ?? now)
        guard now - lastProgress > window else { return .none }

        switch stage {
        case .monitoring:
            stage = .encoderRebuilt
            markAction(now)
            return .rebuildEncoder
        case .encoderRebuilt:
            stage = .pipelineRestarted(count: 1)
            markAction(now)
            return .restartPipeline
        case let .pipelineRestarted(count):
            if count < maxPipelineRestarts {
                stage = .pipelineRestarted(count: count + 1)
                markAction(now)
                return .restartPipeline
            }
            stage = .gaveUp
            return .giveUp
        case .gaveUp:
            return .none
        }
    }

    private mutating func markAction(_ now: TimeInterval) {
        lastActionTime = now
        windowStart = now
    }
}

/// When a VTCompressionSession error should trigger recreating the session.
///
/// `kVTInvalidSessionErr` (-12903) is the well-known one: the hardware
/// encoder session is torn down underneath the app (classically after the
/// app was backgrounded/interrupted, or after a media-server reset) and
/// every subsequent encode call fails forever -- the session must be
/// recreated, nothing else brings it back. `kVTVideoEncoderMalfunctionErr`
/// (-12911) is the hardware encoder itself reporting a fault, same remedy.
/// Any other error is treated as possibly transient (a single dropped/
/// failed frame), and only escalates after `maxConsecutiveErrors` in a row
/// with no successfully encoded frame in between -- one bad frame shouldn't
/// throw away the whole pre-roll (recreating the encoder clears the ring
/// buffers, see CameraEncoderController.rebuildEncoder).
///
/// After it asks for a recreate it stays quiet (`recreateRequested`) until
/// `reset()` is called for the new session, so a burst of 30 failing frames
/// per second can't queue 30 rebuilds.
struct EncoderErrorPolicy {
    static let invalidSessionStatus: Int32 = -12903
    static let encoderMalfunctionStatus: Int32 = -12911

    let maxConsecutiveErrors: Int
    private(set) var consecutiveErrors = 0
    private(set) var recreateRequested = false

    init(maxConsecutiveErrors: Int = 10) {
        self.maxConsecutiveErrors = maxConsecutiveErrors
    }

    mutating func recordSuccess() {
        consecutiveErrors = 0
    }

    /// Returns true exactly once per failing session: when the caller should
    /// recreate the encoder now.
    mutating func recordError(status: Int32) -> Bool {
        guard !recreateRequested else { return false }
        consecutiveErrors += 1
        let fatal = status == Self.invalidSessionStatus || status == Self.encoderMalfunctionStatus
        if fatal || consecutiveErrors >= maxConsecutiveErrors {
            recreateRequested = true
            return true
        }
        return false
    }

    mutating func reset() {
        consecutiveErrors = 0
        recreateRequested = false
    }
}

/// Backoff schedule for retrying `AVCaptureSession.startRunning()` after a
/// non-fatal `AVCaptureSessionRuntimeError` (Apple's AVCam sample simply
/// calls startRunning() again; doing it in a tight loop against a device
/// that's still busy just burns power). After `maxAttempts` the controller
/// escalates to a full pipeline rebuild instead.
enum SessionRestartBackoff {
    static let maxAttempts = 4

    /// Delay before retry number `attempt` (0-based): 0.5 s, 1 s, 2 s, 4 s,
    /// capped at 8 s.
    static func delay(forAttempt attempt: Int) -> TimeInterval {
        let clamped = max(0, min(attempt, 4))
        return min(8, 0.5 * pow(2, Double(clamped)))
    }
}

/// The predicate `finalizeSave` applies after `AVAssetWriter` reports
/// `.completed`, before telling JS the clip was saved: a "completed" writer
/// has been seen to leave a 0-byte or track-less file behind when it was fed
/// nothing usable, and resolving the promise for that file is how the user
/// ends up with a "saved" chime for a clip that doesn't play. Returns nil
/// when the file is a real clip, otherwise the (pt-BR, user-facing) reason.
enum SaveVerification {
    static func failureReason(fileExists: Bool, fileSizeBytes: Int64, videoTrackCount: Int) -> String? {
        guard fileExists else { return "O arquivo do clipe não foi criado." }
        guard fileSizeBytes > 0 else { return "O arquivo do clipe ficou vazio." }
        guard videoTrackCount > 0 else { return "O clipe salvo não contém vídeo." }
        return nil
    }
}
