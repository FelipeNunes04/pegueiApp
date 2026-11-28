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

    // A cold start from a link (peguei://camera?from=pesca_certa...): with
    // scenes the URL arrives here, not in didFinishLaunching, so hand it to
    // React Native as the launch URL for Linking.getInitialURL().
    var launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions = [.url: url]
    }

    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "Peguei",
      in: window,
      launchOptions: launchOptions
    )
  }

  // A link while the app is already running: React Native's Linking 'url' event.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }
}
