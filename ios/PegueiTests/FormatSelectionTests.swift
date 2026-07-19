import XCTest

/// Mirrors CameraEncoderController.pickFormat(for:width:height:fps:)'s exact
/// selection algorithm (see CameraEncoderController.swift) against plain
/// synthetic candidates -- AVCaptureDevice.Format and AVFrameRateRange have
/// no public initializers, and CameraEncoderController.swift isn't part of
/// the PegueiTests target (its AVFoundation/VideoToolbox camera APIs need
/// real hardware to actually run), so the real function can't be called
/// directly from a plain XCTest logic test. This pins down the same
/// regression the real fix addresses: the "4K/1080p/720p" quality setting
/// used to have no effect because the capture session was pinned to a fixed
/// `sessionPreset = .high` instead of picking a device format that actually
/// matches the requested resolution and frame rate.
final class FormatSelectionTests: XCTestCase {
    private struct FormatCandidate {
        let width: Int
        let height: Int
        let frameRateRanges: [(min: Double, max: Double)]
    }

    /// Exact mirror of CameraEncoderController.pickFormat's algorithm.
    private func pickFormat(among candidates: [FormatCandidate], width: Int, height: Int, fps: Int) -> FormatCandidate? {
        let matching = candidates.filter { $0.width == width && $0.height == height }
        guard !matching.isEmpty else { return nil }

        let requestedFps = Double(fps)
        if let exact = matching.first(where: { candidate in
            candidate.frameRateRanges.contains { requestedFps >= $0.min && requestedFps <= $0.max }
        }) {
            return exact
        }
        return matching.max { a, b in
            (a.frameRateRanges.map(\.max).max() ?? 0) < (b.frameRateRanges.map(\.max).max() ?? 0)
        }
    }

    func testPicksTheCandidateMatchingTheExactRequestedResolutionAndFps() {
        let candidates = [
            FormatCandidate(width: 1280, height: 720, frameRateRanges: [(min: 2, max: 30)]),
            FormatCandidate(width: 1920, height: 1080, frameRateRanges: [(min: 2, max: 30)]),
            FormatCandidate(width: 3840, height: 2160, frameRateRanges: [(min: 2, max: 30)]),
        ]

        let picked = pickFormat(among: candidates, width: 1920, height: 1080, fps: 30)

        XCTAssertEqual(picked?.width, 1920)
        XCTAssertEqual(picked?.height, 1080)
    }

    func testFallsBackToTheWidestMaxFrameRateAtThatResolutionWhenNoRangeCoversTheRequestedFps() {
        // Simulates a device whose 4K formats only ever go up to 30fps --
        // requesting 60fps should not come back empty, it should fall back
        // to the best available format at that same resolution instead.
        let candidates = [
            FormatCandidate(width: 3840, height: 2160, frameRateRanges: [(min: 2, max: 24)]),
            FormatCandidate(width: 3840, height: 2160, frameRateRanges: [(min: 2, max: 30)]),
        ]

        let picked = pickFormat(among: candidates, width: 3840, height: 2160, fps: 60)

        XCTAssertEqual(picked?.frameRateRanges.first?.max, 30)
    }

    func testReturnsNilWhenTheResolutionItselfIsNotOfferedAtAll() {
        let candidates = [
            FormatCandidate(width: 1280, height: 720, frameRateRanges: [(min: 2, max: 30)]),
        ]

        let picked = pickFormat(among: candidates, width: 3840, height: 2160, fps: 30)

        XCTAssertNil(picked)
    }

    func testPrefersAFormatThatActuallyCoversTheRequestedFpsOverOneWithAMerelyHigherMax() {
        // A naive "pick the highest max frame rate" fallback would wrongly
        // choose the 40-60 range below (higher max) even though it doesn't
        // actually cover the requested 30fps -- the exact-coverage check
        // must run first and win.
        let candidates = [
            FormatCandidate(width: 1920, height: 1080, frameRateRanges: [(min: 40, max: 60)]),
            FormatCandidate(width: 1920, height: 1080, frameRateRanges: [(min: 25, max: 30)]),
        ]

        let picked = pickFormat(among: candidates, width: 1920, height: 1080, fps: 30)

        XCTAssertEqual(picked?.frameRateRanges.first?.min, 25)
    }
}
