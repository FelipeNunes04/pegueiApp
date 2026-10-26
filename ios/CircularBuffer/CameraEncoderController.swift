import AVFoundation
import CoreMedia
import VideoToolbox
import UIKit

struct BufferConfig {
    let bufferSeconds: Int
    let width: Int
    let height: Int
    let fps: Int
}

/// The (width, height) pixel dimensions for each quality preset, mirrored
/// from VIDEO_QUALITY_PRESETS in shared/types/index.ts -- kept here (not
/// read from JS) since capability-checking happens entirely native-side,
/// before any BufferConfig is ever built.
let QUALITY_PRESET_SIZES: [(quality: String, width: Int, height: Int)] = [
    ("720p", 1280, 720),
    ("1080p", 1920, 1080),
    ("4k", 3840, 2160),
]

/// Mirrors VIDEO_FPS_OPTIONS in shared/types/index.ts.
let CANDIDATE_FPS_OPTIONS = [24, 30, 60]

struct CaptureCapabilities {
    let supportedQualities: [String]
    let fpsByQuality: [String: [Int]]
}

/// TEMPORARY diagnostics for the "Buffer vazio" investigation (2026-10-21):
/// appends timestamped lines to Documents/peguei-diagnostics.log so a
/// long on-device session can be pulled back with
/// `xcrun devicectl device copy from --domain-type appDataContainer`.
/// Remove once the root cause is confirmed.
enum PegueiDiag {
    private static let queue = DispatchQueue(label: "com.peguei.diag")
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let url: URL = FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("peguei-diagnostics.log")

    static func log(_ message: String) {
        let line = "\(formatter.string(from: Date())) \(message)\n"
        NSLog("[PegueiDiag] %@", message)
        queue.async {
            guard let data = line.data(using: .utf8) else { return }
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: url)
            }
        }
    }
}

protocol CameraEncoderControllerDelegate: AnyObject {
    func cameraEncoderController(_ controller: CameraEncoderController, didFailWithCode code: String, message: String)
    /// Fired only on transitions (see `BufferHealthTracker`), from
    /// sessionQueue. Becomes the `CircularBufferHealth` JS event.
    func cameraEncoderController(_ controller: CameraEncoderController, didChangeHealth state: BufferHealthState, reason: String?)
}

/// Thread-safe one-value box for handing a result out of an `@Sendable`
/// completion handler to a thread blocked on a semaphore (finalizeSave's
/// save verification).
private final class TrackCountBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func set(_ newValue: Int) {
        lock.lock(); value = newValue; lock.unlock()
    }

    func get() -> Int {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}

/// Owns the AVCaptureSession, a VTCompressionSession (H.264 hardware
/// encoder) and the `FrameRingBuffer` of encoded video frames, plus a mic
/// input feeding an `AudioSampleRingBuffer` of retained PCM audio sample
/// buffers muxed in as AAC at save time (see `finalizeSave`). See
/// DECISIONS.md "Audio".
///
/// There is only ever one active session app-wide, hence the singleton,
/// mirroring the Android CameraEncoderController.
final class CameraEncoderController: NSObject {
    static let shared = CameraEncoderController()

    weak var delegate: CameraEncoderControllerDelegate?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.peguei.session")
    private let videoDataOutput = AVCaptureVideoDataOutput()
    private let videoDataOutputQueue = DispatchQueue(label: "com.peguei.videodata")
    private let audioDataOutput = AVCaptureAudioDataOutput()
    private let audioDataOutputQueue = DispatchQueue(label: "com.peguei.audiodata")

    private var compressionSession: VTCompressionSession?
    private var formatDescription: CMFormatDescription?
    private var audioFormatDescription: CMFormatDescription?

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var ringBuffer: FrameRingBuffer?
    private var audioRingBuffer: AudioSampleRingBuffer?
    private var pendingConfig: BufferConfig?
    private var isRunning = false

    // The physical/virtual capture device currently feeding the session, set
    // once `openCameraAndStart()` successfully adds it as an input and
    // cleared on teardown. Zoom reads/writes `videoZoomFactor` directly on
    // this device via `lockForConfiguration()`, which only locks device
    // *configuration*, not the `AVCaptureSession` itself -- it doesn't call
    // `beginConfiguration()`/`commitConfiguration()` or touch inputs/outputs,
    // so it cannot restart or interrupt the running session/encoder. See
    // DECISIONS.md "Zoom" for why this matters.
    private var activeDevice: AVCaptureDevice?
    private let deviceLock = NSLock()

    // The fps actually applied to the current session (set alongside
    // activeFormat in openCameraAndStart), snapshotted into PendingSave at
    // startManualRecording time so finalizeSave stamps the clip's per-frame
    // duration metadata with the real capture rate instead of an assumed
    // constant.
    private var activeFps: Int = 30

    // MARK: Reliability state (2026-10-21, see
    // docs/plans/2026-10-21-reliability-battery-triggers.md)
    //
    // Guarded by stateLock (touched from the capture/encoder callback
    // threads as well as sessionQueue/main):

    /// Bumped every time `compressionSession` is replaced (start, rebuild,
    /// teardown). Each frame is submitted with the generation current at
    /// that moment (as its `sourceFrameRefcon`), and output from any older
    /// generation is discarded -- the one mechanism that guarantees frames
    /// from two different encoder sessions (two different SPS/PPS format
    /// descriptions) never end up in the same ring buffer or clip. Starts
    /// at 0 and the first session gets 1, so a real generation is never the
    /// nil pointer.
    private var encoderGeneration: UInt = 0
    private var encoderErrorPolicy = EncoderErrorPolicy()
    /// `ProcessInfo.systemUptime` of the newest frame the *current*
    /// encoder produced -- what the watchdog measures stalls against.
    private var lastEncodedFrameUptime: TimeInterval?
    /// Mirrors UIApplication's active state (set from main-thread
    /// notifications): the watchdog and the startRunning retries stand
    /// down while the app isn't active, since iOS suspends capture for
    /// inactive/background apps by design and tearing things down over
    /// that would only burn power and pre-roll.
    private var isAppActive = true
    /// Pocket mode: the preview layer's connection is disabled so nothing
    /// is composited, while capture/encode keep running untouched.
    private var previewSuppressed = false
    /// A manual recording that a rebuild/restart finalized early, waiting to
    /// be handed to JS by its `stopManualRecording` call.
    private var detachedSave: DetachedSave?

    // sessionQueue-confined (only ever read/written from blocks running on
    // sessionQueue, so no lock):

    private var watchdog = FrameFlowWatchdog()
    private var healthTracker = BufferHealthTracker()
    private var watchdogTimer: DispatchSourceTimer?
    private var isSessionInterrupted = false
    /// Set when a recovery action starts; cleared (-> `healthy`) by the
    /// first encoded frame that arrives after it.
    private var recoveringSince: TimeInterval?
    /// After an ordinary start, `healthy` is announced on the first encoded
    /// frame rather than optimistically at startRunning().
    private var awaitingInitialHealth = false
    /// Set by `restartPipeline` for the one `openCameraAndStartOnSessionQueue`
    /// call it makes, so that start keeps the watchdog's escalation stage.
    private var isRecoveryRestart = false
    /// startRunning() retry chain after a runtime error: a token so stale
    /// delayed attempts no-op once a newer chain / teardown has happened.
    private var sessionRetryToken: UInt = 0
    private var isSessionRetryInFlight = false
    /// A runtime error arrived while the app wasn't active: retry once it is.
    private var needsSessionRestartOnActive = false
    /// Thermal step-down: the user's configured fps for the running
    /// pipeline, the rate currently applied to the device, and the latest
    /// system-pressure level.
    private var configuredFps = 30
    private var appliedFps = 30
    /// The config the *running* pipeline was opened with. `pendingConfig`
    /// can be replaced by a later `configureAndArm` without a restart, so
    /// an encoder-only rebuild must size the new VTCompressionSession from
    /// this instead, to keep matching the capture format actually running.
    private var activeConfig: BufferConfig?
    private var thermalLevel: ThermalPressureLevel = .nominal
    private var reliabilityObservers: [NSObjectProtocol] = []

    private static var uptime: TimeInterval { ProcessInfo.processInfo.systemUptime }

    // TEMPORARY diagnostics, see PegueiDiag.
    private let diagLock = NSLock()
    private var diagCapturedFrames = 0
    private var diagEncodedFrames = 0
    private var diagEncodeErrors = 0
    private var diagLastEncodeError: OSStatus = noErr
    private var diagObservers: [NSObjectProtocol] = []
    private var diagPressureObservation: NSKeyValueObservation?
    private var diagTimer: DispatchSourceTimer?

    private override init() {
        super.init()
        installDiagnostics()
        installReliabilityMonitoring()
    }

