/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  artifacts: {
    rootDir: './screenshots',
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/DerivedData/Build/Products/Debug-iphonesimulator/Peguei.app',
      build:
        'xcodebuild -workspace ios/Peguei.xcworkspace -scheme Peguei -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build/DerivedData',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
      build:
        'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..',
      reversePorts: [8081],
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 15' },
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_API_34' },
    },
    // App Store screenshot sizes: 6.9" (required) and 6.5" (legacy size
    // class App Store Connect still accepts screenshots for).
    simulator69: {
      type: 'ios.simulator',
      device: { type: 'iPhone 16 Pro Max' },
    },
    simulator65: {
      type: 'ios.simulator',
      // Pinned to iOS 17.5: this device type predates the newer runtimes
      // installed on this Mac, so the default (latest) runtime can't boot it.
      device: { type: 'iPhone 11 Pro Max', os: 'iOS 17.5' },
    },
    simulatorIpad13: {
      type: 'ios.simulator',
      // App Store Connect's "13-inch iPad Display" bucket, required because
      // the app is built universal (TARGETED_DEVICE_FAMILY = "1,2").
      device: { type: 'iPad Pro 13-inch (M4)' },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'ios.sim.screenshots.69': {
      device: 'simulator69',
      app: 'ios.debug',
    },
    'ios.sim.screenshots.65': {
      device: 'simulator65',
      app: 'ios.debug',
    },
    'ios.sim.screenshots.ipad13': {
      device: 'simulatorIpad13',
      app: 'ios.debug',
    },
  },
};
