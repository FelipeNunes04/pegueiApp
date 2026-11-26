jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));

jest.mock('react-native-share', () => ({
  open: jest.fn().mockResolvedValue({}),
  shareSingle: jest.fn().mockResolvedValue({}),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}));

jest.mock('@react-native-firebase/analytics', () => ({
  __esModule: true,
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logScreenView: jest.fn().mockResolvedValue(undefined),
  setAnalyticsCollectionEnabled: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
  setUserProperties: jest.fn().mockResolvedValue(undefined),
}));

// Screens are tested against track()/screen() calls, not a provider. The
// analytics layer itself is tested with the real module (jest.unmock).
jest.mock('./src/analytics/track', () => {
  const actual = jest.requireActual('./src/analytics/track');
  return {
    ...actual,
    track: jest.fn(),
    screen: jest.fn(),
    identify: jest.fn(),
    setUserProperties: jest.fn(),
    initAnalytics: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('@react-native-firebase/app', () => ({}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('react-native-create-thumbnail', () => ({
  createThumbnail: jest.fn().mockResolvedValue({ path: '/mock/thumb.jpg', size: 0, mime: 'image/jpeg', width: 100, height: 100 }),
}));

jest.mock('react-native-video', () => {
  const React = require('react');
  const { forwardRef } = React;
  const MockVideo = forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      seek: jest.fn(),
      resume: jest.fn(),
      pause: jest.fn(),
      presentFullscreenPlayer: jest.fn(),
      dismissFullscreenPlayer: jest.fn(),
      restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn(),
      save: jest.fn(),
      setVolume: jest.fn(),
      getCurrentPosition: jest.fn().mockResolvedValue(0),
      setFullScreen: jest.fn(),
      setSource: jest.fn(),
      enterPictureInPicture: jest.fn(),
      exitPictureInPicture: jest.fn(),
    }));
    return React.createElement('Video', props);
  });
  return { __esModule: true, default: MockVideo };
});

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  CachesDirectoryPath: '/mock/caches',
  readDir: jest.fn().mockResolvedValue([]),
  unlink: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 0 }),
  downloadFile: jest.fn(() => ({ jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 10 }) })),
}));

jest.mock('react-native-in-app-review', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => true),
    RequestInAppReview: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('@react-native-firebase/remote-config', () => {
  const values = {};
  const rc = { defaultConfig: {}, settings: {} };
  return {
    __esModule: true,
    __setValues: next => {
      Object.keys(values).forEach(key => delete values[key]);
      Object.assign(values, next);
    },
    getRemoteConfig: jest.fn(() => rc),
    fetchAndActivate: jest.fn().mockResolvedValue(true),
    getBoolean: jest.fn((_rc, key) => {
      const value = key in values ? values[key] : rc.defaultConfig[key];
      return value === true || value === 'true';
    }),
    getString: jest.fn((_rc, key) => String(key in values ? values[key] : rc.defaultConfig[key] ?? '')),
  };
});