    private func installDiagnostics() {
        PegueiDiag.log("diag installed, thermal=\(ProcessInfo.processInfo.thermalState.rawValue)")
        let center = NotificationCenter.default
        diagObservers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: nil) { note in
            let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
            PegueiDiag.log("session RUNTIME ERROR code=\(error?.code ?? 0) \(error?.localizedDescription ?? "nil")")
        })
        diagObservers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: nil) { note in
            let reason = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int ?? -1
            PegueiDiag.log("session INTERRUPTED reason=\(reason)")
        })
        diagObservers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: nil) { _ in
            PegueiDiag.log("session interruption ended")
        })
        diagObservers.append(center.addObserver(forName: .AVCaptureSessionDidStartRunning, object: session, queue: nil) { _ in
            PegueiDiag.log("session didStartRunning")
        })
        diagObservers.append(center.addObserver(forName: .AVCaptureSessionDidStopRunning, object: session, queue: nil) { _ in
            PegueiDiag.log("session didStopRunning")
        })
        diagObservers.append(center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { _ in
            PegueiDiag.log("thermalState -> \(ProcessInfo.processInfo.thermalState.rawValue)")
        })
        diagObservers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in
            PegueiDiag.log("app didEnterBackground")
        })
        diagObservers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { _ in
            PegueiDiag.log("app willEnterForeground")
        })
        diagObservers.append(center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { _ in
            PegueiDiag.log("MEMORY WARNING")
        })
        diagObservers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { note in
            let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 99
            PegueiDiag.log("audio session interruption type=\(type)")
        })
        diagObservers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { _ in
            PegueiDiag.log("MEDIA SERVICES WERE RESET")
        })

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.peguei.diag.heartbeat"))
        timer.schedule(deadline: .now() + 30, repeating: 30)
        timer.setEventHandler { [weak self] in self?.logHeartbeat() }
        timer.resume()
        diagTimer = timer
    }

    private func logHeartbeat() {
        diagLock.lock()
        let captured = diagCapturedFrames, encoded = diagEncodedFrames
        let errors = diagEncodeErrors, lastError = diagLastEncodeError
        diagLock.unlock()
        stateLock.lock()
        let running = isRunning
        let ringSize = ringBuffer?.size ?? -1
        let audioSize = audioRingBuffer?.size ?? -1
        let hasCompression = compressionSession != nil
        stateLock.unlock()
        PegueiDiag.log("heartbeat isRunning=\(running) session.isRunning=\(session.isRunning) interrupted=\(session.isInterrupted) captured=\(captured) encoded=\(encoded) encodeErrors=\(errors) lastErr=\(lastError) ring=\(ringSize) audioRing=\(audioSize) vt=\(hasCompression) thermal=\(ProcessInfo.processInfo.thermalState.rawValue) mem=\(Self.memoryFootprintMB())MB")
    }

    private static func memoryFootprintMB() -> Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? Int(info.phys_footprint / 1_048_576) : -1
    }

    private func observeSystemPressure(of device: AVCaptureDevice) {
        diagPressureObservation = device.observe(\.systemPressureState, options: [.initial, .new]) { [weak self] device, _ in
            let state = device.systemPressureState
            PegueiDiag.log("systemPressure level=\(state.level.rawValue) factors=\(state.factors.rawValue)")
            self?.systemPressureChanged(to: state.level, on: device)
        }
    }

    /// A manual recording in flight: `headFrames` is the pre-roll snapshot
    /// taken from the ring buffer the moment recording started; `tailFrames`
    /// keeps accumulating every frame the encoder produces for as long as
    /// recording continues, with no fixed target duration -- the user's own
    /// "stop" tap is what ends it (see `stopManualRecording`).
    private struct PendingSave {
        let headFrames: [EncodedFrame]
        var tailFrames: [EncodedFrame] = []
        let audioHeadFrames: [AudioSampleFrame]
        var audioTailFrames: [AudioSampleFrame] = []
        let outputURL: URL
        let fps: Int
    }

    private var pendingSave: PendingSave?
    private let stateLock = NSLock()

    private enum SaveOutcome {
        case saved(path: String, durationSeconds: Double)
        case failed(code: String, message: String)
    }

    private struct SaveWaiter {
        let onSaved: (String, Double) -> Void
        let onFailed: (String, String) -> Void
    }

    /// A manual recording cut short by `rebuildEncoder`/`restartPipeline`:
    /// it's finalized immediately with the frames it already has (all from
    /// one encoder generation) rather than continuing across the format
    /// change. JS still believes it's recording, so the result is parked
    /// here until its `stopManualRecording` arrives -- whichever of
    /// "finalize finished" / "JS asked" happens second delivers it.
    /// `outputURL` identifies it, so a late-finishing finalize can't fill
    /// the slot of a newer detached clip.
    private struct DetachedSave {
        let outputURL: URL
        var outcome: SaveOutcome?
        var waiter: SaveWaiter?
    }

    /// The truth, not the intent: `isRunning` is set to false whenever the
    /// pipeline is torn down -- including when the watchdog gives up after
    /// its recovery ladder failed (`giveUp`) and when a recovery restart
    /// fails to reopen the camera -- so `useCircularBuffer.ts`'s AppState
    /// handler, which only restarts on `false`, actually restarts a dead
    /// buffer. While a recovery is still in progress it stays `true`
    /// (the native side is actively bringing frames back; a JS restart
    /// would only race it).
    var isBuffering: Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return isRunning
    }

    /// Called by CircularBufferModule.startBuffering(). May run before the
    /// preview layer exists (the JS effect that calls this and the mounting
    /// of <CircularBufferPreview> race each other; whichever finishes last
    /// actually starts the pipeline). See DECISIONS.md.
    func configureAndArm(config: BufferConfig, delegate: CameraEncoderControllerDelegate) {
        stateLock.lock()
        pendingConfig = config
        self.delegate = delegate
        ringBuffer = FrameRingBuffer(windowUs: Int64(config.bufferSeconds) * 1_000_000)
        audioRingBuffer = AudioSampleRingBuffer(windowUs: Int64(config.bufferSeconds) * 1_000_000)
        stateLock.unlock()

        // The actual "should I start" decision is deferred onto sessionQueue
        // -- the same serial queue stopInternal()/openCameraAndStart() run
        // on -- instead of being decided synchronously here. Deciding here
        // against a stateLock snapshot would race a *pending, already
        // dispatched but not yet executed* stopInternal(): this method could
        // see stale previewLayer/isRunning values from before that stop
        // actually runs, wrongly conclude "no need to start", and then the
        // stop would finish afterward leaving the camera dead with nothing
        // left to trigger a restart. Routing the decision through the same
        // queue guarantees it only runs after any already-queued stop has
        // finished, matching the Android side (whose configureAndArm/stop
        // are both @Synchronized on the same lock, so they can't interleave
        // this way in the first place).
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let shouldStart = self.previewLayer != nil && !self.isRunning
            self.stateLock.unlock()
            if shouldStart {
                self.openCameraAndStart()
            }
        }
    }

    func attachPreviewLayer(_ layer: AVCaptureVideoPreviewLayer) {
        stateLock.lock()
        previewLayer = layer
        layer.session = session
        stateLock.unlock()

        // See the comment in configureAndArm() -- same reasoning applies here.
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let shouldStart = self.pendingConfig != nil && !self.isRunning
            self.stateLock.unlock()
            if shouldStart {
                self.openCameraAndStart()
            } else {
                // Already running (e.g. the view re-entered the window):
                // a re-attached layer still needs pocket mode's state.
                self.applyPreviewSuppression()
            }
        }
    }

    /// Called when the preview view leaves the window -- notably, this also
    /// happens when `react-native-screens` temporarily detaches an
    /// unfocused screen's native view (e.g. the user navigated from Camera
    /// to Settings/Gallery), NOT just on a real CameraScreen unmount. It
    /// must not fully tear down the buffer/encoder or wipe `pendingConfig`:
    /// doing so previously meant navigating away and back killed the buffer
    /// permanently, since `attachPreviewLayer`'s restart check requires
    /// `pendingConfig != nil`. Real, explicit teardown (which should wipe
    /// `pendingConfig`) only happens through the public `stop()` below,
    /// called from `CircularBufferModule.stopBuffering()` when the JS side
    /// actually stops buffering. Mirrors the Android side, where
    /// `detachPreviewSurface()` calls `stopInternal()` (no `pendingConfig`
    /// wipe) rather than the public `stop()`.
    func detachPreviewLayer() {
        stateLock.lock()
        previewLayer = nil
        stateLock.unlock()
        stopInternal(clearPendingConfig: false)
    }

    private func openCameraAndStart() {
        sessionQueue.async { [weak self] in
            self?.openCameraAndStartOnSessionQueue()
        }
    }

    /// The actual pipeline bring-up. Must run on `sessionQueue` -- split out
    /// of `openCameraAndStart()` so the recovery paths (`restartPipeline`),
    /// which already run on that queue, can tear down and reopen
    /// synchronously in one block instead of queueing two separate blocks
    /// that other work could interleave with.
    private func openCameraAndStartOnSessionQueue() {
        // Consumed up front so every early-return failure path below also
        // clears it -- a stale `true` would make the *next* ordinary start
        // skip resetting the watchdog/health state.
        let isRecoveryRestart = self.isRecoveryRestart
        self.isRecoveryRestart = false

        self.stateLock.lock()
        let pendingConfig = self.pendingConfig
        self.stateLock.unlock()
        guard let config = pendingConfig else { return }

        // ringBuffer/audioRingBuffer are only ever *created* in
        // configureAndArm(), which runs exactly once (CameraScreen's
        // initial mount). Every restart after that point (navigating
        // away detaches the preview -> stopInternal() nils both
        // buffers; navigating back reattaches -> this method) brings
        // the capture session back correctly but would leave the
        // buffers permanently nil forever after if nothing here
        // recreated them. Fresh buffers here (not reused stale ones)
        // also matters because they'd otherwise hold frames encoded
        // under the *previous* session's formatDescription/compression
        // session, which finalizeSave assumes is uniform across every
        // frame.
        self.stateLock.lock()
        if self.ringBuffer == nil {
            self.ringBuffer = FrameRingBuffer(windowUs: Int64(config.bufferSeconds) * 1_000_000)
        }
        if self.audioRingBuffer == nil {
            self.audioRingBuffer = AudioSampleRingBuffer(windowUs: Int64(config.bufferSeconds) * 1_000_000)
        }
        self.stateLock.unlock()

        let authStatus = AVCaptureDevice.authorizationStatus(for: .video)
        guard authStatus == .authorized else {
            self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.cameraPermission, message: "Permissão de câmera não concedida.")
            return
        }

        let audioAuthStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        guard audioAuthStatus == .authorized else {
            self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.microphonePermission, message: "Permissão de microfone não concedida.")
            return
        }

        // AVCaptureSession configures the shared audio session's category
        // internally once an audio input is attached, but explicitly
        // setting it first is more reliable across devices/OS versions.
        // Non-fatal if it fails -- the session can often still capture
        // audio; if not, the audio delegate callback simply never fires
        // and the clip degrades gracefully to video-only (see finalizeSave).
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
        try? AVAudioSession.sharedInstance().setActive(true)

        guard let device = Self.pickBackCameraDevice() else {
            self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Nenhuma câmera traseira disponível.")
            return
        }

        self.session.beginConfiguration()
        self.session.inputs.forEach { self.session.removeInput($0) }
        self.session.outputs.forEach { self.session.removeOutput($0) }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard self.session.canAddInput(input) else {
                self.session.commitConfiguration()
                self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.cameraBusy, message: "Não foi possível conectar à câmera. Verifique se outro app não está usando-a.")
                return
            }
            self.session.addInput(input)
            self.deviceLock.lock()
            self.activeDevice = device
            self.deviceLock.unlock()
            self.observeSystemPressure(of: device)
            PegueiDiag.log("openCameraAndStart device=\(device.deviceType.rawValue) \(config.width)x\(config.height)@\(config.fps) buffer=\(config.bufferSeconds)s")

            // Picking an explicit AVCaptureDevice.Format (rather than
            // leaving the session on a fixed preset) is what actually
            // makes the "4K/1080p/720p" quality setting take effect: a
            // hardcoded `sessionPreset = .high` previously meant every
            // quality setting captured frames at whatever resolution
            // `.high` happened to map to on the device, while only the
            // encoder's *declared* dimensions changed -- never a real
            // resolution change. `.inputPriority` tells the session to
            // respect the device's activeFormat instead of silently
            // overriding it.
            guard let format = Self.pickFormat(for: device, width: config.width, height: config.height, fps: config.fps) else {
                self.session.commitConfiguration()
                self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Resolução \(config.width)x\(config.height) não suportada por esta câmera.")
                return
            }
            try device.lockForConfiguration()
            device.activeFormat = format
            if let range = format.videoSupportedFrameRateRanges.first(where: { Double(config.fps) >= $0.minFrameRate && Double(config.fps) <= $0.maxFrameRate }) {
                let duration = CMTimeMake(value: 1, timescale: Int32(config.fps))
                device.activeVideoMinFrameDuration = duration
                device.activeVideoMaxFrameDuration = duration
            }
            // No supported range covering the requested fps at this
            // resolution shouldn't normally happen since pickFormat
            // already filters for this -- if it does, the device's
            // default frame duration for this format is left as-is,
            // but activeFps still records what was requested since
            // that's what finalizeSave stamps the clip's per-frame
            // duration metadata with.
            // Video HDR fuses/extends multiple exposures continuously
            // while the sensor is running -- a real, ongoing power draw
            // for an app whose whole point is to keep the camera open
            // for long stretches, not a one-off cost. Traded off
            // deliberately for battery life over slightly less dynamic
            // range in high-contrast scenes. Guarded by
            // isVideoHDRSupported since setting isVideoHDREnabled on an
            // unsupported format throws, and automaticallyAdjusts...
            // must be turned off first or setting isVideoHDREnabled
            // directly also throws.
            if format.isVideoHDRSupported {
                device.automaticallyAdjustsVideoHDREnabled = false
                device.isVideoHDREnabled = false
            }
            device.unlockForConfiguration()
            self.stateLock.lock()
            self.activeFps = config.fps
            self.stateLock.unlock()
            // Thermal step-down baseline: the KVO `.initial` callback that
            // `observeSystemPressure` queued above runs right after this
            // block and re-applies a reduced rate if the device is already
            // hot -- comparing against these two values.
            self.configuredFps = config.fps
            self.appliedFps = config.fps
            self.activeConfig = config
            self.session.sessionPreset = .inputPriority

            self.videoDataOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
            self.videoDataOutput.alwaysDiscardsLateVideoFrames = true
            self.videoDataOutput.setSampleBufferDelegate(self, queue: self.videoDataOutputQueue)
            guard self.session.canAddOutput(self.videoDataOutput) else {
                self.session.commitConfiguration()
                self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Não foi possível configurar a saída de vídeo.")
                return
            }
            self.session.addOutput(self.videoDataOutput)

            // Video stabilization off, explicitly (battery pass,
            // 2026-10-21): the default for a data-output connection is
            // `.off` on most formats today, but `.auto`/cinematic modes
            // have been the default on some device/format combinations,
            // and stabilization means the ISP crops + warps every frame
            // (plus extra buffering latency) continuously for as long as
            // the camera is open -- pure cost for a pre-roll buffer that
            // is mostly propped up or pocketed rather than handheld.
            if let videoConnection = self.videoDataOutput.connection(with: .video), videoConnection.isVideoStabilizationSupported {
                videoConnection.preferredVideoStabilizationMode = .off
            }

            // Audio is best-effort: if no mic is available or it can't be
            // attached, the video-only path above has already succeeded,
            // so we simply skip adding an audio track rather than failing
            // the whole buffering session over it.
            if let audioDevice = AVCaptureDevice.default(for: .audio) {
                if let audioInput = try? AVCaptureDeviceInput(device: audioDevice), self.session.canAddInput(audioInput) {
                    self.session.addInput(audioInput)
                    self.audioDataOutput.setSampleBufferDelegate(self, queue: self.audioDataOutputQueue)
                    if self.session.canAddOutput(self.audioDataOutput) {
                        self.session.addOutput(self.audioDataOutput)
                    }
                }
            }

            self.session.commitConfiguration()
        } catch {
            self.session.commitConfiguration()
            let nsError = error as NSError
            let busy = nsError.code == AVError.deviceIsNotAvailableInBackground.rawValue
            let code = busy ? CircularBufferErrorCode.cameraBusy : CircularBufferErrorCode.encoderInitFailed
            self.delegate?.cameraEncoderController(self, didFailWithCode: code, message: "Falha ao abrir a câmera: \(error.localizedDescription)")
            return
        }

        guard let compressionSession = self.makeCompressionSession(config: config) else {
            self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Falha ao iniciar o encoder H.264.")
            return
        }
        // New encoder generation: anything the previous VTCompressionSession
        // still emits from now on is dropped in handleEncodedSampleBuffer
        // instead of landing in the ring buffer under the wrong
        // formatDescription.
        self.stateLock.lock()
        self.encoderGeneration &+= 1
        self.compressionSession = compressionSession
        self.formatDescription = nil
        self.encoderErrorPolicy.reset()
        self.lastEncodedFrameUptime = nil
        self.stateLock.unlock()

        self.session.startRunning()
        self.stateLock.lock()
        self.isRunning = true
        self.stateLock.unlock()

        // Reliability bookkeeping (all sessionQueue-confined). An ordinary
        // start wipes the slate: fresh watchdog window, fresh health state,
        // and the first `healthy` is only announced once an encoded frame
        // actually exists (see watchdogTick) rather than optimistically
        // here. A recovery restart (`restartPipeline`) instead keeps the
        // watchdog's escalation stage -- so a restart that doesn't bring
        // frames back escalates further instead of starting the ladder over
        // forever -- and stays `recovering` until frames flow.
        let now = Self.uptime
        self.isSessionInterrupted = self.session.isInterrupted
        self.healthTracker.isInterrupted = self.isSessionInterrupted
        if isRecoveryRestart {
            self.watchdog.restartWindow(now: now)
        } else {
            self.watchdog.reset(now: now)
            self.healthTracker.reset()
            self.healthTracker.isInterrupted = self.isSessionInterrupted
            self.recoveringSince = nil
            self.awaitingInitialHealth = true
        }
        if self.isSessionInterrupted {
            self.publishHealth(reason: "interruptedAtStart")
        }
        PegueiDiag.log("pipeline started recoveryRestart=\(isRecoveryRestart) session.isRunning=\(self.session.isRunning) interrupted=\(self.isSessionInterrupted)")

        // Inputs/outputs were just removed and re-added, which gives the
        // preview layer a brand-new connection (enabled by default) -- pocket
        // mode's "preview off" has to be re-applied to it.
        self.applyPreviewSuppression()
    }

    /// The plain single-lens back **wide** camera, and only that (user
    /// decision 2026-10-21, battery/reliability pass). This used to prefer a
    /// virtual multi-lens device (`.builtInTripleCamera`, then
    /// `.builtInDualWideCamera`) so `videoZoomFactor` could sweep across
    /// physical lenses -- but:
    ///
    /// - the ultra-wide half of that never worked anyway: confirmed on a
    ///   physical triple-camera iPhone that `minAvailableVideoZoomFactor`
    ///   stays clamped to the wide lens for every format a plain
    ///   (non-multicam) `AVCaptureSession` offers, and forcing
    ///   `videoZoomFactor` below it crashes with `NSRangeException` (see
    ///   DECISIONS.md "Camera zoom (0.5x correction)");
    /// - a virtual device keeps the constituent-lens switching machinery
    ///   (and, depending on zoom/light, a second sensor) powered for as
    ///   long as the camera is open, which for an always-on pre-roll app is
    ///   the whole session -- measurable draw for a feature (optical
    ///   telephoto at 2x/3x+) the user decided wasn't worth it. Zoom above
    ///   1x is digital (sensor crop) on the wide lens now.
    ///
    /// `AVCaptureDevice.default(_:for:position:)` returns nil (not a crash)
    /// when there's no such camera (e.g. a Simulator), which callers already
    /// handle.
    private static func pickBackCameraDevice() -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }

    /// Finds a device format whose pixel dimensions match the requested
    /// width/height exactly and whose supported frame-rate range covers the
    /// requested fps. Falls back to the resolution match with the highest
    /// available max frame rate if none exactly covers the requested fps
    /// (e.g. 60fps requested at a resolution this device only encodes up to
    /// 30fps) -- returning nil only when the resolution itself isn't
    /// offered at all by this device.
    ///
    /// This exact selection algorithm (candidates -> exact-fps match ->
    /// widest-max-fps fallback) is mirrored by FormatSelectionTests.swift
    /// against plain synthetic data, the same way SaveClipDurationTests.swift
    /// mirrors finalizeSave()'s duration math -- AVCaptureDevice.Format and
    /// AVFrameRateRange have no public initializers and CameraEncoderController.swift
    /// isn't part of the PegueiTests target (it pulls in AVFoundation/
    /// VideoToolbox device APIs that need real hardware), so this can't be
    /// exercised directly from a plain XCTest logic test.
    private static func pickFormat(for device: AVCaptureDevice, width: Int, height: Int, fps: Int) -> AVCaptureDevice.Format? {
        let candidates = device.formats.filter { format in
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return Int(dims.width) == width && Int(dims.height) == height
        }
        guard !candidates.isEmpty else { return nil }

        let requestedFps = Double(fps)
        if let exact = candidates.first(where: { format in
            format.videoSupportedFrameRateRanges.contains { requestedFps >= $0.minFrameRate && requestedFps <= $0.maxFrameRate }
        }) {
            return exact
        }
        return candidates.max { a, b in
            (a.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0) < (b.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0)
        }
    }

    /// Reports which quality presets this device's back camera actually
    /// offers, and which of CANDIDATE_FPS_OPTIONS each of those qualities
    /// can run at -- SettingsScreen uses this to disable/hide options the
    /// hardware can't deliver instead of letting the user pick "4K" or
    /// "60fps" on a device that silently falls back to something else (or,
    /// pre-fix, ignored the setting outright). Returns every quality
    /// unsupported (empty arrays) if there's no back camera at all (e.g. a
    /// Simulator) rather than throwing -- the JS side treats an empty
    /// capabilities response as "couldn't determine, don't restrict
    /// anything" (see cameraStore.ts).
    func captureCapabilities() -> CaptureCapabilities {
        guard let device = Self.pickBackCameraDevice() else {
            return CaptureCapabilities(supportedQualities: [], fpsByQuality: [:])
        }

        var supportedQualities: [String] = []
        var fpsByQuality: [String: [Int]] = [:]
        for preset in QUALITY_PRESET_SIZES {
            let matches = device.formats.filter { format in
                let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
                return Int(dims.width) == preset.width && Int(dims.height) == preset.height
            }
            guard !matches.isEmpty else { continue }
            supportedQualities.append(preset.quality)
            fpsByQuality[preset.quality] = CANDIDATE_FPS_OPTIONS.filter { candidate in
                let requested = Double(candidate)
                return matches.contains { format in
                    format.videoSupportedFrameRateRanges.contains { requested >= $0.minFrameRate && requested <= $0.maxFrameRate }
                }
            }
        }
        return CaptureCapabilities(supportedQualities: supportedQualities, fpsByQuality: fpsByQuality)
    }

    /// AVFoundation's `videoZoomFactor` is an internal, **device-relative**
    /// unit, not the user-facing "x" number the stock Camera app shows --
    /// on a *virtual* multi-lens device, `1.0` is the device's own minimum,
    /// which on a triple/dual-wide camera is the ultra-wide lens, and the
    /// wide lens (the real "1x" reference) is
    /// `virtualDeviceSwitchOverVideoZoomFactors.first` (confirmed against an
    /// Apple DTS engineer's example on the developer forums -- iPhone 14
    /// Pro: switch-overs `[2, 6]`, so `2.0` = wide/"1x"; see DECISIONS.md
    /// "Camera zoom").
    ///
    /// Since `pickBackCameraDevice()` now only ever returns the plain
    /// `.builtInWideAngleCamera` (2026-10-21), the switch-over array is
    /// always empty in practice and this takes the fallback branch:
    /// `minAvailableVideoZoomFactor` (1.0 on the wide lens) *is* the wide
    /// lens, so display and internal units coincide and there's no
    /// ultra-wide below it. The virtual-device branch is kept anyway so
    /// re-enabling a multi-lens device later can't silently reintroduce the
    /// "1x is actually 0.5x" unit bug this function exists to prevent.
    private static func wideLensReferenceZoom(for device: AVCaptureDevice) -> CGFloat {
        if let wideLensFactor = device.virtualDeviceSwitchOverVideoZoomFactors.first {
            return CGFloat(wideLensFactor.doubleValue)
        }
        return device.minAvailableVideoZoomFactor
    }

    /// Live zoom, safe to call at any point while buffering/recording:
    /// `lockForConfiguration()` only guards device-level properties, it does
    /// not touch the session's inputs/outputs or call
    /// `beginConfiguration()`/`commitConfiguration()`, so it cannot restart
    /// the capture session or interrupt an in-flight manual recording.
    /// `factor` and the returned applied value are both **display** units
    /// (1.0 = wide lens; with the wide-only device everything above that is
    /// digital zoom) -- see `wideLensReferenceZoom`.
    func setZoom(factor: Double, onSet: @escaping (Double) -> Void, onFailed: @escaping (String, String) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.deviceLock.lock()
            let device = self.activeDevice
            self.deviceLock.unlock()
            guard let device else {
                onFailed(CircularBufferErrorCode.notBuffering, "O buffer não está ativo.")
                return
            }
            let referenceZoom = Self.wideLensReferenceZoom(for: device)
            let requestedInternal = CGFloat(factor) * referenceZoom
            let clampedInternal = min(max(requestedInternal, device.minAvailableVideoZoomFactor), device.maxAvailableVideoZoomFactor)
            do {
                try device.lockForConfiguration()
                device.videoZoomFactor = clampedInternal
                device.unlockForConfiguration()
                onSet(Double(clampedInternal / referenceZoom))
            } catch {
                onFailed(CircularBufferErrorCode.saveFailed, "Falha ao ajustar o zoom: \(error.localizedDescription)")
            }
        }
    }

    /// Returns min/max zoom in **display** units (see `wideLensReferenceZoom`
    /// above) and whether the device has a real ultra-wide lens below the
    /// wide-lens reference point -- not whether `minAvailableVideoZoomFactor`
    /// is below some hardcoded threshold, which is what made 0.5x invisible
    /// on every triple/dual-wide-camera device (their internal minimum is
    /// always exactly `1.0`, by definition of it being *a* minimum, whether
    /// or not that minimum happens to be the ultra-wide lens). With the
    /// wide-only back camera (2026-10-21) `hasUltraWide` is always `false`
    /// and `minZoom` is `1.0`; JS already hides the 0.5x pill in that case.
    func zoomInfo(onResult: @escaping (Double, Double, Bool) -> Void, onFailed: @escaping (String, String) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.deviceLock.lock()
            let device = self.activeDevice
            self.deviceLock.unlock()
            guard let device else {
                onFailed(CircularBufferErrorCode.notBuffering, "O buffer não está ativo.")
                return
            }
            let referenceZoom = Self.wideLensReferenceZoom(for: device)
            let minZoomDisplay = Double(device.minAvailableVideoZoomFactor / referenceZoom)
            let maxZoomDisplay = Double(device.maxAvailableVideoZoomFactor / referenceZoom)
            let hasUltraWide = device.minAvailableVideoZoomFactor < referenceZoom - 0.01
            onResult(minZoomDisplay, maxZoomDisplay, hasUltraWide)
        }
    }

    /// Creates (but does not install) a configured H.264 session -- callers
    /// install it into `compressionSession` under `stateLock` together with
    /// an `encoderGeneration` bump, so the swap is atomic with respect to
    /// the capture/encode threads (see `rebuildEncoder`).
    private func makeCompressionSession(config: BufferConfig) -> VTCompressionSession? {
        var session: VTCompressionSession?
        let refcon = Unmanaged.passUnretained(self).toOpaque()

        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(config.width),
            height: Int32(config.height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: compressionOutputCallback,
            refcon: refcon,
            compressionSessionOut: &session
        )

        guard status == noErr, let compressionSession = session else {
            PegueiDiag.log("VTCompressionSessionCreate failed status=\(status)")
            return nil
        }

        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Main_AutoLevel)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 1.0 as CFNumber)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: config.fps as CFNumber)
        let bitRate = estimateBitRate(config: config)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_AverageBitRate, value: bitRate as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(compressionSession)
        return compressionSession
    }

    private func estimateBitRate(config: BufferConfig) -> Int {
        // ~0.12 bits per pixel per frame, same heuristic as the Android encoder.
        return max(1_000_000, Int(Double(config.width * config.height * config.fps) * 0.12))
    }

    /// C-compatible VTCompressionSession output callback. Must be a free
    /// function (no captures) -- state travels through `outputCallbackRefCon`
    /// (the controller) and `sourceFrameRefCon` (the `encoderGeneration` the
    /// frame was submitted under, see `captureOutput`).
    private let compressionOutputCallback: VTCompressionOutputCallback = { refcon, sourceFrameRefcon, status, infoFlags, sampleBuffer in
        guard let refcon else { return }
        let controller = Unmanaged<CameraEncoderController>.fromOpaque(refcon).takeUnretainedValue()
        let generation = UInt(bitPattern: sourceFrameRefcon)
        guard status == noErr, let sampleBuffer else {
            controller.recordEncodeError(status, stage: "callback")
            // status == noErr with no sample buffer is a frame the encoder
            // chose to drop (kVTEncodeInfo_FrameDropped under real-time
            // pressure) -- normal, not a fault, so it doesn't count toward
            // the recreate policy.
            if status != noErr {
                controller.noteEncoderError(status, generation: generation)
            } else if !infoFlags.contains(.frameDropped) {
                PegueiDiag.log("encoder callback with noErr and no sample buffer, flags=\(infoFlags.rawValue)")
            }
            return
        }
        controller.diagLock.lock()
        controller.diagEncodedFrames += 1
        controller.diagLock.unlock()
        controller.handleEncodedSampleBuffer(sampleBuffer, generation: generation)
    }

    private func recordEncodeError(_ status: OSStatus, stage: String) {
        diagLock.lock()
        diagEncodeErrors += 1
        let isNewError = status != diagLastEncodeError
        diagLastEncodeError = status
        diagLock.unlock()
        if isNewError {
            PegueiDiag.log("ENCODE ERROR stage=\(stage) status=\(status)")
        }
    }

    /// Feeds an encode failure (from `VTCompressionSessionEncodeFrame` or
    /// the output callback) into `EncoderErrorPolicy`, and schedules an
    /// encoder rebuild when the policy says so. Errors from a session that's
    /// already been replaced (stale `generation`) are ignored: invalidating
    /// the old session routinely makes its in-flight frames fail with
    /// -12903, which must not trigger a second rebuild of the *new* one.
    private func noteEncoderError(_ status: OSStatus, generation: UInt) {
        stateLock.lock()
        let shouldRebuild = isRunning && generation == encoderGeneration && encoderErrorPolicy.recordError(status: status)
        stateLock.unlock()
        guard shouldRebuild else { return }
        PegueiDiag.log("encoder error policy -> rebuild (status=\(status) generation=\(generation))")
        sessionQueue.async { [weak self] in
            self?.rebuildEncoder(reason: "encodeError \(status)", expectedGeneration: generation)
        }
    }

    private func handleEncodedSampleBuffer(_ sampleBuffer: CMSampleBuffer, generation: UInt) {
        guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer) == noErr,
              let dataPointer else { return }

        let data = Data(bytes: dataPointer, count: length)
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ptsUs = Int64(pts.seconds * 1_000_000)

        var isKeyFrame = true
        if let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
           let notSync = attachmentsArray.first?[kCMSampleAttachmentKey_NotSync] as? Bool {
            isKeyFrame = !notSync
        }

        let frame = EncodedFrame(data: data, presentationTimeUs: ptsUs, isKeyFrame: isKeyFrame)

        // Everything that ties this frame to "the current encoder" happens in
        // one stateLock critical section -- the generation check, capturing
        // the format description, the ring-buffer append and the pending
        // recording's tail append -- because `rebuildEncoder` swaps all of
        // those in one critical section too. Done piecemeal (as before), a
        // frame from the old session could land in the ring buffer *after*
        // the rebuild cleared it, and finalizeSave would then mux it under
        // the new session's SPS/PPS: a corrupt clip, i.e. exactly the
        // "never mix formats" rule the rebuild exists to uphold. No auto-stop
        // target here -- a manual recording only ends when
        // stopManualRecording() is called explicitly.
        stateLock.lock()
        guard generation == encoderGeneration else {
            stateLock.unlock()
            return
        }
        if formatDescription == nil {
            formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer)
        }
        encoderErrorPolicy.recordSuccess()
        lastEncodedFrameUptime = Self.uptime
        ringBuffer?.add(frame)
        if pendingSave != nil {
            pendingSave!.tailFrames.append(frame)
        }
        stateLock.unlock()
    }

    private func handleAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        // Copy the PCM bytes out and let sampleBuffer (and its pooled
        // backing buffer) be released the moment this function returns --
        // see AudioSampleFrame's doc comment for why retaining the original
        // buffer instead silently starves AVCaptureAudioDataOutput's pool.
        guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer) == noErr,
              let dataPointer else { return }

        let data = Data(bytes: dataPointer, count: length)
        let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ptsUs = Int64(pts.seconds * 1_000_000)
        let frame = AudioSampleFrame(data: data, presentationTimeUs: ptsUs, numSamples: numSamples)
        // Same single critical section as the video path: the format
        // description, ring buffer and pending recording are swapped/
        // snapshotted together under stateLock by stop/rebuild/teardown.
        stateLock.lock()
        if audioFormatDescription == nil {
            audioFormatDescription = CMSampleBufferGetFormatDescription(sampleBuffer)
        }
        audioRingBuffer?.add(frame)
        if pendingSave != nil {
            pendingSave!.audioTailFrames.append(frame)
        }
        stateLock.unlock()
    }

    /// Starts a manual recording: snapshots the current pre-roll buffer
    /// (governed by the configured `bufferSeconds`) as the clip's head, then
    /// keeps accumulating every new frame as the tail until the user taps
    /// stop (`stopManualRecording`) -- the manually-recorded portion's
    /// length is however long the user keeps recording, not a fixed
    /// post-roll.
    func startManualRecording(moviesDir: URL, onStarted: @escaping () -> Void, onFailed: @escaping (String, String) -> Void) {
        stateLock.lock()
        guard isRunning, let buffer = ringBuffer else {
            stateLock.unlock()
            onFailed(CircularBufferErrorCode.notBuffering, "O buffer não está ativo.")
            return
        }
        guard pendingSave == nil else {
            stateLock.unlock()
            onFailed(CircularBufferErrorCode.saveFailed, "Já existe uma gravação em andamento.")
            return
        }
        // A clip that an encoder rebuild already finalized early but that JS
        // never collected (it only ever collects it via
        // stopManualRecording) is dropped here: JS starting a fresh
        // recording means it no longer considers that one in flight. Its
        // file -- if the early save succeeded -- is already in the gallery.
        if let detached = detachedSave, detached.waiter == nil {
            PegueiDiag.log("startManualRecording dropping uncollected detached save \(detached.outputURL.lastPathComponent)")
            detachedSave = nil
        }
        stateLock.unlock()

        do {
            if !FileManager.default.fileExists(atPath: moviesDir.path) {
                try FileManager.default.createDirectory(at: moviesDir, withIntermediateDirectories: true)
            }
            let values = try moviesDir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            if let available = values.volumeAvailableCapacityForImportantUsage, available < 50 * 1024 * 1024 {
                onFailed(CircularBufferErrorCode.storageFull, "Armazenamento insuficiente para gravar o clipe.")
                return
            }
        } catch {
            onFailed(CircularBufferErrorCode.saveFailed, "Falha ao preparar diretório de saída: \(error.localizedDescription)")
            return
        }

        let outputURL = moviesDir.appendingPathComponent("clip_\(Int(Date().timeIntervalSince1970 * 1000)).mp4")

        // The head snapshot and installing `pendingSave` happen in the same
        // critical section (they used to be two): an encoder rebuild landing
        // between them would clear the ring buffer and bump the format, and
        // this clip would then pair a head from the old encoder with a tail
        // from the new one -- an undecodable mix. Snapshotting is a cheap
        // array copy, fine to do under the lock.
        stateLock.lock()
        guard isRunning, pendingSave == nil, ringBuffer === buffer else {
            stateLock.unlock()
            onFailed(CircularBufferErrorCode.notBuffering, "O buffer não está ativo.")
            return
        }
        let head = buffer.snapshotFromOldestKeyframe()
        let audioHead = audioRingBuffer?.snapshot() ?? []
        pendingSave = PendingSave(headFrames: head, audioHeadFrames: audioHead, outputURL: outputURL, fps: activeFps)
        stateLock.unlock()
        PegueiDiag.log("startManualRecording head=\(head.count) audioHead=\(audioHead.count) session.isRunning=\(session.isRunning)")
        onStarted()
    }

    func stopManualRecording(onSaved: @escaping (String, Double) -> Void, onFailed: @escaping (String, String) -> Void) {
        stateLock.lock()
        guard let save = pendingSave else {
            // The recording JS thinks is in flight may have been cut short
            // and finalized early by an encoder rebuild / pipeline restart
            // (see `takePendingSaveForEarlyFinalizationLocked`): hand back
            // that clip's result now, or once its finalize completes.
            if var detached = detachedSave {
                if let outcome = detached.outcome {
                    detachedSave = nil
                    stateLock.unlock()
                    PegueiDiag.log("stopManualRecording delivering detached save \(detached.outputURL.lastPathComponent)")
                    Self.deliver(outcome, onSaved: onSaved, onFailed: onFailed)
                } else {
                    detached.waiter = SaveWaiter(onSaved: onSaved, onFailed: onFailed)
                    detachedSave = detached
                    stateLock.unlock()
                    PegueiDiag.log("stopManualRecording waiting on detached save \(detached.outputURL.lastPathComponent)")
                }
                return
            }
            stateLock.unlock()
            onFailed(CircularBufferErrorCode.saveFailed, "Nenhuma gravação em andamento.")
            return
        }
        pendingSave = nil
        // Snapshotted here, in the same critical section that ends the
        // recording, instead of finalizeSave reading `self.formatDescription`
        // later on a background queue: by then an encoder rebuild may
        // already have reset it to the *next* session's format.
        let videoFormat = formatDescription
        let audioFormat = audioFormatDescription
        stateLock.unlock()
        PegueiDiag.log("stopManualRecording head=\(save.headFrames.count) tail=\(save.tailFrames.count) audio=\(save.audioHeadFrames.count)+\(save.audioTailFrames.count)")
        // This clip's frames are already captured into `save` (headFrames/
        // tailFrames), decoupled from the ring buffers -- so clearing them
        // here is safe and necessary: otherwise footage already saved in
        // this clip's tail keeps sitting in the ring buffer and resurfaces
        // as pre-roll ("head") for whatever manual recording starts next,
        // duplicating content across consecutive clips.
        ringBuffer?.clear()
        audioRingBuffer?.clear()
        finalizeSave(save, videoFormat: videoFormat, audioFormat: audioFormat, onSaved: onSaved, onFailed: onFailed)
    }

    private static func deliver(_ outcome: SaveOutcome, onSaved: (String, Double) -> Void, onFailed: (String, String) -> Void) {
        switch outcome {
        case let .saved(path, duration):
            onSaved(path, duration)
        case let .failed(code, message):
            onFailed(code, message)
        }
    }

    private func finalizeSave(
        _ save: PendingSave,
        videoFormat: CMFormatDescription?,
        audioFormat: CMFormatDescription?,
        onSaved: @escaping (String, Double) -> Void,
        onFailed: @escaping (String, String) -> Void
    ) {
        DispatchQueue.global(qos: .utility).async {
            guard let formatDescription = videoFormat else {
                PegueiDiag.log("finalizeSave: no video format description (head=\(save.headFrames.count) tail=\(save.tailFrames.count))")
                onFailed(CircularBufferErrorCode.saveFailed, "Formato do encoder ainda não disponível.")
                return
            }
            let audioFormatDescription = audioFormat

            let videoFrames = save.headFrames + save.tailFrames
            guard let startUs = videoFrames.first?.presentationTimeUs else {
                onFailed(CircularBufferErrorCode.saveFailed, "Buffer vazio, nada para salvar.")
                return
            }
            // Audio capture starts independently of video (same
            // AVCaptureSession, but no guarantee which output's first
            // sample lands first) -- frames older than the video's own
            // start would rebase to a negative CMTime, which
            // CMSampleBufferCreateReady rejects. Dropping them is a few
            // milliseconds of lost pre-roll audio at most.
            let audioFrames = (save.audioHeadFrames + save.audioTailFrames).filter { $0.presentationTimeUs >= startUs }

            do {
                try? FileManager.default.removeItem(at: save.outputURL)
                let writer = try AVAssetWriter(outputURL: save.outputURL, fileType: .mp4)
                let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: formatDescription)
                videoInput.expectsMediaDataInRealTime = false
                // Sample buffers arrive in the back camera's native sensor
                // orientation (landscape) since the app never sets a
                // videoOrientation on the capture connection -- tag the
                // track as portrait here so players display it upright
                // instead of rotated 90°, matching the portrait-locked UI.
                videoInput.transform = CGAffineTransform(rotationAngle: .pi / 2)
                guard writer.canAdd(videoInput) else {
                    onFailed(CircularBufferErrorCode.saveFailed, "Não foi possível configurar o gravador de vídeo.")
                    return
                }
                writer.add(videoInput)

                // Audio is added only if a track actually got captured this
                // session -- if the mic never produced a sample (e.g. a
                // transient AVAudioSession/device failure), the clip still
                // saves successfully as video-only rather than failing the
                // whole save. outputSettings: nil -- like the video input,
                // this is pure passthrough of already-captured samples
                // (raw LPCM), not live transcoding: AVAssetWriterInput's
                // built-in PCM->AAC transcode-on-append silently stopped
                // encoding partway through a batch append of pre-recorded
                // samples in an earlier version of this code.
                var audioInput: AVAssetWriterInput?
                if let audioFormatDescription, !audioFrames.isEmpty {
                    let candidateAudioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: audioFormatDescription)
                    candidateAudioInput.expectsMediaDataInRealTime = false
                    if writer.canAdd(candidateAudioInput) {
                        writer.add(candidateAudioInput)
                        audioInput = candidateAudioInput
                    }
                }

                writer.startWriting()
                writer.startSession(atSourceTime: .zero)

                // Two AVAssetWriterInputs must each be pumped from their
                // own serial queue via requestMediaDataWhenReady, not fed
                // from a single thread manually polling
                // isReadyForMoreMediaData in turn: confirmed on-device that
                // the manual-polling approach made the video input's
                // isReadyForMoreMediaData get stuck (never becoming ready
                // again, writer.status staying .writing, writer.error nil)
                // a fixed ~150 items in regardless of total frame count or
                // how long the poll was allowed to wait (tested up to
                // 15s/frame) -- a hard block, not disk-speed backpressure,
                // consistent with AVAssetWriter expecting each track to be
                // serviced independently and concurrently the way
                // requestMediaDataWhenReady is documented to require for
                // multi-track writes.
                let group = DispatchGroup()
                var videoFailed = false
                var audioFailed = false

                group.enter()
                var videoIndex = 0
                videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "com.peguei.mux.video")) {
                    while videoInput.isReadyForMoreMediaData {
                        guard writer.status == .writing else {
                            videoFailed = true
                            videoInput.markAsFinished()
                            group.leave()
                            return
                        }
                        guard videoIndex < videoFrames.count else {
                            videoInput.markAsFinished()
                            group.leave()
                            return
                        }
                        let frame = videoFrames[videoIndex]
                        videoIndex += 1
                        guard let sampleBuffer = Self.makeSampleBuffer(frame: frame, formatDescription: formatDescription, startUs: startUs, fps: save.fps) else {
                            continue
                        }
                        if !videoInput.append(sampleBuffer) {
                            videoFailed = true
                            videoInput.markAsFinished()
                            group.leave()
                            return
                        }
                    }
                }

                if let audioInput, let audioFormatDescription {
                    group.enter()
                    var audioIndex = 0
                    audioInput.requestMediaDataWhenReady(on: DispatchQueue(label: "com.peguei.mux.audio")) {
                        while audioInput.isReadyForMoreMediaData {
                            guard writer.status == .writing else {
                                audioFailed = true
                                audioInput.markAsFinished()
                                group.leave()
                                return
                            }
                            guard audioIndex < audioFrames.count else {
                                audioInput.markAsFinished()
                                group.leave()
                                return
                            }
                            let frame = audioFrames[audioIndex]
                            audioIndex += 1
                            guard let sampleBuffer = Self.makeAudioSampleBuffer(frame: frame, formatDescription: audioFormatDescription, startUs: startUs) else {
                                continue
                            }
                            if !audioInput.append(sampleBuffer) {
                                audioFailed = true
                                audioInput.markAsFinished()
                                group.leave()
                                return
                            }
                        }
                    }
                }

                // Bounding this wait (rather than group.wait() with no
                // timeout) means a track that somehow never finishes still
                // surfaces as onFailed() instead of hanging the save --
                // and by extension the JS promise -- forever.
                let groupFinished = group.wait(timeout: .now() + 30) == .success

                guard groupFinished, !videoFailed, !audioFailed, writer.status == .writing else {
                    onFailed(CircularBufferErrorCode.saveFailed, writer.error?.localizedDescription ?? "O gravador de vídeo parou de responder.")
                    return
                }

                let durationSeconds = Double(videoFrames.last!.presentationTimeUs - startUs) / 1_000_000.0

                // finishWriting's completion handler is not guaranteed to
                // fire if the writer stalls internally -- bounding the
                // wait means a stuck save surfaces as a normal onFailed()
                // instead of hanging indefinitely (the JS promise never
                // settling, which reads as "the buffer stopped working").
                let semaphore = DispatchSemaphore(value: 0)
                writer.finishWriting {
                    semaphore.signal()
                }
                let finished = semaphore.wait(timeout: .now() + 10) == .success

                if finished, writer.status == .completed {
                    // `.completed` alone isn't proof of a playable clip --
                    // see SaveVerification. Only a verified file resolves
                    // the promise (and so triggers the "saved" chime in JS).
                    if let failure = Self.verifySavedClip(at: save.outputURL) {
                        PegueiDiag.log("finalizeSave verification FAILED: \(failure)")
                        try? FileManager.default.removeItem(at: save.outputURL)
                        onFailed(CircularBufferErrorCode.saveFailed, failure)
                    } else {
                        onSaved(save.outputURL.path, durationSeconds)
                    }
                } else {
                    onFailed(CircularBufferErrorCode.saveFailed, writer.error?.localizedDescription ?? "Falha desconhecida ao finalizar o vídeo.")
                }
            } catch {
                onFailed(CircularBufferErrorCode.saveFailed, "Falha ao gerar o arquivo de vídeo: \(error.localizedDescription)")
            }
        }
    }

    /// Gathers the facts `SaveVerification` judges (file exists, non-zero
    /// size, at least one video track) for a just-written clip. Runs on
    /// finalizeSave's background queue, so blocking on the async track load
    /// is fine; bounded like the other waits in finalizeSave so a stuck load
    /// surfaces as a failure instead of a promise that never settles.
    /// `loadTracks(withMediaType:completionHandler:)` rather than the
    /// synchronous `tracks(withMediaType:)`, which is deprecated since iOS 16
    /// (this project's deployment target).
    private static func verifySavedClip(at url: URL) -> String? {
        let fileManager = FileManager.default
        let exists = fileManager.fileExists(atPath: url.path)
        let size = (try? fileManager.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0

        var videoTrackCount = 0
        if exists, size > 0 {
            let semaphore = DispatchSemaphore(value: 0)
            let result = TrackCountBox()
            AVURLAsset(url: url).loadTracks(withMediaType: .video) { tracks, _ in
                result.set(tracks?.count ?? 0)
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 5)
            videoTrackCount = result.get()
        }
        return SaveVerification.failureReason(fileExists: exists, fileSizeBytes: size, videoTrackCount: videoTrackCount)
    }

    /// Rebuilds a playable PCM `CMSampleBuffer` from bytes copied out at
    /// capture time (see `AudioSampleFrame`), rebased onto the same
    /// zero-based timeline `makeSampleBuffer` uses for video (both derive
    /// from the same `AVCaptureSession` clock, so subtracting the clip's
    /// shared `startUs` keeps them in sync). `numSamples` with a single
    /// timing/size entry is exactly how CoreMedia expects a constant-format
    /// PCM buffer's samples to be described -- the same shape
    /// `AVCaptureAudioDataOutput` used when it originally produced this data.
    private static func makeAudioSampleBuffer(frame: AudioSampleFrame, formatDescription: CMFormatDescription, startUs: Int64) -> CMSampleBuffer? {
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee, asbd.mBytesPerFrame > 0 else {
            return nil
        }

        var blockBuffer: CMBlockBuffer?
        let blockStatus = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: frame.data.count,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: frame.data.count,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard blockStatus == kCMBlockBufferNoErr, let bb = blockBuffer else { return nil }

        let replaceStatus = frame.data.withUnsafeBytes { raw -> OSStatus in
            guard let base = raw.baseAddress else { return kCMBlockBufferBadCustomBlockSourceErr }
            return CMBlockBufferReplaceDataBytes(with: base, blockBuffer: bb, offsetIntoDestination: 0, dataLength: frame.data.count)
        }
        guard replaceStatus == kCMBlockBufferNoErr else { return nil }

        var timingInfo = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: CMTimeScale(asbd.mSampleRate)),
            presentationTimeStamp: CMTime(value: frame.presentationTimeUs - startUs, timescale: 1_000_000),
            decodeTimeStamp: .invalid
        )
        var sampleSize = Int(asbd.mBytesPerFrame)
        var sampleBuffer: CMSampleBuffer?
        let sampleStatus = CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: bb,
            formatDescription: formatDescription,
            sampleCount: frame.numSamples,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &sampleSize,
            sampleBufferOut: &sampleBuffer
        )
        guard sampleStatus == noErr, let sb = sampleBuffer else { return nil }
        return sb
    }

    private static func makeSampleBuffer(frame: EncodedFrame, formatDescription: CMFormatDescription, startUs: Int64, fps: Int) -> CMSampleBuffer? {
        var blockBuffer: CMBlockBuffer?
        let blockStatus = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: frame.data.count,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: frame.data.count,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard blockStatus == kCMBlockBufferNoErr, let bb = blockBuffer else { return nil }

        let replaceStatus = frame.data.withUnsafeBytes { raw -> OSStatus in
            guard let base = raw.baseAddress else { return kCMBlockBufferBadCustomBlockSourceErr }
            return CMBlockBufferReplaceDataBytes(with: base, blockBuffer: bb, offsetIntoDestination: 0, dataLength: frame.data.count)
        }
        guard replaceStatus == kCMBlockBufferNoErr else { return nil }

        var timingInfo = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: CMTimeScale(fps)),
            presentationTimeStamp: CMTime(value: frame.presentationTimeUs - startUs, timescale: 1_000_000),
            decodeTimeStamp: .invalid
        )
        var sampleSize = frame.data.count
        var sampleBuffer: CMSampleBuffer?
        let sampleStatus = CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: bb,
            formatDescription: formatDescription,
            sampleCount: 1,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &sampleSize,
            sampleBufferOut: &sampleBuffer
        )
        guard sampleStatus == noErr, let sb = sampleBuffer else { return nil }

        // The previous version of this code used
        // `CFArrayGetValueAtIndex(attachmentsArray, 0)` unconditionally,
        // which is undefined behavior (crashes) if the array is empty --
        // `createIfNecessary: true` is *documented* to always populate one
        // attachments dict per sample, but that's an assumption about
        // CoreMedia's internal behavior, not something the type system
        // guarantees. Bridging to NSArray and using `.firstObject` (which
        // safely returns nil on an empty array) avoids that crash risk
        // entirely -- this runs on every non-keyframe, i.e. most frames.
        if !frame.isKeyFrame,
           let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true),
           let dict = (attachmentsArray as NSArray).firstObject as? NSMutableDictionary {
            dict[kCMSampleAttachmentKey_NotSync as String] = true
        }

        return sb
    }

    /// Explicit, full stop -- called from `CircularBufferModule.stopBuffering()`
    /// when the JS side actually stops buffering (CameraScreen unmounting).
    /// Clears `pendingConfig` too, unlike `detachPreviewLayer`'s internal-only
    /// teardown above.
    func stop() {
        stopInternal(clearPendingConfig: true)
    }

    private func stopInternal(clearPendingConfig: Bool) {
        sessionQueue.async { [weak self] in
            self?.teardownOnSessionQueue(clearPendingConfig: clearPendingConfig)
        }
    }

    /// Body of `stopInternal`, callable synchronously from code that's
    /// already on `sessionQueue` (the recovery paths).
    private func teardownOnSessionQueue(clearPendingConfig: Bool) {
        PegueiDiag.log("stopInternal clearPendingConfig=\(clearPendingConfig)")
        if session.isRunning {
            session.stopRunning()
        }
        deviceLock.lock()
        activeDevice = nil
        deviceLock.unlock()

        // `ringBuffer`/`audioRingBuffer` must go to nil in the *same*
        // stateLock critical section as `isRunning = false` --
        // startManualRecording reads both under stateLock expecting
        // them to be consistent. Clearing the buffers outside the lock
        // (as this used to do) left a real window where a concurrent
        // startManualRecording call could observe isRunning == true
        // with ringBuffer == nil (confirmed on-device: exactly that
        // combination surfaced "O buffer não está ativo" right after
        // navigating back from Gallery, which detaches/reattaches the
        // preview and races this teardown). The encoder swap (generation
        // bump + nil session + format reset) lives in the same section for
        // the reason spelled out in handleEncodedSampleBuffer.
        stateLock.lock()
        isRunning = false
        if clearPendingConfig {
            pendingConfig = nil
        }
        pendingSave = nil
        encoderGeneration &+= 1
        let oldCompressionSession = compressionSession
        compressionSession = nil
        formatDescription = nil
        audioFormatDescription = nil
        lastEncodedFrameUptime = nil
        encoderErrorPolicy.reset()
        let oldRingBuffer = ringBuffer
        let oldAudioRingBuffer = audioRingBuffer
        ringBuffer = nil
        audioRingBuffer = nil
        stateLock.unlock()

        if let oldCompressionSession {
            VTCompressionSessionInvalidate(oldCompressionSession)
        }
        oldRingBuffer?.clear()
        oldAudioRingBuffer?.clear()

        // Any pending startRunning() retry chain belongs to the pipeline
        // that just went away.
        sessionRetryToken &+= 1
        isSessionRetryInFlight = false
        needsSessionRestartOnActive = false
        isSessionInterrupted = false
    }
}

