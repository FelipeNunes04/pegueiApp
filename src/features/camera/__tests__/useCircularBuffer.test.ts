import { useEffect } from 'react';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { resetNotificationPermissionRequestForTests, useCircularBuffer } from '../hooks/useCircularBuffer';
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

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

const emit = (eventName: string, payload: unknown) =>
  (circularBufferEvents as unknown as { __emit: (name: string, payload: unknown) => void }).__emit(eventName, payload);

const nextMacrotask = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// CameraScreen's effect, verbatim: this is the pairing that overlaps stop() and start().
function useBufferLifecycle() {
  const buffer = useCircularBuffer();
  const { start, stop } = buffer;
  useEffect(() => {
    start();
    return () => {
      stop();
    };
  }, [start, stop]);
  return buffer;
}

describe('useCircularBuffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, noticeMessage: null, clips: [], bufferHealth: 'healthy' });
    resetNotificationPermissionRequestForTests();
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

    // iOS Control Center / call alert: active -> inactive -> active with the
    // app never leaving the screen. Must not undo the idle auto-stop.
    it('does not restart a stopped buffer on inactive -> active', async () => {
      await renderHook(() => useCircularBuffer());
      mockedModule.isBuffering.mockResolvedValue(false);

      try {
        await act(async () => {
          handler?.('inactive');
        });
        await act(async () => {
          handler?.('active');
        });

        expect(mockedModule.isBuffering).not.toHaveBeenCalled();
        expect(mockedModule.startBuffering).not.toHaveBeenCalled();
      } finally {
        mockedModule.isBuffering.mockResolvedValue(true);
      }
    });

    it('still restarts when the return from background passes through inactive', async () => {
      await renderHook(() => useCircularBuffer());
      mockedModule.isBuffering.mockResolvedValueOnce(false);

      for (const state of ['inactive', 'background', 'inactive', 'active']) {
        await act(async () => {
          handler?.(state);
        });
      }

      await waitFor(() => expect(mockedModule.startBuffering).toHaveBeenCalledTimes(1));
    });

    it('only counts one background trip per return', async () => {
      await renderHook(() => useCircularBuffer());

      for (const state of ['background', 'active', 'inactive', 'active']) {
        await act(async () => {
          handler?.(state);
        });
      }

      expect(mockedModule.isBuffering).toHaveBeenCalledTimes(1);
    });

    it('treats a launch straight into the background as a background trip', async () => {
      Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
      await renderHook(() => useCircularBuffer());

      await act(async () => {
        handler?.('active');
      });

      expect(mockedModule.isBuffering).toHaveBeenCalledTimes(1);
    });

    it('keeps "buffering" through a background round trip with a live buffer', async () => {
      const { result } = await renderHook(() => useCircularBuffer());
      await act(async () => {
        await result.current.start();
      });

      for (const state of ['inactive', 'background', 'active']) {
        await act(async () => {
          handler?.(state);
        });
      }

      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('swallows an isBuffering() rejection', async () => {
      await renderHook(() => useCircularBuffer());
      mockedModule.isBuffering.mockRejectedValueOnce(new Error('bridge gone'));

      await act(async () => {
        handler?.('background');
      });
      await act(async () => {
        handler?.('active');
      });

      expect(mockedModule.startBuffering).not.toHaveBeenCalled();
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

  it('asks for the notification permission only once per session, across restarts and remounts', async () => {
    Platform.OS = 'android';
    const { requestNotifications } = require('react-native-permissions');
    const first = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await first.result.current.start();
    });
    await act(async () => {
      await first.result.current.start();
    });
    await first.unmount();

    const second = await renderHook(() => useCircularBuffer());
    await act(async () => {
      await second.result.current.start();
    });

    expect(requestNotifications).toHaveBeenCalledTimes(1);
  });

  it('never asks for the notification permission on iOS', async () => {
    const { requestNotifications } = require('react-native-permissions');
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(requestNotifications).not.toHaveBeenCalled();
  });

  describe('stop/start ordering', () => {
    // The real bridge: stop resolves after a native round-trip, well after
    // start() got through its cached capabilities on a microtask.
    beforeEach(() => {
      mockedModule.startBuffering.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)));
      mockedModule.stopBuffering.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1)));
    });

    afterEach(() => {
      mockedModule.startBuffering.mockReset();
      mockedModule.startBuffering.mockResolvedValue(undefined);
      mockedModule.stopBuffering.mockReset();
      mockedModule.stopBuffering.mockResolvedValue(undefined);
    });

    async function settle() {
      await act(async () => {
        await nextMacrotask(50);
      });
    }

    it('stays "buffering" when a settings change restarts the buffer', async () => {
      await renderHook(() => useBufferLifecycle());
      await settle();
      expect(useRecordingStore.getState().phase).toBe('buffering');

      await act(async () => {
        useSettingsStore.setState({ bufferSeconds: DEFAULT_SETTINGS.bufferSeconds + 15 });
      });
      await settle();

      expect(mockedModule.stopBuffering).toHaveBeenCalledTimes(1);
      expect(mockedModule.startBuffering).toHaveBeenCalledTimes(2);
      expect(mockedModule.startBuffering).toHaveBeenLastCalledWith(
        expect.objectContaining({ bufferSeconds: DEFAULT_SETTINGS.bufferSeconds + 15 }),
      );
      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('stays "buffering" on a first start whose saved quality/fps gets clamped', async () => {
      useSettingsStore.setState({ videoQuality: '4k', fps: 60 });
      mockedModule.getCaptureCapabilities.mockResolvedValue({
        supportedQualities: ['1080p'],
        fpsByQuality: { '1080p': [30] },
      });

      await renderHook(() => useBufferLifecycle());
      await settle();

      expect(useSettingsStore.getState().videoQuality).toBe('1080p');
      expect(useSettingsStore.getState().fps).toBe(30);
      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('stop() still lands on "idle" when no later start() began', async () => {
      const { result } = await renderHook(() => useBufferLifecycle());
      await settle();

      await act(async () => {
        await result.current.stop();
      });

      expect(useRecordingStore.getState().phase).toBe('idle');
    });

    it('a start() right after stop() (Retomar) wins regardless of who resolves first', async () => {
      const { result } = await renderHook(() => useBufferLifecycle());
      await settle();

      await act(async () => {
        const stopping = result.current.stop();
        const starting = result.current.start();
        await Promise.all([stopping, starting]);
      });

      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('stop() resets to idle and rethrows when the native call rejects', async () => {
      const { result } = await renderHook(() => useCircularBuffer());
      mockedModule.stopBuffering.mockRejectedValueOnce(new Error('stop failed'));
      await act(async () => {
        useRecordingStore.setState({ phase: 'buffering' });
      });

      await act(async () => {
        await expect(result.current.stop()).rejects.toThrow('stop failed');
      });

      expect(useRecordingStore.getState().phase).toBe('idle');
    });

    it('a stop() during start() keeps the superseded start from reaching native', async () => {
      const { result } = await renderHook(() => useCircularBuffer());

      await act(async () => {
        const starting = result.current.start();
        const stopping = result.current.stop();
        await Promise.all([starting, stopping]);
      });

      expect(mockedModule.startBuffering).not.toHaveBeenCalled();
      expect(useRecordingStore.getState().phase).toBe('idle');
    });

    it('ignores a rejection from a superseded start()', async () => {
      const { result } = await renderHook(() => useCircularBuffer());
      mockedModule.startBuffering.mockImplementationOnce(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Já está em execução')), 5)),
      );

      await act(async () => {
        const superseded = result.current.start();
        await nextMacrotask(1);
        await Promise.all([superseded, result.current.start()]);
      });

      expect(useRecordingStore.getState().errorMessage).toBeNull();
      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('still surfaces a rejection from the current start()', async () => {
      const { result } = await renderHook(() => useCircularBuffer());
      mockedModule.startBuffering.mockRejectedValueOnce('not an Error');

      await act(async () => {
        await result.current.start();
      });

      expect(useRecordingStore.getState().errorMessage).toBe('Não foi possível iniciar o buffer de vídeo.');
    });
  });

  describe('CircularBufferRecordingFinalized', () => {
    const REASONS = [
      ['memoryLimit', 'buffering', 'Gravação encerrada: limite de memória atingido.'],
      ['recovery', 'buffering', 'Gravação encerrada: a câmera foi reiniciada.'],
      ['stopped', 'idle', 'Gravação encerrada: o buffer foi desligado.'],
    ] as const;

    async function recording() {
      const hook = await renderHook(() => useCircularBuffer());
      await act(async () => {
        await hook.result.current.start();
      });
      await act(async () => {
        await hook.result.current.startRecording();
      });
      expect(useRecordingStore.getState().phase).toBe('recording');
      return hook;
    }

    async function finalize(payload: unknown) {
      await act(async () => {
        emit('CircularBufferRecordingFinalized', payload);
      });
    }

    it.each(REASONS)('%s with a saved clip completes like a normal save', async (reason, phase, why) => {
      await recording();

      await finalize({ reason, path: '/clips/clip_9.mp4', durationSeconds: 7 });

      const state = useRecordingStore.getState();
      expect(state.phase).toBe(phase);
      expect(state.errorMessage).toBeNull();
      expect(state.noticeMessage).toBe(`${why} O vídeo foi salvo.`);
      expect(state.clips).toHaveLength(1);
      expect(state.clips[0]).toMatchObject({
        path: expect.stringMatching(/^\/clips\/clip_\d+_d7000\.mp4$/),
        durationSeconds: 7,
        triggeredBy: 'manual',
      });
      expect(RNFS.moveFile).toHaveBeenCalled();
      expect(mockedModule.playRecordingStopSound).toHaveBeenCalledTimes(1);
    });

    it.each(REASONS)('%s with an error shows it and leaves the recording phase', async (reason, phase, why) => {
      await recording();

      await finalize({ reason, error: 'writer failed' });

      const state = useRecordingStore.getState();
      expect(state.phase).toBe(phase);
      expect(state.errorMessage).toBe(`${why} Não foi possível salvar o vídeo.`);
      expect(state.noticeMessage).toBeNull();
      expect(state.clips).toHaveLength(0);
    });

    it('is ignored when not recording', async () => {
      const { result } = await renderHook(() => useCircularBuffer());
      await act(async () => {
        await result.current.start();
      });

      await finalize({ reason: 'memoryLimit', path: '/clips/clip_9.mp4', durationSeconds: 7 });

      const state = useRecordingStore.getState();
      expect(state.phase).toBe('buffering');
      expect(state.noticeMessage).toBeNull();
      expect(state.clips).toHaveLength(0);
      expect(mockedModule.playRecordingStopSound).not.toHaveBeenCalled();
    });

    it('is ignored once the recording was already saved through stopRecording()', async () => {
      const { result } = await recording();
      await act(async () => {
        await result.current.stopRecording();
      });

      await finalize({ reason: 'stopped', path: '/clips/clip_1.mp4', durationSeconds: 12 });

      expect(useRecordingStore.getState().clips).toHaveLength(1);
      expect(useRecordingStore.getState().phase).toBe('buffering');
    });

    it('handles a recording phase left over from a previous hook instance', async () => {
      await renderHook(() => useCircularBuffer());
      await act(async () => {
        useRecordingStore.setState({ phase: 'recording' });
      });

      await finalize({ reason: 'recovery', path: '/clips/clip_9.mp4', durationSeconds: 7 });

      expect(useRecordingStore.getState().phase).toBe('buffering');
      expect(useRecordingStore.getState().clips).toHaveLength(1);
    });

    // Restart on a config change while recording: the new start() has already
    // put the phase on 'buffering' when 'stopped' arrives. Forcing 'idle'
    // here would bring back the "Parado" bug.
    it('does not knock a restarted buffer back to idle', async () => {
      await recording();
      await act(async () => {
        useRecordingStore.setState({ phase: 'buffering' });
      });

      await finalize({ reason: 'stopped', path: '/clips/clip_9.mp4', durationSeconds: 7 });

      expect(useRecordingStore.getState().phase).toBe('buffering');
      expect(useRecordingStore.getState().clips).toHaveLength(1);
    });

    it('does not knock a restarted buffer back to idle on an error either', async () => {
      await recording();
      await act(async () => {
        useRecordingStore.setState({ phase: 'buffering' });
      });

      await finalize({ reason: 'stopped', error: 'writer failed' });

      expect(useRecordingStore.getState().phase).toBe('buffering');
      expect(useRecordingStore.getState().errorMessage).toContain('Não foi possível salvar');
    });

    it('treats a payload with neither path nor error as a failed save', async () => {
      await recording();

      await finalize({ reason: 'recovery' });

      expect(useRecordingStore.getState().errorMessage).toBe(
        'Gravação encerrada: a câmera foi reiniciada. Não foi possível salvar o vídeo.',
      );
    });

    it('falls back to a generic message for a reason this JS does not know yet', async () => {
      await recording();

      await finalize({ reason: 'somethingNew', path: '/clips/clip_9.mp4', durationSeconds: 7 });

      expect(useRecordingStore.getState().noticeMessage).toBe('Gravação encerrada. O vídeo foi salvo.');
    });

    it('keeps the native filename when the payload has no duration', async () => {
      await recording();
      (RNFS.moveFile as jest.Mock).mockClear();

      await finalize({ reason: 'recovery', path: '/clips/clip_9.mp4' });

      expect(RNFS.moveFile).not.toHaveBeenCalled();
      expect(useRecordingStore.getState().clips[0]).toMatchObject({ path: '/clips/clip_9.mp4', durationSeconds: 0 });
    });

    it('keeps the clip under its native path when the rename fails', async () => {
      await recording();
      (RNFS.moveFile as jest.Mock).mockRejectedValueOnce(new Error('rename failed'));

      await finalize({ reason: 'recovery', path: '/clips/clip_9.mp4', durationSeconds: 7 });

      expect(useRecordingStore.getState().clips[0].path).toBe('/clips/clip_9.mp4');
    });

    it('does not touch the store when the screen unmounts during the rename', async () => {
      const { unmount } = await recording();
      let finishRename: () => void = () => undefined;
      (RNFS.moveFile as jest.Mock).mockImplementationOnce(
        () => new Promise<void>(resolve => { finishRename = resolve; }),
      );

      await finalize({ reason: 'recovery', path: '/clips/clip_9.mp4', durationSeconds: 7 });
      await unmount();
      await act(async () => {
        finishRename();
      });

      expect(useRecordingStore.getState().clips).toHaveLength(0);
    });

    describe('a stopManualRecording() rejected with "no recording in progress"', () => {
      const noRecording = () => Object.assign(new Error('Nenhuma gravação em andamento.'), { code: 'E_SAVE_FAILED' });

      it('shows no error when the event arrived first', async () => {
        const { result } = await recording();
        await finalize({ reason: 'memoryLimit', path: '/clips/clip_9.mp4', durationSeconds: 7 });
        mockedModule.stopManualRecording.mockRejectedValueOnce(noRecording());

        let clip;
        await act(async () => {
          clip = await result.current.stopRecording();
        });

        expect(clip).toBeNull();
        expect(useRecordingStore.getState().errorMessage).toBeNull();
        expect(useRecordingStore.getState().phase).toBe('buffering');
      });

      it('shows no error and still takes a late event when the rejection arrived first', async () => {
        const { result } = await recording();
        mockedModule.stopManualRecording.mockRejectedValueOnce(noRecording());

        await act(async () => {
          await result.current.stopRecording();
        });
        expect(useRecordingStore.getState().errorMessage).toBeNull();
        expect(useRecordingStore.getState().phase).toBe('buffering');

        await finalize({ reason: 'memoryLimit', path: '/clips/clip_9.mp4', durationSeconds: 7 });

        expect(useRecordingStore.getState().clips).toHaveLength(1);
        expect(useRecordingStore.getState().noticeMessage).toContain('O vídeo foi salvo.');
      });

      it('lands on idle when the buffer turned out to be stopped too', async () => {
        const { result } = await recording();
        mockedModule.stopManualRecording.mockRejectedValueOnce(noRecording());
        mockedModule.isBuffering.mockResolvedValueOnce(false);

        await act(async () => {
          await result.current.stopRecording();
        });

        expect(useRecordingStore.getState().phase).toBe('idle');
      });

      it('assumes the buffer is alive when isBuffering() itself fails', async () => {
        const { result } = await recording();
        mockedModule.stopManualRecording.mockRejectedValueOnce(new Error('no recording in progress'));
        mockedModule.isBuffering.mockRejectedValueOnce(new Error('bridge gone'));

        await act(async () => {
          await result.current.stopRecording();
        });

        expect(useRecordingStore.getState().errorMessage).toBeNull();
        expect(useRecordingStore.getState().phase).toBe('buffering');
      });

      it('does not move the phase if the event settled it during the isBuffering() check', async () => {
        const { result } = await recording();
        mockedModule.stopManualRecording.mockRejectedValueOnce(noRecording());
        mockedModule.isBuffering.mockImplementationOnce(async () => {
          emit('CircularBufferRecordingFinalized', { reason: 'stopped', error: 'writer failed' });
          return true;
        });

        await act(async () => {
          await result.current.stopRecording();
        });

        expect(useRecordingStore.getState().phase).toBe('idle');
      });

      it('still reports any other save failure as an error', async () => {
        const { result } = await recording();
        mockedModule.stopManualRecording.mockRejectedValueOnce(new Error('Armazenamento insuficiente'));

        await act(async () => {
          await result.current.stopRecording();
        });

        expect(useRecordingStore.getState().errorMessage).toBe('Armazenamento insuficiente');
        expect(useRecordingStore.getState().phase).toBe('buffering');
      });
    });

    it('does not add the clip twice when the in-flight stop also resolves with it', async () => {
      const { result } = await recording();
      let resolveStop: (value: { path: string; durationSeconds: number }) => void = () => undefined;
      mockedModule.stopManualRecording.mockImplementationOnce(
        () => new Promise(resolve => { resolveStop = resolve; }),
      );

      let pending: Promise<unknown> = Promise.resolve();
      await act(async () => {
        pending = result.current.stopRecording();
      });
      expect(useRecordingStore.getState().phase).toBe('saving');

      await finalize({ reason: 'recovery', path: '/clips/clip_9.mp4', durationSeconds: 7 });
      expect(useRecordingStore.getState().phase).toBe('buffering');

      await act(async () => {
        resolveStop({ path: '/clips/clip_9.mp4', durationSeconds: 7 });
        await pending;
      });

      expect(useRecordingStore.getState().clips).toHaveLength(1);
      expect(mockedModule.playRecordingStopSound).toHaveBeenCalledTimes(1);
    });

    it('does not take the screen down when subscribing throws on an older binary', async () => {
      (circularBufferEvents?.addListener as jest.Mock).mockImplementationOnce(() => ({ remove: jest.fn() }));
      (circularBufferEvents?.addListener as jest.Mock).mockImplementationOnce(() => ({ remove: jest.fn() }));
      (circularBufferEvents?.addListener as jest.Mock).mockImplementationOnce(() => {
        throw new Error('`CircularBufferRecordingFinalized` is not a supported event');
      });

      const { result } = await renderHook(() => useCircularBuffer());

      expect(result.current.phase).toBe('idle');
    });
  });
});
