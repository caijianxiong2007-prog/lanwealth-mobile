// Xcode 27 / iOS 27 SDK 起, 未声明 UIApplicationSceneManifest 的 App 启动即被
// UIKit 以 "No Scene Lifecycle Adoption" 运行时断言杀死。Expo SDK 53 模板缺这个键
// 与场景委托(SDK 54 才补), 本插件按 SDK 54 的做法补齐 Info.plist 清单 + AppDelegate。
const { withInfoPlist, withAppDelegate } = require('expo/config-plugins');

// 把窗口创建从 didFinishLaunching 搬进 SceneDelegate, 并桥接 openURLContexts。
const APP_DELEGATE_SWIFT = `import Expo
import React
import ReactAppDependencyProvider

// Xcode 27 / iOS 27 SDK 起, 未采纳 Scene Lifecycle 的 App 启动即被 UIKit 断言杀死
// (RN 0.79 / Expo SDK 53 模板尚无场景支持, 本文件按 Expo SDK 54 的做法手工补齐)。
@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  // RN 内部(如 RCTDeviceInfo)会读 appDelegate.window — Scene 时代由 SceneDelegate 同步赋值
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)
    self.launchOptions = launchOptions

    // 窗口与 RN 视图改在 SceneDelegate.scene(_:willConnectTo:) 里创建(见文件底部)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

// Scene Lifecycle 采纳:窗口在此创建并挂 RN 视图;深链 URL 经 openURLContexts 转发回
// RCTLinkingManager(RN 0.79 无场景回调,手工桥接回应用级接口)。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: appDelegate.launchOptions)
    self.window = window
    appDelegate.window = window

    if !connectionOptions.urlContexts.isEmpty {
      for context in connectionOptions.urlContexts {
        RCTLinkingManager.application(
          UIApplication.shared, open: context.url, options: [:])
      }
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(
        UIApplication.shared, open: context.url, options: [:])
    }
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

module.exports = function withSceneManifest(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language === 'swift') {
      cfg.modResults.contents = APP_DELEGATE_SWIFT;
    }
    return cfg;
  });
  return config;
};
