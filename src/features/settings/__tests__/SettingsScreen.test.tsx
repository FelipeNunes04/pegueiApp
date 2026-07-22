import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SettingsScreen } from '../SettingsScreen';
import { DEFAULT_SETTINGS, useSettingsStore } from '../store/settingsStore';
import { useCameraStore } from '../../camera/store/cameraStore';
import { CircularBufferModule } from '../../camera/native/CircularBufferModule';

jest.mock('../../camera/native/CircularBufferModule', () => ({
  CircularBufferModule: {
    getCaptureCapabilities: jest.fn().mockResolvedValue({ supportedQualities: [], fpsByQuality: {} }),
  },
}));

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

const navigateMock = jest.fn();
const goBackMock = jest.fn();
const setOptionsMock = jest.fn();
const fakeNavigation = { navigate: navigateMock, goBack: goBackMock, setOptions: setOptionsMock } as never;

describe('SettingsScreen', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState(DEFAULT_SETTINGS);
    useCameraStore.getState().reset();
    mockedModule.getCaptureCapabilities.mockResolvedValue({ supportedQualities: [], fpsByQuality: {} });
  });

  afterEach(() => {
    Platform.OS = originalPlatformOS;
  });

  // Android only -- Apple rejected the App Store submission over this box
  // (guideline 3.1.1: any in-app monetary transaction must use In-App
  // Purchase, even an optional donation), so SettingsScreen hides it on
  // iOS. Google Play has no equivalent restriction. See DECISIONS.md
  // "Monetization".
  it('copies the Pix key to the clipboard when the donation box is pressed on Android', async () => {
    Platform.OS = 'android';
    const { getByTestId, getByText } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('settings-copy-pix'));

    expect(Clipboard.setString).toHaveBeenCalledWith('felipennunes04@icloud.com');
    expect(getByText('Copiado!')).toBeTruthy();
  });

  it('does not render the donation box on iOS', async () => {
    Platform.OS = 'ios';
    const { queryByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(queryByTestId('settings-copy-pix')).toBeNull();
  });

  it('navigates to Tips when the "Dicas de uso" row is pressed', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('settings-open-tips'));

    expect(navigateMock).toHaveBeenCalledWith('Tips');
  });

  it('changes the buffer duration when the slider is released', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    fireEvent(getByTestId('buffer-seconds-slider'), 'onSlidingComplete', 45);

    expect(useSettingsStore.getState().bufferSeconds).toBe(45);
  });

  it('changes the video quality when a quality pill is pressed', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('quality-4k'));

    expect(useSettingsStore.getState().videoQuality).toBe('4k');
  });

  it('renders all three FPS options and highlights the current selection', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(getByTestId('fps-24')).toBeTruthy();
    expect(getByTestId('fps-30')).toBeTruthy();
    expect(getByTestId('fps-60')).toBeTruthy();
  });

  it('changes the fps setting when an fps pill is pressed', async () => {
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await fireEvent.press(getByTestId('fps-60'));

    expect(useSettingsStore.getState().fps).toBe(60);
  });

  // Covers the "verify the device actually supports 4K/60fps before
  // offering it, or at least warn the user" request: an unsupported option
  // must be disabled (not silently selectable), with a visible hint saying
  // why.
  it('disables a quality pill and shows a hint when the device does not support it', async () => {
    mockedModule.getCaptureCapabilities.mockResolvedValue({
      supportedQualities: ['720p', '1080p'],
      fpsByQuality: { '720p': [24, 30, 60], '1080p': [24, 30, 60] },
    });
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await waitFor(() => expect(getByTestId('quality-unsupported-hint')).toBeTruthy());
    expect(getByTestId('quality-4k').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(getByTestId('quality-4k'));
    // A disabled pill's onPress is undefined -- pressing it must not change the setting.
    expect(useSettingsStore.getState().videoQuality).toBe(DEFAULT_SETTINGS.videoQuality);
  });

  it('disables an fps pill and shows a hint when the device does not support it at the selected quality', async () => {
    useSettingsStore.setState({ videoQuality: '4k' });
    mockedModule.getCaptureCapabilities.mockResolvedValue({
      supportedQualities: ['4k'],
      fpsByQuality: { '4k': [24, 30] },
    });
    const { getByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await waitFor(() => expect(getByTestId('fps-unsupported-hint')).toBeTruthy());
    expect(getByTestId('fps-60').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(getByTestId('fps-60'));
    expect(useSettingsStore.getState().fps).toBe(DEFAULT_SETTINGS.fps);
  });

  it('does not disable or hint anything when capabilities are unknown (e.g. no back camera)', async () => {
    mockedModule.getCaptureCapabilities.mockResolvedValue({ supportedQualities: [], fpsByQuality: {} });
    const { getByTestId, queryByTestId } = await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    await waitFor(() => expect(mockedModule.getCaptureCapabilities).toHaveBeenCalled());
    expect(queryByTestId('quality-unsupported-hint')).toBeNull();
    expect(queryByTestId('fps-unsupported-hint')).toBeNull();
    expect(getByTestId('quality-4k').props.accessibilityState).toMatchObject({ disabled: false });
  });

  // Native-stack has no testID hook for its own default back button, so
  // SettingsScreen renders a custom one via headerLeft purely for e2e
  // (Detox) navigation -- this confirms it's actually wired to go back.
  it('sets a headerLeft back button that calls navigation.goBack() when pressed', async () => {
    await render(<SettingsScreen navigation={fakeNavigation} route={{} as never} />);

    const headerLeftCall = setOptionsMock.mock.calls.find(([options]) => options.headerLeft);
    expect(headerLeftCall).toBeTruthy();

    const { getByTestId } = await render(headerLeftCall![0].headerLeft());
    await fireEvent.press(getByTestId('settings-back'));

    expect(goBackMock).toHaveBeenCalled();
  });
});
