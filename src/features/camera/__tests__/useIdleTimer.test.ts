import { act, renderHook } from '@testing-library/react-native';
import { useIdleTimer } from '../hooks/useIdleTimer';

describe('useIdleTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires once after the timeout with no activity', async () => {
    const onIdle = jest.fn();
    await renderHook(() => useIdleTimer(true, 20_000, onIdle));

    await act(async () => {
      jest.advanceTimersByTime(19_999);
    });
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('markActivity() pushes the deadline back', async () => {
    const onIdle = jest.fn();
    const { result } = await renderHook(() => useIdleTimer(true, 20_000, onIdle));

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    result.current();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('handles timeouts longer than one timer chunk (e.g. the 2 h auto-stop)', async () => {
    const onIdle = jest.fn();
    await renderHook(() => useIdleTimer(true, 2 * 60 * 60_000, onIdle));

    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 60_000 - 1_000);
    });
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled or with a non-positive timeout, and restarts the countdown when re-enabled', async () => {
    const onIdle = jest.fn();
    const { rerender } = await renderHook(
      ({ enabled, timeout }: { enabled: boolean; timeout: number }) => useIdleTimer(enabled, timeout, onIdle),
      { initialProps: { enabled: false, timeout: 1_000 } },
    );

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await rerender({ enabled: true, timeout: 0 });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onIdle).not.toHaveBeenCalled();

    await rerender({ enabled: true, timeout: 1_000 });
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(onIdle).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('calls the latest onIdle callback', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ cb }: { cb: () => void }) => useIdleTimer(true, 1_000, cb),
      { initialProps: { cb: first } },
    );
    await rerender({ cb: second });

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
