import AVFoundation
import Foundation
import React
import UIKit

@objc(CircularBufferModule)
class CircularBufferModule: RCTEventEmitter {
    override static func moduleName() -> String! {
        return "CircularBufferModule"
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // Camera errors (busy, session interrupted) surface asynchronously, well
    // after startBuffering's promise already resolved -- there's no pending
    // Promise left to reject, so they're emitted as a JS event instead.
    // useCircularBuffer.ts subscribes via circularBufferEvents and routes
    // this into the same error banner as a rejected saveClip().
    // CircularBufferHealth ({ state, reason? }, transitions only) and
    // CircularBufferHardwareTrigger ({ source }) follow the same pattern --
    // see the bridge contract in
    // docs/plans/2026-10-21-reliability-battery-triggers.md. RCTEventEmitter
    // refuses (asserts in debug) to send any event name not listed here.
    // CircularBufferRecordingFinalized ({ reason, path?, durationSeconds?,
    // error? }) reports a manual recording native ended on its own.
    override func supportedEvents() -> [String]! {
        return ["CircularBufferError", "CircularBufferHealth", "CircularBufferHardwareTrigger", "CircularBufferRecordingFinalized"]
    }

    private var mediaServicesResetObserver: NSObjectProtocol?

    override init() {
        super.init()
        // A media-server reset invalidates every AVAudioPlayer; they're
        // rebuilt on next use.
        mediaServicesResetObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.discardSoundPlayers()
        }
    }

    deinit {
        if let mediaServicesResetObserver {
            NotificationCenter.default.removeObserver(mediaServicesResetObserver)
        }
    }

