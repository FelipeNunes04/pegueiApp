import UIKit
import AVFoundation

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
    }

    private func attach() {
        CameraEncoderController.shared.attachPreviewLayer(videoPreviewLayer)
    }
}
