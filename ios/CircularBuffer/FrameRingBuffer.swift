import Foundation

/// Pure, AVFoundation-free ring buffer of already-encoded frames.
///
/// Frames are expected to arrive in non-decreasing presentation-time order.
/// The buffer evicts frames older than `windowUs` every time a new frame is
/// appended, so memory stays bounded regardless of how long buffering runs.
///
/// This type has zero AVFoundation/UIKit dependency so it can run under
/// plain XCTest unit tests (no simulator camera or device needed).
final class FrameRingBuffer {
    private(set) var windowUs: Int64
    private var frames: [EncodedFrame] = []
    private let lock = NSLock()

    init(windowUs: Int64) {
        self.windowUs = windowUs
    }

    var size: Int {
        lock.lock(); defer { lock.unlock() }
        return frames.count
    }

    func updateWindow(_ newWindowUs: Int64) {
        lock.lock(); defer { lock.unlock() }
        windowUs = newWindowUs
        evictOldFrames()
    }

    func add(_ frame: EncodedFrame) {
        lock.lock(); defer { lock.unlock() }
        frames.append(frame)
        evictOldFrames()
    }

    /// Must be called while holding `lock`.
    private func evictOldFrames() {
        guard let newestPts = frames.last?.presentationTimeUs else { return }
        while let oldestPts = frames.first?.presentationTimeUs, newestPts - oldestPts > windowUs {
            frames.removeFirst()
        }
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        frames.removeAll()
    }

    func snapshot() -> [EncodedFrame] {
        lock.lock(); defer { lock.unlock() }
        return frames
    }

    /// Returns every buffered frame starting at the oldest keyframe, so the
    /// result can be fed to AVAssetWriter as a decodable clip. If the buffer
    /// holds no keyframe at all (GOP longer than the buffer window) every
    /// currently buffered frame is returned instead of failing -- callers
    /// must never crash or throw here, they just get a clip that starts
    /// mid-GOP.
    func snapshotFromOldestKeyframe() -> [EncodedFrame] {
        lock.lock(); defer { lock.unlock() }
        guard let firstKeyframeIndex = frames.firstIndex(where: { $0.isKeyFrame }), firstKeyframeIndex > 0 else {
            return frames
        }
        return Array(frames[firstKeyframeIndex...])
    }
}
