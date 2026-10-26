import { Platform } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useCircularBuffer } from '../hooks/useCircularBuffer';
import { useCameraStore } from '../store/cameraStore';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../settings/store/settingsStore';
import { CircularBufferModule, circularBufferEvents } from '../native/CircularBufferModule';

jest.mock('../native/CircularBufferModule', () => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    CircularBufferModule: {
      startBuffering: jest.fn().mockResolvedValue(undefined),
      stopBuffering: jest.fn().mockResolvedValue(undefined),
      startManualRecording: jest.fn().mockResolvedValue(undefined),
      stopManualRecording: jest.fn().mockResolvedValue({ path: '/clips/clip_1.mp4', durationSeconds: 12 }),
      playRecordingStartSound: jest.fn(),
      playRecordingStopSound: jest.fn(),
      isBuffering: jest.fn().mockResolvedValue(true),
      // Empty/unknown by default -- resolveSupportedQuality/Fps treat this as
      // "couldn't determine, don't restrict anything", so existing tests
      // that don't care about device capabilities see unchanged behavior.
      getCaptureCapabilities: jest.fn().mockResolvedValue({ supportedQualities: [], fpsByQuality: {} }),
    },
    circularBufferEvents: {
      addListener: jest.fn((eventName: string, handler: (event: unknown) => void) => {
        listeners[eventName] = listeners[eventName] ?? [];
        listeners[eventName].push(handler);
        return { remove: jest.fn() };
      }),
      __emit: (eventName: string, payload: unknown) => {
        (listeners[eventName] ?? []).forEach(handler => handler(payload));
      },
    },
  };
});

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

