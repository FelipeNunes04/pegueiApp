import { act, renderHook } from '@testing-library/react-native';
import { HARDWARE_TRIGGER_DEBOUNCE_MS, useHardwareTrigger } from '../hooks/useHardwareTrigger';
import { CircularBufferModule, circularBufferEvents } from '../native/CircularBufferModule';

jest.mock('../native/CircularBufferModule', () => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    CircularBufferModule: {
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

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;
const emit = (payload: unknown) =>
  (circularBufferEvents as unknown as { __emit: (name: string, p: unknown) => void }).__emit(
    'CircularBufferHardwareTrigger',
    payload,
  );

describe('useHardwareTrigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enables native interception while enabled and disables it on cleanup', async () => {
    const { rerender, unmount } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useHardwareTrigger(enabled, jest.fn()),
      { initialProps: { enabled: true } },
    );
    expect(mockedModule.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(true);

    await rerender({ enabled: false });
    expect(mockedModule.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(false);

    await rerender({ enabled: true });
    await unmount();
    expect(mockedModule.setHardwareTriggerEnabled).toHaveBeenLastCalledWith(false);
  });

  it('never touches the native side or subscribes while disabled', async () => {
    const onTrigger = jest.fn();
    await renderHook(() => useHardwareTrigger(false, onTrigger));

    emit({ source: 'volumeUp' });

    expect(mockedModule.setHardwareTriggerEnabled).not.toHaveBeenCalled();
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('forwards triggers but drops a second one inside the debounce window', async () => {
    const onTrigger = jest.fn();
    await renderHook(() => useHardwareTrigger(true, onTrigger));

    emit({ source: 'volumeUp' });
    jest.advanceTimersByTime(HARDWARE_TRIGGER_DEBOUNCE_MS - 1);
    emit({ source: 'enter' });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith({ source: 'volumeUp' });

    jest.advanceTimersByTime(1);
    emit({ source: 'volumeDown' });
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it('always calls the latest onTrigger without resubscribing', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ cb }: { cb: () => void }) => useHardwareTrigger(true, cb),
      { initialProps: { cb: first } },
    );
    await rerender({ cb: second });

    emit({ source: 'captureButton' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(circularBufferEvents!.addListener).toHaveBeenCalledTimes(1);
  });

  it('swallows a native rejection', async () => {
    mockedModule.setHardwareTriggerEnabled.mockRejectedValueOnce(new Error('nope'));
    await renderHook(() => useHardwareTrigger(true, jest.fn()));
    await act(async () => {});
    expect(mockedModule.setHardwareTriggerEnabled).toHaveBeenCalledWith(true);
  });
});