// `AVCaptureVideoDataOutputSampleBufferDelegate` and
// `AVCaptureAudioDataOutputSampleBufferDelegate` declare the exact same
// `captureOutput(_:didOutput:from:)` method, so one conformance/
// implementation serves both outputs -- distinguish by `output` identity.
extension CameraEncoderController: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output === audioDataOutput {
            handleAudioSampleBuffer(sampleBuffer)
            return
        }
        diagLock.lock()
        diagCapturedFrames += 1
        diagLock.unlock()
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        // Read the session and its generation together (the pair is swapped
        // atomically by rebuildEncoder/teardown), then encode outside the
        // lock. If the session gets invalidated while this encode is in
        // flight, the call simply fails with -12903 for a stale generation,
        // which noteEncoderError ignores.
        stateLock.lock()
        let compressionSession = self.compressionSession
        let generation = encoderGeneration
        stateLock.unlock()
        guard let compressionSession else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let encodeStatus = VTCompressionSessionEncodeFrame(
            compressionSession,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: nil,
            sourceFrameRefcon: UnsafeMutableRawPointer(bitPattern: generation),
            infoFlagsOut: nil
        )
        if encodeStatus != noErr {
            recordEncodeError(encodeStatus, stage: "encodeFrame")
            noteEncoderError(encodeStatus, generation: generation)
        }
    }
}