    private var moviesDir: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("PegueiClips", isDirectory: true)
    }

    @objc(startBuffering:resolver:rejecter:)
    func startBuffering(config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard
            let bufferSeconds = config["bufferSeconds"] as? Int,
            let width = config["width"] as? Int,
            let height = config["height"] as? Int,
            let fps = config["fps"] as? Int
        else {
            reject(CircularBufferErrorCode.encoderInitFailed, "Configuração de buffer inválida.", nil)
            return
        }

        let bufferConfig = BufferConfig(bufferSeconds: bufferSeconds, width: width, height: height, fps: fps)
        CameraEncoderController.shared.configureAndArm(config: bufferConfig, delegate: self)
        // Continuous recording is pointless if the OS locks the screen (and,
        // on iOS, backgrounds the app -- suspending the capture session
        // entirely) a few seconds into an unattended/mounted recording
        // session. isIdleTimerDisabled must be touched on the main thread;
        // this @objc method itself isn't guaranteed to run there (see
        // requiresMainQueueSetup() above).
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        resolve(nil)
    }

    @objc(stopBuffering:rejecter:)
    func stopBuffering(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.stop()
        // Defensive pocket-mode exit: if CameraScreen unmounts (and stops
        // the buffer) while its pocket overlay is up, nothing on the JS side
        // is left to call setPocketMode(false) -- and an app-set screen
        // brightness on iOS persists until the device locks, even across
        // leaving the app. Restoring here is a no-op when pocket mode is off.
        CameraEncoderController.shared.setPreviewSuppressed(false)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
            PocketModeBrightness.shared.setEnabled(false)
        }
        resolve(nil)
    }

    // Pocket mode: the phone is buffering face-down/in a pocket with a black
    // JS overlay on top. Dimming the backlight is the actual battery win
    // (an OLED showing black is already cheap, but the backlight/driver and
    // the compositor still aren't free), and disabling the preview layer's
    // connection stops compositing camera frames nobody can see. Capture,
    // encoding and the ring buffer are deliberately untouched -- this must
    // never cost pre-roll.
    @objc(setPocketMode:resolver:rejecter:)
    func setPocketMode(enabled: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.setPreviewSuppressed(enabled)
        DispatchQueue.main.async {
            PocketModeBrightness.shared.setEnabled(enabled)
            resolve(nil)
        }
    }

    // Volume up/down and the Camera Control button as record start/stop
    // triggers, via AVCaptureEventInteraction (iOS 17.2+; resolves as a
    // no-op below that). See HardwareTriggerCoordinator for what can and
    // can't be told apart.
    @objc(setHardwareTriggerEnabled:resolver:rejecter:)
    func setHardwareTriggerEnabled(enabled: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            let coordinator = HardwareTriggerCoordinator.shared
            coordinator.onTrigger = { [weak self] source in
                self?.sendEvent(withName: "CircularBufferHardwareTrigger", body: ["source": source])
            }
            coordinator.setEnabled(enabled)
            resolve(nil)
        }
    }

    // Android-only concepts (Doze/battery-optimization exemption). iOS has
    // no equivalent user-grantable exemption, and capture is suspended in
    // the background regardless, so the honest answer for the JS card is
    // "nothing to fix here" -- it stays hidden on iOS.
    @objc(isIgnoringBatteryOptimizations:rejecter:)
    func isIgnoringBatteryOptimizations(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(true)
    }

    @objc(openBatteryOptimizationSettings:rejecter:)
    func openBatteryOptimizationSettings(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc(startManualRecording:rejecter:)
    func startManualRecording(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        // Resolving/rejecting a promise from a background thread is a
        // well-known crash source with the New Architecture (Fabric/
        // TurboModules, enabled in this project) -- CameraEncoderController's
        // callbacks fire from sessionQueue/DispatchQueue.global, not the main
        // thread. Hopping to the main queue before calling resolve/reject is
        // the standard, safe React Native convention. See DECISIONS.md.
        CameraEncoderController.shared.startManualRecording(
            moviesDir: moviesDir,
            onStarted: {
                DispatchQueue.main.async { resolve(nil) }
            },
            onFailed: { code, message in
                DispatchQueue.main.async { reject(code, message, nil) }
            }
        )
    }

    @objc(stopManualRecording:rejecter:)
    func stopManualRecording(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.stopManualRecording(
            onSaved: { path, duration in
                DispatchQueue.main.async { resolve(["path": path, "durationSeconds": duration]) }
            },
            onFailed: { code, message in
                DispatchQueue.main.async { reject(code, message, nil) }
            }
        )
    }

    // AudioServicesPlaySystemSound (the obvious API for a UI cue) is muted
    // for the entire duration of an active .playAndRecord session -- confirmed
    // on-device even after opting in via setAllowHapticsAndSystemSoundsDuring
    // Recording(true). A plain AVAudioPlayer doesn't have that restriction:
    // .playAndRecord (see CameraEncoderController's setCategory call) exists
    // specifically to allow simultaneous playback + capture, which is how
    // apps like Voice Memos play their own start/stop chime while already
    // recording. The tones are synthesized in-process rather than bundled as
    // asset files, so no Xcode resource wiring is needed.
    private let soundPlayersLock = NSLock()
    private var startSoundPlayer: AVAudioPlayer?
    private var stopSoundPlayer: AVAudioPlayer?

    @objc
    func playRecordingStartSound() {
        soundPlayersLock.lock()
        if startSoundPlayer == nil {
            startSoundPlayer = Self.makeBeepPlayer(notes: [(880, 0.12)])
        }
        let player = startSoundPlayer
        soundPlayersLock.unlock()
        player?.currentTime = 0
        player?.play()
    }

    @objc
    func playRecordingStopSound() {
        soundPlayersLock.lock()
        if stopSoundPlayer == nil {
            stopSoundPlayer = Self.makeBeepPlayer(notes: [(880, 0.09), (660, 0.09)])
        }
        let player = stopSoundPlayer
        soundPlayersLock.unlock()
        player?.currentTime = 0
        player?.play()
    }

    private func discardSoundPlayers() {
        soundPlayersLock.lock()
        startSoundPlayer = nil
        stopSoundPlayer = nil
        soundPlayersLock.unlock()
    }

    private static func makeBeepPlayer(notes: [(frequency: Double, duration: Double)]) -> AVAudioPlayer? {
        let player = try? AVAudioPlayer(data: makeBeepWavData(notes: notes), fileTypeHint: AVFileType.wav.rawValue)
        player?.prepareToPlay()
        return player
    }

    // Renders `notes` (each a frequency/duration pair, played back to back)
    // as a mono 16-bit PCM WAV in memory. A short linear fade in/out on each
    // note avoids the audible click a hard-edged sine transition would cause.
    private static func makeBeepWavData(notes: [(frequency: Double, duration: Double)], sampleRate: Double = 44100) -> Data {
        let fadeSeconds = 0.01
        var samples: [Int16] = []
        for note in notes {
            let sampleCount = Int(note.duration * sampleRate)
            let fadeSamples = Int(fadeSeconds * sampleRate)
            for n in 0..<sampleCount {
                let t = Double(n) / sampleRate
                var amplitude = 1.0
                if n < fadeSamples {
                    amplitude = Double(n) / Double(fadeSamples)
                } else if n > sampleCount - fadeSamples {
                    amplitude = Double(sampleCount - n) / Double(fadeSamples)
                }
                let value = sin(2.0 * Double.pi * note.frequency * t) * amplitude * 0.6
                samples.append(Int16(value * Double(Int16.max)))
            }
        }

        var data = Data()
        func appendU32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        func appendU16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }

        let byteRate = UInt32(sampleRate) * 2 // mono, 16-bit
        let subchunk2Size = UInt32(samples.count * 2)

        data.append("RIFF".data(using: .ascii)!)
        appendU32(36 + subchunk2Size)
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        appendU32(16) // Subchunk1Size for PCM
        appendU16(1) // AudioFormat: PCM
        appendU16(1) // NumChannels: mono
        appendU32(UInt32(sampleRate))
        appendU32(byteRate)
        appendU16(2) // BlockAlign
        appendU16(16) // BitsPerSample
        data.append("data".data(using: .ascii)!)
        appendU32(subchunk2Size)
        for sample in samples {
            appendU16(UInt16(bitPattern: sample))
        }
        return data
    }

    @objc(isBuffering:rejecter:)
    func isBuffering(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(CameraEncoderController.shared.isBuffering)
    }

    @objc(setZoom:resolver:rejecter:)
    func setZoom(factor: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.setZoom(
            factor: factor.doubleValue,
            onSet: { applied in
                DispatchQueue.main.async { resolve(applied) }
            },
            onFailed: { code, message in
                DispatchQueue.main.async { reject(code, message, nil) }
            }
        )
    }

    @objc(getZoomInfo:rejecter:)
    func getZoomInfo(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.zoomInfo(
            onResult: { minZoom, maxZoom, hasUltraWide in
                DispatchQueue.main.async {
                    resolve(["minZoom": minZoom, "maxZoom": maxZoom, "hasUltraWide": hasUltraWide])
                }
            },
            onFailed: { code, message in
                DispatchQueue.main.async { reject(code, message, nil) }
            }
        )
    }

    // Queried once by SettingsScreen (and defensively by useCircularBuffer
    // before starting the buffer) so quality/fps options the hardware
    // doesn't actually support are disabled/clamped instead of silently
    // ignored or failing to start. AVCaptureDevice.formats requires no
    // active session, so this can run standalone without a running buffer.
    @objc(getCaptureCapabilities:rejecter:)
    func getCaptureCapabilities(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let capabilities = CameraEncoderController.shared.captureCapabilities()
        resolve([
            "supportedQualities": capabilities.supportedQualities,
            "fpsByQuality": capabilities.fpsByQuality,
        ])
    }
}

