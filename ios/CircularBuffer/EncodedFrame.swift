import Foundation

/// A single already-encoded H.264 access unit (one or more NAL units) copied
/// out of a `CMSampleBuffer` produced by the hardware encoder. Copying the
/// bytes out (instead of retaining the `CMSampleBuffer`) keeps memory usage
/// predictable and avoids holding on to CVPixelBuffer-backed pools longer
/// than necessary.
struct EncodedFrame: Equatable {
    let data: Data
    let presentationTimeUs: Int64
    let isKeyFrame: Bool
}
