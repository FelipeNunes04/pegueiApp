import Foundation
import React

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
    override func supportedEvents() -> [String]! {
        return ["CircularBufferError"]
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
        resolve(nil)
    }

    @objc(stopBuffering:rejecter:)
    func stopBuffering(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        CameraEncoderController.shared.stop()
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
}

extension CircularBufferModule: CameraEncoderControllerDelegate {
    func cameraEncoderController(_ controller: CameraEncoderController, didFailWithCode code: String, message: String) {
        sendEvent(withName: "CircularBufferError", body: ["code": code, "message": message])
    }
}