extension CircularBufferModule: CameraEncoderControllerDelegate {
    func cameraEncoderController(_ controller: CameraEncoderController, didFailWithCode code: String, message: String) {
        sendEvent(withName: "CircularBufferError", body: ["code": code, "message": message])
    }

    func cameraEncoderController(_ controller: CameraEncoderController, didChangeHealth state: BufferHealthState, reason: String?) {
        var body: [String: Any] = ["state": state.rawValue]
        if let reason {
            body["reason"] = reason
        }
        sendEvent(withName: "CircularBufferHealth", body: body)
    }

    func cameraEncoderController(_ controller: CameraEncoderController, didFinalizeRecordingWithReason reason: RecordingFinalizeReason, path: String?, durationSeconds: Double?, error: String?) {
        var body: [String: Any] = ["reason": reason.rawValue]
        if let path, let durationSeconds {
            body["path"] = path
            body["durationSeconds"] = durationSeconds
        }
        if let error {
            body["error"] = error
        }
        sendEvent(withName: "CircularBufferRecordingFinalized", body: body)
    }
}

/// Screen-brightness half of pocket mode. Main thread only.
///
/// iOS keeps an app-set `UIScreen.brightness` until the device locks --
/// *including after the app leaves the foreground* -- so a naive "dim on
/// enter, restore on exit" leaves the user's home screen at 1% if they
/// switch apps while pocket mode is on. Hence the resign/become-active
/// observers: the user's brightness is restored whenever the app stops
/// being active and re-dimmed when it comes back with pocket mode still on.
/// The screen is reached through the active window scene rather than
/// `UIScreen.main`, which is deprecated as of iOS 16 (the deployment target).
final class PocketModeBrightness {
    static let shared = PocketModeBrightness()

    private static let dimmedBrightness: CGFloat = 0.01

    private var isEnabled = false
    private var savedBrightness: CGFloat?
    private var observers: [NSObjectProtocol] = []

    private init() {}

    func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        if enabled {
            installObserversIfNeeded()
            if UIApplication.shared.applicationState == .active {
                dim()
            }
        } else {
            restore()
        }
    }

    private var screen: UIScreen? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.screen
    }

    private func dim() {
        guard let screen else { return }
        if savedBrightness == nil {
            savedBrightness = screen.brightness
        }
        screen.brightness = Self.dimmedBrightness
    }

    private func restore() {
        guard let saved = savedBrightness else { return }
        savedBrightness = nil
        screen?.brightness = saved
    }

    private func installObserversIfNeeded() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.restore()
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.isEnabled else { return }
            self.dim()
        })
    }
}