describe('useCircularBuffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [], bufferHealth: 'healthy' });
    useSettingsStore.setState(DEFAULT_SETTINGS);
    useCameraStore.getState().reset();
    mockedModule.getCaptureCapabilities.mockResolvedValue({ supportedQualities: [], fpsByQuality: {} });
    Platform.OS = 'ios';
  });

  it('start() moves phase to "buffering" on success', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(mockedModule.startBuffering).toHaveBeenCalled();
    expect(useRecordingStore.getState().phase).toBe('buffering');
  });

  it('start() sends the current bufferSeconds/quality/fps settings to the native module', async () => {
    useSettingsStore.setState({ bufferSeconds: 45, videoQuality: '4k', fps: 60 });
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(mockedModule.startBuffering).toHaveBeenCalledWith({
      bufferSeconds: 45,
      width: 3840,
      height: 2160,
      fps: 60,
    });
  });

  // Covers the "verify the device actually records 4K/60fps before
  // offering it" request: a persisted setting the current device can't
  // deliver (e.g. restored from a more capable phone's backup) must not
  // reach the native buffer as-is -- start() falls back to the nearest
  // supported option instead, and corrects settingsStore to match.
  it('falls back to the nearest supported quality when the device does not support the requested one', async () => {
    useSettingsStore.setState({ videoQuality: '4k', fps: 30 });
    mockedModule.getCaptureCapabilities.mockResolvedValue({
      supportedQualities: ['720p', '1080p'],
      fpsByQuality: { '720p': [24, 30], '1080p': [24, 30] },
    });
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(mockedModule.startBuffering).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920, height: 1080, fps: 30 }),
    );
    expect(useSettingsStore.getState().videoQuality).toBe('1080p');
  });

  it('falls back to the nearest supported fps when the device does not support the requested one at this quality', async () => {
    useSettingsStore.setState({ videoQuality: '4k', fps: 60 });
    mockedModule.getCaptureCapabilities.mockResolvedValue({
      supportedQualities: ['4k'],
      fpsByQuality: { '4k': [24, 30] },
    });
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(mockedModule.startBuffering).toHaveBeenCalledWith(
      expect.objectContaining({ width: 3840, height: 2160, fps: 30 }),
    );
    expect(useSettingsStore.getState().fps).toBe(30);
  });

  // Regression test for the bug where changing a setting (buffer/quality/
  // fps) on SettingsScreen while CameraScreen stayed mounted underneath had
  // no effect on the running native buffer: CameraScreen's effect depends on
  // [start, stop], so it only re-runs (and reconfigures the buffer) if this
  // hook hands back new start/stop function identities whenever the
  // underlying settings change -- if start/stop were memoized without these
  // dependencies (e.g. reverted to []), this test would fail even though
  // useCircularBuffer's own start() call still reads current settings.
  it('hands back a new start/stop identity whenever bufferSeconds, videoQuality or fps changes', async () => {
    const { result } = await renderHook(() => useCircularBuffer());
    const initialStart = result.current.start;
    const initialStop = result.current.stop;

    await act(async () => {
      useSettingsStore.getState().setBufferSeconds(45);
    });
    expect(result.current.start).not.toBe(initialStart);
    const afterBufferChange = result.current.start;

    await act(async () => {
      useSettingsStore.getState().setVideoQuality('4k');
    });
    expect(result.current.start).not.toBe(afterBufferChange);
    const afterQualityChange = result.current.start;

    await act(async () => {
      useSettingsStore.getState().setFps(60);
    });
    expect(result.current.start).not.toBe(afterQualityChange);

    // stop() has no settings in its own deps, so its identity is expected to
    // stay stable across all of the above -- only start() needs to change.
    expect(result.current.stop).toBe(initialStop);
  });

  it('start() surfaces a native rejection as an error instead of throwing', async () => {
    mockedModule.startBuffering.mockRejectedValueOnce(new Error('Câmera indisponível'));
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(useRecordingStore.getState().errorMessage).toBe('Câmera indisponível');
  });

  it('startRecording() moves phase to "recording" on success', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockedModule.startManualRecording).toHaveBeenCalled();
    expect(useRecordingStore.getState().phase).toBe('recording');
  });

  it('startRecording() plays the start sound on both Android and iOS', async () => {
    Platform.OS = 'android';
    const { result: androidResult } = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await androidResult.current.startRecording();
    });
    expect(mockedModule.playRecordingStartSound).toHaveBeenCalled();

    jest.clearAllMocks();
    Platform.OS = 'ios';
    const { result: iosResult } = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await iosResult.current.startRecording();
    });
    expect(mockedModule.playRecordingStartSound).toHaveBeenCalled();
  });

  it('startRecording() surfaces a native rejection as an error instead of throwing', async () => {
    mockedModule.startManualRecording.mockRejectedValueOnce(new Error('O buffer não está ativo.'));
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(useRecordingStore.getState().errorMessage).toBe('O buffer não está ativo.');
  });

  it('stopRecording() adds the saved clip to the store, renamed to embed its real duration', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    let clip;
    await act(async () => {
      clip = await result.current.stopRecording();
    });

    expect(mockedModule.stopManualRecording).toHaveBeenCalled();
    expect(clip).toMatchObject({ path: expect.stringMatching(/^\/clips\/clip_\d+_d12000\.mp4$/), durationSeconds: 12, triggeredBy: 'manual' });
    expect(useRecordingStore.getState().clips[0]).toMatchObject({ durationSeconds: 12, triggeredBy: 'manual' });
    expect(useRecordingStore.getState().phase).toBe('buffering');
  });

  it('stopRecording() plays the stop sound on both Android and iOS', async () => {
    Platform.OS = 'android';
    const { result: androidResult } = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await androidResult.current.stopRecording();
    });
    expect(mockedModule.playRecordingStopSound).toHaveBeenCalled();

    jest.clearAllMocks();
    Platform.OS = 'ios';
    const { result: iosResult } = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await iosResult.current.stopRecording();
    });
    expect(mockedModule.playRecordingStopSound).toHaveBeenCalled();
  });

  it('stopRecording() surfaces a rejection as an error and returns null', async () => {
    mockedModule.stopManualRecording.mockRejectedValueOnce(new Error('Armazenamento insuficiente'));
    const { result } = await renderHook(() => useCircularBuffer());

    let clip;
    await act(async () => {
      clip = await result.current.stopRecording();
    });

    expect(clip).toBeNull();
    expect(useRecordingStore.getState().errorMessage).toBe('Armazenamento insuficiente');
  });

  it('routes an async CircularBufferError device event (e.g. camera busy) into the error banner', async () => {
    await renderHook(() => useCircularBuffer());

    await act(async () => {
      (circularBufferEvents as unknown as { __emit: Function }).__emit('CircularBufferError', {
        code: 'CAMERA_BUSY',
        message: 'Câmera ocupada por outro app.',
      });
    });

    await waitFor(() => expect(useRecordingStore.getState().errorMessage).toBe('Câmera ocupada por outro app.'));
  });

  it('keeps the "error" phase when the setup-failure event beats startBuffering()\'s resolution', async () => {
    // Native arms the session and resolves right away; a setup failure (no
    // back camera, camera busy) is emitted separately and can reach JS first.
    mockedModule.startBuffering.mockImplementationOnce(async () => {
      (circularBufferEvents as unknown as { __emit: Function }).__emit('CircularBufferError', {
        code: 'ENCODER_INIT_FAILED',
        message: 'Nenhuma câmera traseira disponível.',
      });
    });
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(useRecordingStore.getState().phase).toBe('error');
    expect(useRecordingStore.getState().errorMessage).toBe('Nenhuma câmera traseira disponível.');
  });

  it('stop() resets phase to "idle"', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(useRecordingStore.getState().phase).toBe('idle');
  });

  it('routes CircularBufferHealth transitions into recordingStore.bufferHealth', async () => {
    await renderHook(() => useCircularBuffer());

    await act(async () => {
      (circularBufferEvents as unknown as { __emit: Function }).__emit('CircularBufferHealth', {
        state: 'throttled',
        reason: 'thermal-serious',
      });
    });
    expect(useRecordingStore.getState().bufferHealth).toBe('throttled');

    await act(async () => {
      (circularBufferEvents as unknown as { __emit: Function }).__emit('CircularBufferHealth', { state: 'healthy' });
    });
    expect(useRecordingStore.getState().bufferHealth).toBe('healthy');
  });

  // A fresh (or stopped) pipeline must not keep showing a stale warning
  // from the previous run -- health events only arrive on transitions.
  it('start() and stop() reset bufferHealth to "healthy"', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    useRecordingStore.setState({ bufferHealth: 'interrupted' });
    await act(async () => {
      await result.current.start();
    });
    expect(useRecordingStore.getState().bufferHealth).toBe('healthy');

    useRecordingStore.setState({ bufferHealth: 'recovering' });
    await act(async () => {
      await result.current.stop();
    });
    expect(useRecordingStore.getState().bufferHealth).toBe('healthy');
  });

  it('Android: CircularBufferStoppedExternally (notification "Parar") resets phase to idle', async () => {
    Platform.OS = 'android';
    const { result } = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      (circularBufferEvents as unknown as { __emit: Function }).__emit('CircularBufferStoppedExternally', {});
    });

    expect(useRecordingStore.getState().phase).toBe('idle');
  });

  describe('restart on return to foreground', () => {
    const { AppState } = require('react-native');
    let handler: ((state: string) => void) | undefined;

    beforeEach(() => {
      handler = undefined;
      Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
      jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
        handler = args[1] as (state: string) => void;
        return { remove: jest.fn() };
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('restarts the buffer when it died while backgrounded', async () => {
      await renderHook(() => useCircularBuffer());
      mockedModule.isBuffering.mockResolvedValueOnce(false);

      await act(async () => {
        handler?.('background');
      });
      expect(mockedModule.isBuffering).not.toHaveBeenCalled();
      await act(async () => {
        handler?.('active');
      });

      await waitFor(() => expect(mockedModule.startBuffering).toHaveBeenCalledTimes(1));
    });

    it('leaves a still-alive buffer alone', async () => {
      await renderHook(() => useCircularBuffer());
      mockedModule.isBuffering.mockResolvedValueOnce(true);

      await act(async () => {
        handler?.('background');
      });
      await act(async () => {
        handler?.('active');
      });

      expect(mockedModule.isBuffering).toHaveBeenCalled();
      expect(mockedModule.startBuffering).not.toHaveBeenCalled();
    });
  });

  it('startRecording() retries after E_NOT_BUFFERING once the buffer reports ready', async () => {
    jest.useFakeTimers();
    try {
      mockedModule.startManualRecording.mockRejectedValueOnce(Object.assign(new Error('not buffering'), { code: 'E_NOT_BUFFERING' }));
      mockedModule.isBuffering.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const { result } = await renderHook(() => useCircularBuffer());

      let pending: Promise<void> | undefined;
      await act(async () => {
        pending = result.current.startRecording();
      });
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          jest.advanceTimersByTime(300);
        });
      }
      await act(async () => {
        await pending;
      });

      expect(mockedModule.startManualRecording).toHaveBeenCalledTimes(2);
      expect(useRecordingStore.getState().phase).toBe('recording');
    } finally {
      jest.useRealTimers();
    }
  });

  it('start() asks for the notification permission on Android (best-effort)', async () => {
    Platform.OS = 'android';
    const { requestNotifications } = require('react-native-permissions');
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(requestNotifications).toHaveBeenCalled();
  });
});
