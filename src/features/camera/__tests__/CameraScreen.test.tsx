import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CameraScreen } from '../CameraScreen';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../settings/store/settingsStore';
import * as useCircularBufferModule from '../hooks/useCircularBuffer';
import * as useZoomModule from '../hooks/useZoom';

jest.mock('../hooks/useCircularBuffer');
jest.mock('../hooks/useZoom');
jest.mock('../hooks/usePinchToZoom', () => ({
  usePinchToZoom: () => ({}),
}));

const mockedUseCircularBuffer = useCircularBufferModule.useCircularBuffer as jest.Mock;
const mockedUseZoom = useZoomModule.useZoom as jest.Mock;

const navigateMock = jest.fn();
const replaceMock = jest.fn();
const addListenerMock = jest.fn(() => jest.fn());
const fakeNavigation = { navigate: navigateMock, replace: replaceMock, addListener: addListenerMock } as never;

function baseCircularBuffer(overrides: Partial<ReturnType<typeof useCircularBufferModule.useCircularBuffer>> = {}) {
  return {
    phase: 'buffering',
    start: jest.fn(),
    stop: jest.fn(),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    ...overrides,
  };
}

describe('CameraScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [] });
    useSettingsStore.setState(DEFAULT_SETTINGS);
    mockedUseZoom.mockReturnValue({ zoomFactor: 1, minZoom: 1, maxZoom: 1, hasUltraWide: false, pillLevels: [], setZoom: jest.fn() });
  });

  it('renders the "buffering" state with the buffer indicator active and no error banner', async () => {
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ phase: 'buffering' }));

    const { queryByTestId, getByTestId } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    expect(queryByTestId('camera-screen')).toBeTruthy();
    expect(getByTestId('buffer-indicator')).toBeTruthy();
    expect(queryByTestId('error-banner')).toBeNull();
  });

  it('renders the error state with a dismissible banner', async () => {
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ phase: 'error' }));
    useRecordingStore.setState({ errorMessage: 'Câmera ocupada por outro app.', phase: 'error', clips: [] });

    const { queryByTestId, getByText } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    expect(queryByTestId('error-banner')).toBeTruthy();
    expect(getByText('Câmera ocupada por outro app.')).toBeTruthy();
  });

  it('renders the "saving" state while a clip is being written', async () => {
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ phase: 'saving' }));

    const { getByTestId } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    expect(getByTestId('record-button').props.accessibilityState.disabled).toBe(true);
  });

  it('tapping the record button while buffering starts a manual recording', async () => {
    const startRecording = jest.fn();
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ phase: 'buffering', startRecording }));

    const { getByTestId } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    await act(async () => {
      fireEvent.press(getByTestId('record-button'));
    });

    expect(startRecording).toHaveBeenCalled();
  });

  it('tapping the record button while recording stops and saves the clip', async () => {
    const stopRecording = jest.fn();
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ phase: 'recording', stopRecording }));

    const { getByTestId } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    await act(async () => {
      fireEvent.press(getByTestId('record-button'));
    });

    expect(stopRecording).toHaveBeenCalled();
  });

  // Regression test for the bug where a settings change (buffer seconds,
  // quality, fps) made on SettingsScreen had no effect on an already-running
  // buffer: React Navigation's native-stack keeps CameraScreen mounted
  // underneath Settings, so its start()/stop() effect only re-applies a
  // config change if it depends on the hook's start/stop identities (which
  // useCircularBuffer changes whenever the underlying settings change) --
  // not on an empty array. Simulating a settings change here as a new
  // start/stop identity (independent of useCircularBuffer's own internals,
  // covered separately in useCircularBuffer.test.ts) isolates CameraScreen's
  // half of that contract.
  it('tears down the old buffer and starts a new one when start/stop identity changes (e.g. after a settings change)', async () => {
    const firstStart = jest.fn();
    const firstStop = jest.fn();
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ start: firstStart, stop: firstStop }));

    const { rerender } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);
    expect(firstStart).toHaveBeenCalledTimes(1);

    const secondStart = jest.fn();
    const secondStop = jest.fn();
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer({ start: secondStart, stop: secondStop }));

    await act(async () => {
      rerender(<CameraScreen navigation={fakeNavigation} route={{} as never} />);
    });

    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
  });

  it('navigates to Gallery and Settings from the top bar', async () => {
    mockedUseCircularBuffer.mockReturnValue(baseCircularBuffer());

    const { getByTestId } = await render(<CameraScreen navigation={fakeNavigation} route={{} as never} />);

    await act(async () => {
      fireEvent.press(getByTestId('open-gallery'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('open-settings'));
    });

    expect(navigateMock).toHaveBeenCalledWith('Gallery');
    expect(navigateMock).toHaveBeenCalledWith('Settings');
  });
});
