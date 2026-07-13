package com.voicecambuffer.circularbuffer

/** Error codes surfaced to JS via Promise.reject(code, message). */
object CircularBufferErrorCodes {
    const val CAMERA_BUSY = "E_CAMERA_BUSY"
    const val CAMERA_PERMISSION = "E_CAMERA_PERMISSION"
    const val ENCODER_INIT_FAILED = "E_ENCODER_INIT_FAILED"
    const val NOT_BUFFERING = "E_NOT_BUFFERING"
    const val ALREADY_BUFFERING = "E_ALREADY_BUFFERING"
    const val STORAGE_FULL = "E_STORAGE_FULL"
    const val SAVE_FAILED = "E_SAVE_FAILED"
    const val NO_ACTIVITY = "E_NO_ACTIVITY"
}

class CameraBusyException(message: String) : Exception(message)
class EncoderInitException(message: String, cause: Throwable? = null) : Exception(message, cause)
