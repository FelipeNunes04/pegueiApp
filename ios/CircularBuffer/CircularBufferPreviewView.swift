import UIKit
import AVFoundation
import AVKit

/// Bridges an AVCaptureVideoPreviewLayer to CameraEncoderController, which
/// owns the actual AVCaptureSession. The view itself has no camera logic --
/// it just hands its layer's session over once mounted.
final class CircularBufferPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    private var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        // swiftlint:disable:next force_cast
        layer as! AVCaptureVideoPreviewLayer
    }

    // @objc dynamic is required for RCT_EXPORT_VIEW_PROPERTY's KVC-based
    // -setIsActive: to actually find this property -- without it, Swift
    // doesn't expose the setter to the Objective-C runtime at all, and the
    // very first prop update after mount crashes with
    // "unrecognized selector sent to instance".
    @objc dynamic var isActive: Bool = true {
        didSet {
            guard isActive != oldValue else { return }
            if isActive {
                attach()
            } else {
                CameraEncoderController.shared.detachPreviewLayer()
            }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        videoPreviewLayer.videoGravity = .resizeAspectFill
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        videoPreviewLayer.videoGravity = .resizeAspectFill
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil, isActive {
            attach()
        } else if window == nil {
            CameraEncoderController.shared.detachPreviewLayer()
        }
        // The hardware-trigger interaction has to live on a view that's in
        // the hierarchy while the camera is in use; this view is exactly
        // that, so it hosts it whenever it's on screen.
        if window != nil {
            HardwareTriggerCoordinator.shared.register(hostView: self)
        } else {
            HardwareTriggerCoordinator.shared.unregister(hostView: self)
        }
    }

    private func attach() {
        CameraEncoderController.shared.attachPreviewLayer(videoPreviewLayer)
    }
}

/// Owns the optional `AVCaptureEventInteraction` that turns hardware
/// buttons into record start/stop triggers (`setHardwareTriggerEnabled`).
/// Main thread only. Kept separate from the view because the two lifetimes
/// differ: JS toggles the setting whenever it likes (possibly before the
/// preview view mounts), and the view comes and goes with navigation -- the
/// interaction is attached only while both "enabled" and "a host view is on
/// screen" hold, and moved/removed as either changes.
///
/// What can be told apart (iOS 17.2+ AVKit, checked against the iOS 26.2
/// SDK headers): AVCaptureEventInteraction exposes only a *primary* and a
/// *secondary* handler, and `AVCaptureEvent` carries just a `phase` -- no
/// input source. Per Apple's documentation, the secondary action is the
/// volume **up** button, and the primary action is the volume **down**
/// button *and* the Camera Control button (iPhone 16 and later), plus the
/// Action button / AirPods stem click when those are routed to the camera
/// app -- indistinguishable from each other in the callback. So:
/// secondary -> `volumeUp`; primary -> `captureButton` (the generic "primary
/// capture button" -- reporting `volumeDown` would be wrong whenever the
/// Camera Control was the button actually pressed). JS treats every source
/// the same (toggle recording), so this only matters for analytics/logs.
/// A trigger fires on `.ended` (button released), matching the contract
/// and Apple's own sample; `.began`/`.cancelled` are ignored.
///
/// While attached, iOS routes these buttons to the app instead of changing
/// the volume -- the whole point, but also why it's opt-out-able in
/// Settings and why it must be detached when disabled (Apple: "If your app
/// is temporarily unable to handle events, disable the interaction").
final class HardwareTriggerCoordinator {
    static let shared = HardwareTriggerCoordinator()

    /// Receives the contract's `source` string. Set by CircularBufferModule.
    var onTrigger: ((String) -> Void)?

    private var isEnabled = false
    private weak var hostView: UIView?
    private var interaction: UIInteraction?

    private init() {}

    func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        sync()
    }

    func register(hostView view: UIView) {
        hostView = view
        sync()
    }

    func unregister(hostView view: UIView) {
        guard hostView === view else { return }
        hostView = nil
        sync()
    }

    private func sync() {
        if let interaction, !isEnabled || interaction.view !== hostView || hostView == nil {
            interaction.view?.removeInteraction(interaction)
            self.interaction = nil
        }
        guard isEnabled, let hostView, interaction == nil else { return }
        guard #available(iOS 17.2, *) else { return }
        let newInteraction = AVCaptureEventInteraction(
            primary: { [weak self] event in
                guard event.phase == .ended else { return }
                self?.fire("captureButton")
            },
            secondary: { [weak self] event in
                guard event.phase == .ended else { return }
                self?.fire("volumeUp")
            }
        )
        hostView.addInteraction(newInteraction)
        interaction = newInteraction
    }

    private func fire(_ source: String) {
        onTrigger?(source)
    }
}
