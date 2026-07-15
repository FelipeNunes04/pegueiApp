import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useCircularBuffer } from '../hooks/useCircularBuffer';
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
      isBuffering: jest.fn().mockResolvedValue(true),
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
    useRecordingStore.setState({ phase: 'idle', errorMessage: null, clips: [] });
    useSettingsStore.setState(DEFAULT_SETTINGS);
  });

  it('start() moves phase to "buffering" on success', async () => {
    const { result } = await renderHook(() => useCircularBuffer());

    await act(async () => {
      await result.current.start();
    });

    expect(mockedModule.startBuffering).toHaveBeenCalled();
    expect(useRecordingStore.getState().phase).toBe('buffering');
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
});
