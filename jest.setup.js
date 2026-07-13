jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));

jest.mock('react-native-share', () => ({
  open: jest.fn().mockResolvedValue({}),
  shareSingle: jest.fn().mockResolvedValue({}),
}));

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
}));