// MARK: - Reliability: interruptions, runtime errors, encoder self-healing,
// frame-flow watchdog, thermal step-down, pocket-mode preview (2026-10-21)
//
// Field evidence that drove this ("Buffer vazio, nada para salvar." after
// the app had been open a long time on an iPhone 17 Pro Max): nothing used to
// react to the capture session dying (`isRunning` stayed true forever after
// an AVCaptureSession runtime error/interruption), VTCompressionSessionEncode-
// Frame's status was ignored (after a background/interruption cycle the
// hardware encoder session can come back invalid, -12903, and *every* frame
// then silently fails), and since the ring buffer is cleared after each save,
// a dead pipeline meant the next save found it empty. Everything here
// converges on sessionQueue, the same serial queue every start/stop already
// runs on, so recovery actions can never interleave with each other or with
// a JS-driven start/stop; the decisions themselves live in the pure types in
// PipelineHealthPolicy.swift (unit-tested in PegueiTests).
extension CameraEncoderController {
    private struct EarlyFinalization {
        let save: PendingSave
        let videoFormat: CMFormatDescription?
        let audioFormat: CMFormatDescription?
    }

    fileprivate func installReliabilityMonitoring() {
        let center = NotificationCenter.default

        // Observers deliver on the posting thread (queue: nil) and hop to
        // sessionQueue themselves; payloads are extracted before the hop.
        reliabilityObservers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: nil) { [weak self] note in
            guard let self else { return }
            let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
            self.sessionQueue.async { self.handleRuntimeError(error) }
        })
        reliabilityObservers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: nil) { [weak self] note in
            guard let self else { return }
            let rawReason = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
            let reasonName = Self.interruptionReasonName(rawReason)
            self.sessionQueue.async { self.handleInterruption(reasonName: reasonName) }
        })
        reliabilityObservers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.sessionQueue.async { self.handleInterruptionEnded() }
        })
        reliabilityObservers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.appActivityChanged(isActive: true)
        })
        reliabilityObservers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.appActivityChanged(isActive: false)
        })
        // The singleton can be first touched from a bridge thread, so the
        // initial state is read on main (applicationState is main-only).
        DispatchQueue.main.async { [weak self] in
            self?.appActivityChanged(isActive: UIApplication.shared.applicationState == .active)
        }

        // 1 Hz on sessionQueue itself: ticks are serialized with every
        // start/stop/recovery action, and a tick can't fire mid-restart. The
        // leeway lets the OS coalesce the wakeup with others; the tick is a
        // handful of reads when nothing's wrong (and a no-op when the
        // pipeline isn't running at all).
        let timer = DispatchSource.makeTimerSource(queue: sessionQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in self?.watchdogTick() }
        timer.resume()
        watchdogTimer = timer
    }

    private static func interruptionReasonName(_ rawReason: Int?) -> String {
        guard let rawReason, let reason = AVCaptureSession.InterruptionReason(rawValue: rawReason) else {
            return "unknown"
        }
        switch reason {
        case .videoDeviceNotAvailableInBackground:
            return "background"
        case .audioDeviceInUseByAnotherClient:
            return "audioInUseByAnotherClient"
        case .videoDeviceInUseByAnotherClient:
            return "videoInUseByAnotherClient"
        case .videoDeviceNotAvailableWithMultipleForegroundApps:
            return "multipleForegroundApps"
        case .videoDeviceNotAvailableDueToSystemPressure:
            return "systemPressure"
        default:
            // Newer reasons (e.g. iOS 26's sensitive-content mitigation)
            // are reported by raw value; a plain `default` keeps this
            // compiling warning-free across SDKs that add cases.
            return "reason\(rawReason)"
        }
    }

    // MARK: App state

    /// Called on main.
    private func appActivityChanged(isActive: Bool) {
        stateLock.lock()
        let changed = isAppActive != isActive
        isAppActive = isActive
        stateLock.unlock()
        if changed {
            PegueiDiag.log("app active=\(isActive)")
        }
        guard isActive else { return }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            // Whatever happened while inactive (capture is suspended by the
            // OS then), the pipeline gets a full fresh window to resume on
            // its own before the watchdog judges it.
            self.watchdog.restartWindow(now: Self.uptime)
            if self.needsSessionRestartOnActive {
                self.needsSessionRestartOnActive = false
                self.startSessionRetryChain()
            }
        }
    }

    // MARK: Capture session notifications (sessionQueue)

    /// `AVError.mediaServicesWereReset` means the media server process died
    /// and every capture/audio object it backed is gone -- Apple's guidance
    /// is to rebuild, so this does a full pipeline restart (inputs, outputs,
    /// VTCompressionSession, and the AVAudioSession category/activation that
    /// openCameraAndStartOnSessionQueue sets up). Anything else gets the
    /// lighter AVCam-style remedy first: call startRunning() again, with
    /// backoff, escalating to a full restart only if that keeps failing.
    private func handleRuntimeError(_ error: NSError?) {
        stateLock.lock()
        let running = isRunning
        let appActive = isAppActive
        stateLock.unlock()
        guard running else { return }

        let code = error?.code ?? 0
        if code == AVError.mediaServicesWereReset.rawValue {
            restartPipeline(reason: "mediaServicesWereReset")
            return
        }
        beginRecovery(reason: "runtimeError:\(code)")
        guard appActive else {
            // iOS won't let a non-active app start capture; retrying now
            // would just fail (or worse, succeed into an immediate
            // interruption). appActivityChanged picks this up.
            needsSessionRestartOnActive = true
            return
        }
        startSessionRetryChain()
    }

    private func startSessionRetryChain() {
        sessionRetryToken &+= 1
        isSessionRetryInFlight = true
        attemptSessionStart(attempt: 0, token: sessionRetryToken)
    }

    private func attemptSessionStart(attempt: Int, token: UInt) {
        guard token == sessionRetryToken else { return }
        stateLock.lock()
        let running = isRunning
        let appActive = isAppActive
        stateLock.unlock()

        guard running else {
            isSessionRetryInFlight = false
            return
        }
        if session.isRunning {
            isSessionRetryInFlight = false
            watchdog.restartWindow(now: Self.uptime)
            return
        }
        guard appActive else {
            isSessionRetryInFlight = false
            needsSessionRestartOnActive = true
            return
        }
        guard attempt < SessionRestartBackoff.maxAttempts else {
            isSessionRetryInFlight = false
            restartPipeline(reason: "startRunning retries exhausted")
            return
        }

        session.startRunning()
        PegueiDiag.log("session startRunning retry attempt=\(attempt) -> isRunning=\(session.isRunning)")
        if session.isRunning {
            isSessionRetryInFlight = false
            // The watchdog verifies frames actually flow from here on.
            watchdog.restartWindow(now: Self.uptime)
            return
        }
        let delay = SessionRestartBackoff.delay(forAttempt: attempt)
        sessionQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.attemptSessionStart(attempt: attempt + 1, token: token)
        }
    }

    private func handleInterruption(reasonName: String) {
        PegueiDiag.log("handling interruption reason=\(reasonName)")
        isSessionInterrupted = true
        healthTracker.isInterrupted = true
        stateLock.lock()
        let running = isRunning
        stateLock.unlock()
        if running {
            publishHealth(reason: reasonName)
        }
    }

    /// The OS resumes an interrupted session by itself; what used to be
    /// missing was *checking* that it did. Health goes `recovering` (not
    /// straight to `healthy`) until an encoded frame actually arrives, and
    /// the watchdog gets a fresh window -- if the encoder came back invalid
    /// (-12903, the classic post-interruption failure), the encode-error
    /// policy or the watchdog takes it from there. If the session itself
    /// didn't resume, nudge it with the same startRunning() retry chain a
    /// runtime error uses.
    private func handleInterruptionEnded() {
        isSessionInterrupted = false
        healthTracker.isInterrupted = false
        stateLock.lock()
        let running = isRunning
        stateLock.unlock()
        PegueiDiag.log("handling interruption end running=\(running) session.isRunning=\(session.isRunning)")
        guard running else { return }
        watchdog.restartWindow(now: Self.uptime)
        beginRecovery(reason: "interruptionEnded")
        if !session.isRunning {
            startSessionRetryChain()
        }
    }

    // MARK: Watchdog (sessionQueue, 1 Hz)

    private func watchdogTick() {
        stateLock.lock()
        let running = isRunning
        let appActive = isAppActive
        let lastFrame = lastEncodedFrameUptime
        stateLock.unlock()
        guard running else { return }
        let now = Self.uptime

        if let lastFrame {
            if awaitingInitialHealth {
                awaitingInitialHealth = false
                publishHealth(reason: "framesFlowing")
            }
            if let since = recoveringSince, lastFrame > since {
                PegueiDiag.log("recovery confirmed: frames flowing \(String(format: "%.1f", now - since))s after recovery began")
                recoveringSince = nil
                healthTracker.isRecovering = false
                publishHealth(reason: "framesFlowing")
            }
        }

        // A startRunning() retry chain in flight already owns recovery; the
        // watchdog stays out of its way until it finishes (it escalates to
        // a full restart itself if it fails).
        let isEligible = appActive && !isSessionInterrupted && !isSessionRetryInFlight
        switch watchdog.evaluate(now: now, lastFrameTime: lastFrame, isEligible: isEligible) {
        case .none:
            break
        case .recovered:
            PegueiDiag.log("watchdog: frame flow restored")
        case .rebuildEncoder:
            rebuildEncoder(reason: "watchdog:noFrames", expectedGeneration: nil)
        case .restartPipeline:
            restartPipeline(reason: "watchdog:noFramesAfterRebuild")
        case .giveUp:
            giveUp(reason: "watchdog:restartsFailed")
        }
    }

    // MARK: Recovery actions (sessionQueue)

    private func beginRecovery(reason: String) {
        recoveringSince = Self.uptime
        healthTracker.isRecovering = true
        publishHealth(reason: reason)
    }

    private func publishHealth(reason: String?) {
        // Right after an ordinary start, nothing has been encoded yet: hold
        // back a `healthy` (e.g. from the systemPressure KVO's `.initial`
        // callback at nominal) until watchdogTick sees the first frame.
        // Non-healthy states (interrupted/throttled) still go out at once.
        if awaitingInitialHealth, healthTracker.current == .healthy {
            return
        }
        guard let state = healthTracker.takeTransition() else { return }
        PegueiDiag.log("health -> \(state.rawValue) reason=\(reason ?? "nil")")
        delegate?.cameraEncoderController(self, didChangeHealth: state, reason: reason)
    }

    /// Must be called holding stateLock. Ends the in-flight manual recording
    /// (if any) at exactly this point -- in the same critical section that
    /// swaps the encoder/ring buffers, so it holds frames from one encoder
    /// generation only -- and parks a `DetachedSave` slot for its result.
    private func takePendingSaveForEarlyFinalizationLocked() -> EarlyFinalization? {
        guard let save = pendingSave else { return nil }
        pendingSave = nil
        detachedSave = DetachedSave(outputURL: save.outputURL, outcome: nil, waiter: nil)
        return EarlyFinalization(save: save, videoFormat: formatDescription, audioFormat: audioFormatDescription)
    }

    private func finalizeEarly(_ early: EarlyFinalization, reason: String) {
        PegueiDiag.log("finalizing in-flight recording early (\(reason)) head=\(early.save.headFrames.count) tail=\(early.save.tailFrames.count)")
        let outputURL = early.save.outputURL
        finalizeSave(
            early.save,
            videoFormat: early.videoFormat,
            audioFormat: early.audioFormat,
            onSaved: { [weak self] path, duration in
                self?.completeDetachedSave(outputURL: outputURL, outcome: .saved(path: path, durationSeconds: duration))
            },
            onFailed: { [weak self] code, message in
                self?.completeDetachedSave(outputURL: outputURL, outcome: .failed(code: code, message: message))
            }
        )
    }

    private func completeDetachedSave(outputURL: URL, outcome: SaveOutcome) {
        stateLock.lock()
        guard var detached = detachedSave, detached.outputURL == outputURL else {
            stateLock.unlock()
            PegueiDiag.log("detached save \(outputURL.lastPathComponent) finished but was no longer awaited")
            return
        }
        if let waiter = detached.waiter {
            detachedSave = nil
            stateLock.unlock()
            Self.deliver(outcome, onSaved: waiter.onSaved, onFailed: waiter.onFailed)
        } else {
            detached.outcome = outcome
            detachedSave = detached
            stateLock.unlock()
        }
    }

    /// First rung: replace only the VTCompressionSession. The capture
    /// session keeps running, so this is cheap and fast (no camera
    /// reopen). The ring buffers are cleared because the new session will
    /// emit a new SPS/PPS format description and finalizeSave muxes every
    /// frame of a clip under one format; a recording in flight is cut and
    /// finalized with what it has, for the same reason.
    /// `expectedGeneration` (from the encode-error path) makes a queued
    /// rebuild a no-op if the session it was about has already been
    /// replaced by the time it runs.
    private func rebuildEncoder(reason: String, expectedGeneration: UInt?) {
        stateLock.lock()
        guard isRunning, let config = activeConfig ?? pendingConfig, expectedGeneration == nil || expectedGeneration == encoderGeneration else {
            stateLock.unlock()
            return
        }
        encoderGeneration &+= 1
        let oldSession = compressionSession
        compressionSession = nil
        let early = takePendingSaveForEarlyFinalizationLocked()
        formatDescription = nil
        encoderErrorPolicy.reset()
        ringBuffer?.clear()
        audioRingBuffer?.clear()
        stateLock.unlock()

        PegueiDiag.log("rebuildEncoder reason=\(reason) recordingCut=\(early != nil)")
        if let oldSession {
            VTCompressionSessionInvalidate(oldSession)
        }
        beginRecovery(reason: reason)
        if let early {
            finalizeEarly(early, reason: reason)
        }

        guard let newSession = makeCompressionSession(config: config) else {
            restartPipeline(reason: "encoderRecreateFailed")
            return
        }
        // The generation was already bumped above, so every frame submitted
        // to the new session from here on carries the current one.
        stateLock.lock()
        compressionSession = newSession
        stateLock.unlock()
        watchdog.restartWindow(now: Self.uptime)
    }

    /// Second rung: full teardown + reopen with the pending config (same
    /// path an ordinary start takes, minus resetting the watchdog's stage).
    /// Only while a preview is attached -- without one there's nothing to
    /// restart into, and attachPreviewLayer starts things up itself.
    private func restartPipeline(reason: String) {
        stateLock.lock()
        guard isRunning, previewLayer != nil, pendingConfig != nil else {
            stateLock.unlock()
            return
        }
        let early = takePendingSaveForEarlyFinalizationLocked()
        stateLock.unlock()

        PegueiDiag.log("restartPipeline reason=\(reason) recordingCut=\(early != nil)")
        beginRecovery(reason: reason)
        if let early {
            finalizeEarly(early, reason: reason)
        }
        teardownOnSessionQueue(clearPendingConfig: false)
        isRecoveryRestart = true
        openCameraAndStartOnSessionQueue()
    }

    /// Recovery failed: stop claiming to buffer. `isRunning` goes false (so
    /// `isBuffering()` is truthful and JS's AppState handler restarts on
    /// the next return to the foreground), the camera is released instead
    /// of being held open producing nothing, and JS gets an error banner.
    /// `pendingConfig` is kept so a re-attach/`startBuffering` can start
    /// over cleanly.
    private func giveUp(reason: String) {
        stateLock.lock()
        let early = takePendingSaveForEarlyFinalizationLocked()
        stateLock.unlock()
        PegueiDiag.log("GIVING UP reason=\(reason) recordingCut=\(early != nil)")
        if let early {
            finalizeEarly(early, reason: reason)
        }
        teardownOnSessionQueue(clearPendingConfig: false)
        delegate?.cameraEncoderController(
            self,
            didFailWithCode: CircularBufferErrorCode.encoderInitFailed,
            message: "A câmera parou de enviar imagens. Saia e volte para o app para reiniciar o buffer."
        )
    }

    // MARK: Thermal step-down

    /// KVO callback (arbitrary thread) for `systemPressureState`.
    fileprivate func systemPressureChanged(to level: AVCaptureDevice.SystemPressureState.Level, on device: AVCaptureDevice) {
        let mapped: ThermalPressureLevel
        switch level {
        case .nominal:
            mapped = .nominal
        case .fair:
            mapped = .fair
        case .serious:
            mapped = .serious
        case .critical:
            mapped = .critical
        case .shutdown:
            mapped = .shutdown
        default:
            mapped = .nominal
        }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.deviceLock.lock()
            let current = self.activeDevice
            self.deviceLock.unlock()
            guard current === device else { return }
            self.thermalLevel = mapped
            self.applyThermalFrameRate(on: device)
        }
    }

    /// Applies `ThermalFpsPolicy` through activeVideoMin/MaxFrameDuration
    /// -- a device-level property, so (like zoom) it never reconfigures the
    /// session, never touches the encoder, and never interrupts a recording
    /// in flight. `activeFps` follows along so a clip started while
    /// throttled stamps the right per-frame duration (PTS stay real either
    /// way). The encoder's ExpectedFrameRate/bitrate hints are deliberately
    /// left alone: they're hints, and at a lower fps the same bitrate only
    /// means slightly better quality per frame.
    private func applyThermalFrameRate(on device: AVCaptureDevice) {
        let ranges = device.activeFormat.videoSupportedFrameRateRanges
        let minSupported = Int((ranges.map(\.minFrameRate).min() ?? 1).rounded(.up))
        let target = ThermalFpsPolicy.targetFps(configuredFps: configuredFps, level: thermalLevel, minSupportedFps: minSupported)

        if target != appliedFps {
            let supported = ranges.contains { Double(target) >= $0.minFrameRate && Double(target) <= $0.maxFrameRate }
            guard supported else {
                PegueiDiag.log("thermal step to \(target) fps skipped: not supported by active format")
                return
            }
            do {
                try device.lockForConfiguration()
                let duration = CMTimeMake(value: 1, timescale: Int32(target))
                device.activeVideoMinFrameDuration = duration
                device.activeVideoMaxFrameDuration = duration
                device.unlockForConfiguration()
            } catch {
                PegueiDiag.log("thermal step to \(target) fps failed: \(error.localizedDescription)")
                return
            }
            PegueiDiag.log("thermal step \(appliedFps) -> \(target) fps (level=\(thermalLevel), configured=\(configuredFps))")
            appliedFps = target
            stateLock.lock()
            activeFps = target
            stateLock.unlock()
        }

        healthTracker.isThrottled = ThermalFpsPolicy.isThrottled(configuredFps: configuredFps, targetFps: appliedFps)
        stateLock.lock()
        let running = isRunning
        stateLock.unlock()
        if running {
            publishHealth(reason: "thermal:\(thermalLevel)")
        }
    }

    // MARK: Pocket mode (preview off, capture untouched)

    /// Disables/enables the preview layer's connection so the preview isn't
    /// composited while the screen is black anyway; capture, encode and the
    /// ring buffer are untouched. Remembered, so the new connection a
    /// restart/re-attach creates gets the same treatment.
    func setPreviewSuppressed(_ suppressed: Bool) {
        stateLock.lock()
        previewSuppressed = suppressed
        stateLock.unlock()
        sessionQueue.async { [weak self] in
            self?.applyPreviewSuppression()
        }
    }

    /// Called on sessionQueue (after any reconfiguration it might race), but
    /// the layer/connection mutation itself happens on main like any other
    /// CALayer change.
    fileprivate func applyPreviewSuppression() {
        stateLock.lock()
        let layer = previewLayer
        let suppressed = previewSuppressed
        stateLock.unlock()
        guard let layer else { return }
        DispatchQueue.main.async {
            guard let connection = layer.connection, connection.isEnabled == suppressed else { return }
            connection.isEnabled = !suppressed
            PegueiDiag.log("preview connection enabled=\(!suppressed)")
        }
    }
}
