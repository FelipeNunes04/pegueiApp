import React

@objc(CircularBufferPreviewViewManager)
class CircularBufferPreviewViewManager: RCTViewManager {
    override func view() -> UIView! {
        return CircularBufferPreviewView()
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }
}
