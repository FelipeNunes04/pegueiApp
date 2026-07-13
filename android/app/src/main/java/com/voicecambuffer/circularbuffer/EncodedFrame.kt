package com.voicecambuffer.circularbuffer

/**
 * A single already-encoded H.264 access unit copied out of a MediaCodec
 * output buffer. Copying (instead of holding a reference to the codec's
 * internal ByteBuffer) is required because MediaCodec recycles those
 * buffers as soon as they are released back via releaseOutputBuffer.
 */
data class EncodedFrame(
    val data: ByteArray,
    val presentationTimeUs: Long,
    val isKeyFrame: Boolean,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EncodedFrame) return false
        return presentationTimeUs == other.presentationTimeUs &&
            isKeyFrame == other.isKeyFrame &&
            data.contentEquals(other.data)
    }

    override fun hashCode(): Int {
        var result = data.contentHashCode()
        result = 31 * result + presentationTimeUs.hashCode()
        result = 31 * result + isKeyFrame.hashCode()
        return result
    }
}
