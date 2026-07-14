import CoreMedia

/// A single already-captured raw PCM audio chunk, copied out of a
/// `CMSampleBuffer` from `AVCaptureAudioDataOutput` immediately on arrival.
///
/// Bytes are copied out (instead of retaining the `CMSampleBuffer`, as an
/// earlier version of this type did) for the same reason `EncodedFrame`
/// copies video bytes out: `AVCaptureAudioDataOutput` hands out buffers from
/// a small internal pool, and retaining hundreds of them for the length of
/// the pre-roll window (15-60s) exhausts that pool, silently and
/// permanently halting further audio delivery for the rest of the
/// buffering session (confirmed on-device: delivery stalls forever after
/// ~125 buffers). `numSamples` is kept alongside so a valid PCM
/// `CMSampleBuffer` can be reconstructed later purely from these bytes, at
/// mux time -- see `CameraEncoderController.makeAudioSampleBuffer`.
struct AudioSampleFrame {
    let data: Data
    let presentationTimeUs: Int64
    let numSamples: Int
}

/// Pure ring buffer of copied-out audio chunks, mirroring `FrameRingBuffer`'s
/// eviction-by-time-window behavior.
final class AudioSampleRingBuffer {
    private var windowUs: Int64
    private var frames: [AudioSampleFrame] = []
    private let lock = NSLock()

    init(windowUs: Int64) {
        self.windowUs = windowUs
    }

    var size: Int {
        lock.lock(); defer { lock.unlock() }
        return frames.count
    }

    func add(_ frame: AudioSampleFrame) {
        lock.lock(); defer { lock.unlock() }
        frames.append(frame)
        guard let newestPts = frames.last?.presentationTimeUs else { return }
        while let oldestPts = frames.first?.presentationTimeUs, newestPts - oldestPts > windowUs {
            frames.removeFirst()
        }
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        frames.removeAll()
    }

    func snapshot() -> [AudioSampleFrame] {
        lock.lock(); defer { lock.unlock() }
        return frames
    }
}
