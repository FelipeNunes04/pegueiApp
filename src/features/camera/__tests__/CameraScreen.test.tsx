import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CameraScreen } from '../CameraScreen';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../settings/store/settingsStore';
import * as useCircularBufferModule from '../hooks/useCircularBuffer';
import * as useZoomModule from '../hooks/useZoom';
import { CircularBufferModule, circularBufferEvents } from '../native/CircularBufferModule';

jest.mock('../native/CircularBufferModule', () => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    CircularBufferPreview: 'CircularBufferPreviewView',
    CircularBufferModule: {
      setPocketMode: jest.fn().mockResolvedValue(undefined),
      setHardwareTriggerEnabled: jest.fn().mockResolvedValue(undefined),
    },
    circularBufferEvents: {
      addListener: jest.fn((eventName: string, handler: (event: unknown) => void) => {
        listeners[eventName] = listeners[eventName] ?? [];
        listeners[eventName].push(handler);
        return {
          remove: jest.fn(() => {
            listeners[eventName] = listeners[eventName].filter(h => h !== handler);
          }),
        };
      }),
      __emit: (eventName: string, payload: unknown) => {
        (listeners[eventName] ?? []).forEach(handler => handler(payload));
      },
    },
  };
});

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
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [], bufferHealth: 'healthy' });
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

const mockedNative = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;
const emitTrigger = (source = 'volumeUp') =>
  (circularBufferEvents as unknown as { __emit: (name: string, p: unknown) => void }).__emit(
    'CircularBufferHardwareTrigger',
    { source },
  );

// Navigation double that actually keeps focus/blur listeners, so tests can
// simulate pushing Gallery/Settings on top of the camera.
function makeNavigation() {
  const listeners: Record<string, (() => void)[]> = {};
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    addListener: jest.fn((event: string, cb: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return () => {
        listeners[event] = listeners[event].filter(l => l !== cb);
      };
    }),
  };
  const fire = (event: string) => (listeners[event] ?? []).forEach(cb => cb());
  return { navigation: navigation as never, fire };
}

