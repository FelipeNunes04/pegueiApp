import Foundation

/// Error codes surfaced to JS via the Promise rejection code.
enum CircularBufferErrorCode {
    static let cameraBusy = "E_CAMERA_BUSY"
    static let cameraPermission = "E_CAMERA_PERMISSION"
    static let encoderInitFailed = "E_ENCODER_INIT_FAILED"
    static let notBuffering = "E_NOT_BUFFERING"
    static let alreadyBuffering = "E_ALREADY_BUFFERING"
    static let storageFull = "E_STORAGE_FULL"
    static let saveFailed = "E_SAVE_FAILED"
}

struct CircularBufferError: Error {
    let code: String
    let message: String
}
