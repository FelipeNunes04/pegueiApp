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

protocol CameraEncoderControllerDelegate: AnyObject {
    func cameraEncoderController(_ controller: CameraEncoderController, didFailWithCode code: String, message: String)
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
            guard let self else { return }
            guard let config = self.pendingConfig else { return }

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

            guard self.setUpCompressionSession(config: config) else {
                self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Falha ao iniciar o encoder H.264.")
                return
            }

            self.session.startRunning()
            self.stateLock.lock()
            self.isRunning = true
            self.stateLock.unlock()
        }
    }

    /// Prefers a virtual multi-lens back camera (triple: ultra-wide+wide+tele,
    /// then dual-wide: ultra-wide+wide) so `videoZoomFactor` sweeps across
    /// the device's full switch-over range (see
    /// `virtualDeviceSwitchOverVideoZoomFactors`) with better-than-digital
    /// quality at the higher pill levels (2x and up). Falls back to the
    /// plain single-lens wide camera (this app's previous, only, behavior)
    /// on older/cheaper devices that don't expose a virtual device at all.
    /// `AVCaptureDevice.default(_:for:position:)` returns nil (not a crash)
    /// for a type the device doesn't have, so this is a plain ordered
    /// fallback, not a discovery/filter step.
    ///
    /// **Does NOT get ultra-wide (sub-1.0) zoom working** -- see
    /// DECISIONS.md "Camera zoom (0.5x correction)" for why: confirmed on a
    /// physical iPhone with a triple camera that `minAvailableVideoZoomFactor`
    /// stays clamped to `1.0` for every single format this device offers
    /// (even though `constituentDevices` does include the ultra-wide lens),
    /// and forcing `videoZoomFactor` below `1.0` anyway crashes with
    /// `NSRangeException`. `hasUltraWide` in `zoomInfo()` below will
    /// therefore always report `false` on a plain (non-multicam)
    /// `AVCaptureSession` like this one, regardless of the physical device --
    /// this is not a per-device hardware check bug, it's an architecture
    /// constraint.
    private static func pickBackCameraDevice() -> AVCaptureDevice? {
        let candidateTypes: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera,
            .builtInDualWideCamera,
            .builtInWideAngleCamera,
        ]
        for type in candidateTypes {
            if let device = AVCaptureDevice.default(type, for: .video, position: .back) {
                return device
            }
        }
        return nil
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
    /// on a virtual multi-lens device, `1.0` is simply the device's own
    /// minimum, which on a triple/dual-wide camera IS the ultra-wide lens,
    /// not the wide lens. The wide lens (the real "1x" reference) is
    /// `virtualDeviceSwitchOverVideoZoomFactors.first`, confirmed against
    /// an Apple DTS engineer's own example on the developer forums (iPhone
    /// 14 Pro: `minAvailableVideoZoomFactor == 1.0` → ultra-wide/"0.5x",
    /// `virtualDeviceSwitchOverVideoZoomFactors == [2, 6]` → `2.0` is the
    /// wide lens/"1x", `6.0` is telephoto/"3x") -- see DECISIONS.md "Camera
    /// zoom" for the full story of how this was found and why the earlier
    /// `minZoom <= 0.6` check was simply wrong for this device generation.
    /// A device with no virtual switchover array at all (a plain
    /// single-lens wide camera) has no ultra-wide either, so falling back
    /// to `minAvailableVideoZoomFactor` itself as the reference makes
    /// display and internal units the same there, matching prior behavior.
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
    /// (0.5 = ultra-wide, 1.0 = wide, etc.) -- see `wideLensReferenceZoom`.
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
    /// or not that minimum happens to be the ultra-wide lens).
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

    private func setUpCompressionSession(config: BufferConfig) -> Bool {
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

        guard status == noErr, let compressionSession = session else { return false }

        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Main_AutoLevel)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 1.0 as CFNumber)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: config.fps as CFNumber)
        let bitRate = estimateBitRate(config: config)
        VTSessionSetProperty(compressionSession, key: kVTCompressionPropertyKey_AverageBitRate, value: bitRate as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(compressionSession)

        self.compressionSession = compressionSession
        return true
    }

    private func estimateBitRate(config: BufferConfig) -> Int {
        // ~0.12 bits per pixel per frame, same heuristic as the Android encoder.
        return max(1_000_000, Int(Double(config.width * config.height * config.fps) * 0.12))
    }

    /// C-compatible VTCompressionSession output callback. Must be a free
    /// function (no captures) -- state travels through `outputCallbackRefCon`.
    private let compressionOutputCallback: VTCompressionOutputCallback = { refcon, _, status, _, sampleBuffer in
        guard status == noErr, let sampleBuffer, let refcon else { return }
        let controller = Unmanaged<CameraEncoderController>.fromOpaque(refcon).takeUnretainedValue()
        controller.handleEncodedSampleBuffer(sampleBuffer)
    }

    private func handleEncodedSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        if formatDescription == nil {
            formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer)
        }

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
        ringBuffer?.add(frame)
        appendToPendingSaveIfNeeded(frame)
    }

    private func appendToPendingSaveIfNeeded(_ frame: EncodedFrame) {
        // No auto-stop target here -- a manual recording only ends when
        // stopManualRecording() is called explicitly.
        stateLock.lock()
        if pendingSave != nil {
            pendingSave!.tailFrames.append(frame)
        }
        stateLock.unlock()
    }

    private func handleAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        if audioFormatDescription == nil {
            audioFormatDescription = CMSampleBufferGetFormatDescription(sampleBuffer)
        }

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
        audioRingBuffer?.add(frame)
        appendAudioToPendingSaveIfNeeded(frame)
    }

    private func appendAudioToPendingSaveIfNeeded(_ frame: AudioSampleFrame) {
        stateLock.lock()
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
        let capturedFps = activeFps
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

        let head = buffer.snapshotFromOldestKeyframe()
        let audioHead = audioRingBuffer?.snapshot() ?? []
        let outputURL = moviesDir.appendingPathComponent("clip_\(Int(Date().timeIntervalSince1970 * 1000)).mp4")

        stateLock.lock()
        pendingSave = PendingSave(headFrames: head, audioHeadFrames: audioHead, outputURL: outputURL, fps: capturedFps)
        stateLock.unlock()
        onStarted()
    }

    func stopManualRecording(onSaved: @escaping (String, Double) -> Void, onFailed: @escaping (String, String) -> Void) {
        stateLock.lock()
        guard let save = pendingSave else {
            stateLock.unlock()
            onFailed(CircularBufferErrorCode.saveFailed, "Nenhuma gravação em andamento.")
            return
        }
        pendingSave = nil
        stateLock.unlock()
        finalizeSave(save, onSaved: onSaved, onFailed: onFailed)
    }

    private func finalizeSave(_ save: PendingSave, onSaved: @escaping (String, Double) -> Void, onFailed: @escaping (String, String) -> Void) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self, let formatDescription = self.formatDescription else {
                onFailed(CircularBufferErrorCode.saveFailed, "Formato do encoder ainda não disponível.")
                return
            }
            let audioFormatDescription = self.audioFormatDescription

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
                    onSaved(save.outputURL.path, durationSeconds)
                } else {
                    onFailed(CircularBufferErrorCode.saveFailed, writer.error?.localizedDescription ?? "Falha desconhecida ao finalizar o vídeo.")
                }
            } catch {
                onFailed(CircularBufferErrorCode.saveFailed, "Falha ao gerar o arquivo de vídeo: \(error.localizedDescription)")
            }
        }
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
            guard let self else { return }
            if self.session.isRunning {
                self.session.stopRunning()
            }
            if let compressionSession = self.compressionSession {
                VTCompressionSessionInvalidate(compressionSession)
            }
            self.compressionSession = nil
            self.formatDescription = nil
            self.audioFormatDescription = nil
            self.deviceLock.lock()
            self.activeDevice = nil
            self.deviceLock.unlock()

            // `ringBuffer`/`audioRingBuffer` must go to nil in the *same*
            // stateLock critical section as `isRunning = false` --
            // startManualRecording reads both under stateLock expecting
            // them to be consistent. Clearing the buffers outside the lock
            // (as this used to do) left a real window where a concurrent
            // startManualRecording call could observe isRunning == true
            // with ringBuffer == nil (confirmed on-device: exactly that
            // combination surfaced "O buffer não está ativo" right after
            // navigating back from Gallery, which detaches/reattaches the
            // preview and races this teardown).
            self.stateLock.lock()
            self.isRunning = false
            if clearPendingConfig {
                self.pendingConfig = nil
            }
            self.pendingSave = nil
            let oldRingBuffer = self.ringBuffer
            let oldAudioRingBuffer = self.audioRingBuffer
            self.ringBuffer = nil
            self.audioRingBuffer = nil
            self.stateLock.unlock()

            oldRingBuffer?.clear()
            oldAudioRingBuffer?.clear()
        }
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
        guard let compressionSession, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        VTCompressionSessionEncodeFrame(
            compressionSession,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: nil,
            sourceFrameRefcon: nil,
            infoFlagsOut: nil
        )
    }
}
