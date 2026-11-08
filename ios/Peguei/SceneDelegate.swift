import UIKit
import React
import React_RCTAppDelegate

// Apps linked against the iOS 27 SDK must adopt the UIScene life cycle or
// UIKit aborts at launch (Apple TN3187). React Native starts here because the
// window now belongs to the scene, which doesn't exist yet when
// didFinishLaunching runs.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "Peguei",
      in: window,
      launchOptions: nil
    )
  }
}
