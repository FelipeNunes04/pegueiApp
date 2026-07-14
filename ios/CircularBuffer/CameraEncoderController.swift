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

protocol CameraEncoderControllerDelegate: AnyObject {
    func cameraEncoderController(_ controller: CameraEncoderController, didFailWithCode code: String, message: String)
}

/// Owns the AVCaptureSession, a VTCompressionSession (H.264 hardware
/// encoder) and the `FrameRingBuffer` of encoded frames. Video-only (no
/// audio track): the microphone is a single-consumer resource already
/// claimed by the wake-word voice processor while listening. See
/// DECISIONS.md.
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

    private var compressionSession: VTCompressionSession?
    private var formatDescription: CMFormatDescription?

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var ringBuffer: FrameRingBuffer?
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

    /// A manual recording in flight: `headFrames` is the pre-roll snapshot
    /// taken from the ring buffer the moment recording started; `tailFrames`
    /// keeps accumulating every frame the encoder produces for as long as
    /// recording continues, with no fixed target duration -- the user's own
    /// "stop" tap is what ends it (see `stopManualRecording`).
    private struct PendingSave {
        let headFrames: [EncodedFrame]
        var tailFrames: [EncodedFrame] = []
        let outputURL: URL
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

            let authStatus = AVCaptureDevice.authorizationStatus(for: .video)
            guard authStatus == .authorized else {
                self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.cameraPermission, message: "Permissão de câmera não concedida.")
                return
            }

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

                self.videoDataOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                self.videoDataOutput.alwaysDiscardsLateVideoFrames = true
                self.videoDataOutput.setSampleBufferDelegate(self, queue: self.videoDataOutputQueue)
                guard self.session.canAddOutput(self.videoDataOutput) else {
                    self.session.commitConfiguration()
                    self.delegate?.cameraEncoderController(self, didFailWithCode: CircularBufferErrorCode.encoderInitFailed, message: "Não foi possível configurar a saída de vídeo.")
                    return
                }
                self.session.addOutput(self.videoDataOutput)
                self.session.sessionPreset = .high

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
        let outputURL = moviesDir.appendingPathComponent("clip_\(Int(Date().timeIntervalSince1970 * 1000)).mp4")

        stateLock.lock()
        pendingSave = PendingSave(headFrames: head, outputURL: outputURL)
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

            let allFrames = save.headFrames + save.tailFrames
            guard let startUs = allFrames.first?.presentationTimeUs else {
                onFailed(CircularBufferErrorCode.saveFailed, "Buffer vazio, nada para salvar.")
                return
            }

            do {
                try? FileManager.default.removeItem(at: save.outputURL)
                let writer = try AVAssetWriter(outputURL: save.outputURL, fileType: .mp4)
                let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: formatDescription)
                input.expectsMediaDataInRealTime = false
                guard writer.canAdd(input) else {
                    onFailed(CircularBufferErrorCode.saveFailed, "Não foi possível configurar o gravador de vídeo.")
                    return
                }
                writer.add(input)
                writer.startWriting()
                writer.startSession(atSourceTime: .zero)

                // AVAssetWriterInput.append(_:) raises an uncaught
                // NSException (not a catchable Swift error) if called while
                // the writer isn't in .writing status -- e.g. if it already
                // failed. Checking writer.status before every append, and
                // capping the isReadyForMoreMediaData poll instead of
                // spinning forever, turns what would otherwise be a hard
                // crash into a normal onFailed() call.
                var writeFailed = false
                for frame in allFrames {
                    guard writer.status == .writing else {
                        writeFailed = true
                        break
                    }
                    guard let sampleBuffer = Self.makeSampleBuffer(frame: frame, formatDescription: formatDescription, startUs: startUs, fps: 30) else {
                        continue
                    }
                    var waitedMs = 0
                    while !input.isReadyForMoreMediaData {
                        if writer.status != .writing || waitedMs >= 2000 {
                            writeFailed = true
                            break
                        }
                        Thread.sleep(forTimeInterval: 0.002)
                        waitedMs += 2
                    }
                    if writeFailed { break }
                    guard writer.status == .writing else {
                        writeFailed = true
                        break
                    }
                    input.append(sampleBuffer)
                }

                if writeFailed {
                    input.markAsFinished()
                    onFailed(CircularBufferErrorCode.saveFailed, writer.error?.localizedDescription ?? "O gravador de vídeo parou de responder.")
                    return
                }

                input.markAsFinished()
                let durationSeconds = Double(allFrames.last!.presentationTimeUs - startUs) / 1_000_000.0
                let semaphore = DispatchSemaphore(value: 0)
                writer.finishWriting {
                    semaphore.signal()
                }
                semaphore.wait()

                if writer.status == .completed {
                    onSaved(save.outputURL.path, durationSeconds)
                } else {
                    onFailed(CircularBufferErrorCode.saveFailed, writer.error?.localizedDescription ?? "Falha desconhecida ao finalizar o vídeo.")
                }
            } catch {
                onFailed(CircularBufferErrorCode.saveFailed, "Falha ao gerar o arquivo de vídeo: \(error.localizedDescription)")
            }
        }
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
            self.ringBuffer?.clear()
            self.ringBuffer = nil
            self.deviceLock.lock()
            self.activeDevice = nil
            self.deviceLock.unlock()

            self.stateLock.lock()
            self.isRunning = false
            if clearPendingConfig {
                self.pendingConfig = nil
            }
            self.pendingSave = nil
            self.stateLock.unlock()
        }
    }
}

extension CameraEncoderController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
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