describe('CameraScreen reliability/battery features', () => {
  const { Animated } = require('react-native');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // The JS pulse loops would otherwise schedule a frame every 16 ms of the
    // hours of fake time these tests advance through.
    jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [], bufferHealth: 'healthy' });
    useSettingsStore.setState(DEFAULT_SETTINGS);
    mockedUseZoom.mockReturnValue({ zoomFactor: 1, minZoom: 1, maxZoom: 1, hasUltraWide: false, pillLevels: [], setZoom: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function renderScreen(overrides: Partial<ReturnType<typeof useCircularBufferModule.useCircularBuffer>> = {}) {
    const buffer = baseCircularBuffer(overrides);
    mockedUseCircularBuffer.mockReturnValue(buffer);
    const { navigation, fire } = makeNavigation();
    const utils = await render(<CameraScreen navigation={navigation} route={{} as never} />);
    const rerenderWith = async (next: Partial<ReturnType<typeof useCircularBufferModule.useCircularBuffer>>) => {
      Object.assign(buffer, next);
      mockedUseCircularBuffer.mockReturnValue({ ...buffer });
      await act(async () => {
        utils.rerender(<CameraScreen navigation={navigation} route={{} as never} />);
      });
    };
    return { ...utils, buffer, fire, navigation, rerenderWith };
  }

  describe('pocket mode', () => {
    it('enters from the camera button (dimming natively) and exits on a single tap', async () => {
      const { getByTestId, queryByTestId } = await renderScreen({ phase: 'buffering' });

      await act(async () => {
        fireEvent.press(getByTestId('enter-pocket-mode'));
      });
      expect(getByTestId('pocket-mode-overlay')).toBeTruthy();
      expect(getByTestId('pocket-mode-status').props.children).toBe('Sempre gravando');
      expect(mockedNative.setPocketMode).toHaveBeenLastCalledWith(true);

      await act(async () => {
        fireEvent.press(getByTestId('pocket-mode-overlay'));
      });
      expect(queryByTestId('pocket-mode-overlay')).toBeNull();
      expect(mockedNative.setPocketMode).toHaveBeenLastCalledWith(false);
    });

    it('hides the manual button when the buffer is not running', async () => {
      const { queryByTestId } = await renderScreen({ phase: 'idle' });
      expect(queryByTestId('enter-pocket-mode')).toBeNull();
    });

    it('auto-enters after 20 s without touches; a touch restarts the countdown', async () => {
      const { getByTestId, queryByTestId } = await renderScreen({ phase: 'buffering' });

      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      await act(async () => {
        fireEvent(getByTestId('camera-screen'), 'touchStart');
      });
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(queryByTestId('pocket-mode-overlay')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(getByTestId('pocket-mode-overlay')).toBeTruthy();
    });

    it('exits when navigating away (blur)', async () => {
      const { getByTestId, queryByTestId, fire } = await renderScreen({ phase: 'buffering' });
      await act(async () => {
        fireEvent.press(getByTestId('enter-pocket-mode'));
      });

      await act(async () => {
        fire('blur');
      });
      expect(queryByTestId('pocket-mode-overlay')).toBeNull();
      expect(mockedNative.setPocketMode).toHaveBeenLastCalledWith(false);
    });

    it('restores the screen on unmount', async () => {
      const { getByTestId, unmount } = await renderScreen({ phase: 'buffering' });
      await act(async () => {
        fireEvent.press(getByTestId('enter-pocket-mode'));
      });
      await unmount();
      expect(mockedNative.setPocketMode).toHaveBeenLastCalledWith(false);
    });
  });

  describe('hardware triggers', () => {
    it('starts recording while buffering and stops while recording, debounced', async () => {
      const { buffer, rerenderWith } = await renderScreen({ phase: 'buffering' });
      expect(mockedNative.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(true);

      await act(async () => {
        emitTrigger('volumeUp');
        emitTrigger('enter'); // same physical click on a BT remote -- dropped
      });
      expect(buffer.startRecording).toHaveBeenCalledTimes(1);

      await rerenderWith({ phase: 'recording' });
      await act(async () => {
        jest.advanceTimersByTime(700);
        emitTrigger('volumeDown');
      });
      expect(buffer.stopRecording).toHaveBeenCalledTimes(1);
    });

    it('is ignored while a clip is saving', async () => {
      const { buffer } = await renderScreen({ phase: 'saving' });
      await act(async () => {
        emitTrigger();
      });
      expect(buffer.startRecording).not.toHaveBeenCalled();
      expect(buffer.stopRecording).not.toHaveBeenCalled();
    });

    it('works inside pocket mode without leaving it', async () => {
      const { buffer, getByTestId } = await renderScreen({ phase: 'buffering' });
      await act(async () => {
        fireEvent.press(getByTestId('enter-pocket-mode'));
      });
      await act(async () => {
        emitTrigger('media');
      });
      expect(buffer.startRecording).toHaveBeenCalledTimes(1);
      expect(getByTestId('pocket-mode-overlay')).toBeTruthy();
    });

    it('is not enabled when the setting is off, and is released on blur', async () => {
      useSettingsStore.setState({ hardwareTriggersEnabled: false });
      const off = await renderScreen({ phase: 'buffering' });
      expect(mockedNative.setHardwareTriggerEnabled).not.toHaveBeenCalled();
      await act(async () => {
        emitTrigger();
      });
      expect(off.buffer.startRecording).not.toHaveBeenCalled();
      await off.unmount();

      useSettingsStore.setState({ hardwareTriggersEnabled: true });
      const on = await renderScreen({ phase: 'buffering' });
      expect(mockedNative.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(true);
      await act(async () => {
        on.fire('blur');
      });
      expect(mockedNative.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(false);
    });
  });

  it('shows the native buffer health in the indicator', async () => {
    useRecordingStore.setState({ bufferHealth: 'recovering' });
    const { getByTestId } = await renderScreen({ phase: 'buffering' });

    expect(getByTestId('buffer-indicator-sublabel').props.children).toBe('30s · Recuperando…');
  });

  describe('auto-stop after inactivity', () => {
    it('never fires with the default "Nunca"', async () => {
      const { buffer } = await renderScreen({ phase: 'buffering' });
      await act(async () => {
        jest.advanceTimersByTime(3 * 60 * 60_000);
      });
      expect(buffer.stop).not.toHaveBeenCalled();
    });

    it('stops the buffer after the configured time, shows a clear state and resumes on "Retomar"', async () => {
      useSettingsStore.setState({ autoStopMinutes: 30, pocketModeAutoEnabled: false });
      const { buffer, getByTestId, queryByTestId, rerenderWith } = await renderScreen({ phase: 'buffering' });

      await act(async () => {
        jest.advanceTimersByTime(30 * 60_000);
      });
      expect(buffer.stop).toHaveBeenCalledTimes(1);

      await rerenderWith({ phase: 'idle' });
      expect(getByTestId('auto-stopped-overlay')).toBeTruthy();
      expect(mockedNative.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(false);

      const startCallsBefore = (buffer.start as jest.Mock).mock.calls.length;
      await act(async () => {
        fireEvent.press(getByTestId('resume-buffer'));
      });
      expect(buffer.start).toHaveBeenCalledTimes(startCallsBefore + 1);
      expect(queryByTestId('auto-stopped-overlay')).toBeNull();
    });

    it('touches and hardware triggers count as activity, and recording pauses the countdown', async () => {
      useSettingsStore.setState({ autoStopMinutes: 30, pocketModeAutoEnabled: false });
      const { buffer, getByTestId, rerenderWith } = await renderScreen({ phase: 'buffering' });

      await act(async () => {
        jest.advanceTimersByTime(20 * 60_000);
      });
      await act(async () => {
        fireEvent(getByTestId('camera-screen'), 'touchStart');
      });
      await act(async () => {
        jest.advanceTimersByTime(20 * 60_000);
      });
      expect(buffer.stop).not.toHaveBeenCalled();

      await act(async () => {
        emitTrigger();
      });
      await rerenderWith({ phase: 'recording' });
      await act(async () => {
        jest.advanceTimersByTime(60 * 60_000);
      });
      expect(buffer.stop).not.toHaveBeenCalled();

      // Back to plain buffering: a fresh full countdown.
      await rerenderWith({ phase: 'buffering' });
      await act(async () => {
        jest.advanceTimersByTime(29 * 60_000);
      });
      expect(buffer.stop).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(buffer.stop).toHaveBeenCalledTimes(1);
    });

    it('clears the stopped state by itself once the buffer is running again (e.g. restarted on return to foreground)', async () => {
      useSettingsStore.setState({ autoStopMinutes: 30, pocketModeAutoEnabled: false });
      const { queryByTestId, rerenderWith } = await renderScreen({ phase: 'buffering' });
      await act(async () => {
        jest.advanceTimersByTime(30 * 60_000);
      });
      await rerenderWith({ phase: 'idle' });
      expect(queryByTestId('auto-stopped-overlay')).toBeTruthy();

      await rerenderWith({ phase: 'buffering' });
      await rerenderWith({ phase: 'idle' });
      expect(queryByTestId('auto-stopped-overlay')).toBeNull();
    });
  });
});
