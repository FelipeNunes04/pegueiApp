import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { usePocketMode } from '../hooks/usePocketMode';
import { CircularBufferModule } from '../native/CircularBufferModule';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../settings/store/settingsStore';
import type { RecordingPhase } from '../../../shared/types';

jest.mock('../native/CircularBufferModule', () => ({
  CircularBufferModule: {
    setPocketMode: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

type Props = { phase: RecordingPhase; focused: boolean };

describe('usePocketMode', () => {
  let appStateHandler: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useSettingsStore.setState(DEFAULT_SETTINGS);
    appStateHandler = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandler = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function setup(initial: Props = { phase: 'buffering', focused: true }) {
    return renderHook(({ phase, focused }: Props) => usePocketMode(phase, focused), {
      initialProps: initial,
    });
  }

  it('auto-enters after the configured delay without touches (default 20 s) and dims natively', async () => {
    const { result } = await setup();

    await act(async () => {
      jest.advanceTimersByTime(19_000);
    });
    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.isActive).toBe(true);
    expect(mockedModule.setPocketMode).toHaveBeenCalledWith(true);
  });

  it('markActivity() (any touch) postpones auto-enter', async () => {
    const { result } = await setup();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    result.current.markActivity();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(result.current.isActive).toBe(false);
  });

  it('respects a custom delay and the on/off setting', async () => {
    useSettingsStore.setState({ pocketModeDelaySeconds: 10 });
    const { result } = await setup();
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current.isActive).toBe(true);
  });

  it('never auto-enters when the setting is off, but can still be entered manually', async () => {
    useSettingsStore.setState({ pocketModeAutoEnabled: false });
    const { result } = await setup();
    await act(async () => {
      jest.advanceTimersByTime(600_000);
    });
    expect(result.current.isActive).toBe(false);

    await act(async () => {
      result.current.enter();
    });
    expect(result.current.isActive).toBe(true);

    await act(async () => {
      result.current.exit();
    });
    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).toHaveBeenLastCalledWith(false);
  });

  it('does not auto-enter while idle/saving/error', async () => {
    const { result } = await setup({ phase: 'idle', focused: true });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current.isActive).toBe(false);
  });

  it('stays on through recording and saving, and exits once the pipeline stops (idle/error)', async () => {
    const { result, rerender } = await setup();
    await act(async () => {
      result.current.enter();
    });
    await rerender({ phase: 'recording', focused: true });
    await rerender({ phase: 'saving', focused: true });
    expect(result.current.isActive).toBe(true);

    await rerender({ phase: 'error', focused: true });
    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).toHaveBeenLastCalledWith(false);

    // The request is cleared too: recovering doesn't silently re-enter.
    await rerender({ phase: 'buffering', focused: true });
    expect(result.current.isActive).toBe(false);
  });

  it('exits when the screen loses focus', async () => {
    const { result, rerender } = await setup();
    await act(async () => {
      result.current.enter();
    });
    await rerender({ phase: 'buffering', focused: false });
    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).toHaveBeenLastCalledWith(false);
  });

  it('exits when the app leaves the foreground', async () => {
    const { result } = await setup();
    await act(async () => {
      result.current.enter();
    });
    await act(async () => {
      appStateHandler?.('background');
    });
    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).toHaveBeenLastCalledWith(false);

    await act(async () => {
      appStateHandler?.('active');
    });
    expect(result.current.isActive).toBe(false);
  });

  // iOS Control Center / call alert: the screen is still ours, and native
  // restores brightness on resign and re-dims on becoming active by itself.
  it('stays on through inactive without touching the native state', async () => {
    const { result } = await setup();
    await act(async () => {
      result.current.enter();
    });
    mockedModule.setPocketMode.mockClear();

    await act(async () => {
      appStateHandler?.('inactive');
    });
    expect(result.current.isActive).toBe(true);

    await act(async () => {
      appStateHandler?.('active');
    });
    expect(result.current.isActive).toBe(true);
    expect(mockedModule.setPocketMode).not.toHaveBeenCalled();
  });

  it('exits on the background that follows inactive', async () => {
    const { result } = await setup();
    await act(async () => {
      result.current.enter();
    });

    await act(async () => {
      appStateHandler?.('inactive');
    });
    await act(async () => {
      appStateHandler?.('background');
    });

    expect(result.current.isActive).toBe(false);
    expect(mockedModule.setPocketMode).toHaveBeenLastCalledWith(false);
  });

  it('does not auto-enter while inactive, and restarts the countdown on return', async () => {
    const { result } = await setup();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    await act(async () => {
      appStateHandler?.('inactive');
    });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current.isActive).toBe(false);

    await act(async () => {
      appStateHandler?.('active');
    });
    await act(async () => {
      jest.advanceTimersByTime(19_000);
    });
    expect(result.current.isActive).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.isActive).toBe(true);
  });

  it('restores the screen on unmount while active, and does nothing on unmount otherwise', async () => {
    const active = await setup();
    await act(async () => {
      active.result.current.enter();
    });
    mockedModule.setPocketMode.mockClear();
    await active.unmount();
    expect(mockedModule.setPocketMode).toHaveBeenCalledWith(false);

    mockedModule.setPocketMode.mockClear();
    const inactive = await setup();
    await inactive.unmount();
    expect(mockedModule.setPocketMode).not.toHaveBeenCalled();
  });

  it('swallows a native rejection', async () => {
    mockedModule.setPocketMode.mockRejectedValueOnce(new Error('nope'));
    const { result } = await setup();
    await act(async () => {
      result.current.enter();
    });
    expect(result.current.isActive).toBe(true);
  });
});
