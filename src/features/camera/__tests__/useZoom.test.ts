import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useZoom } from '../hooks/useZoom';
import { useCameraStore } from '../store/cameraStore';
import { CircularBufferModule } from '../native/CircularBufferModule';

jest.mock('../native/CircularBufferModule', () => ({
  CircularBufferModule: {
    getZoomInfo: jest.fn(),
    setZoom: jest.fn(),
  },
}));

const mockedModule = CircularBufferModule as jest.Mocked<
  typeof CircularBufferModule
>;

describe('useZoom', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCameraStore.getState().reset();
  });

  it('does not query the native zoom range while idle', async () => {
    await renderHook(() => useZoom('idle'));

    expect(mockedModule.getZoomInfo).not.toHaveBeenCalled();
  });

  it('queries the native zoom range once buffering starts and syncs the hardware to the stored zoom factor', async () => {
    mockedModule.getZoomInfo.mockResolvedValue({
      minZoom: 0.5,
      maxZoom: 8,
      hasUltraWide: true,
    });
    mockedModule.setZoom.mockResolvedValue(1);

    await renderHook(() => useZoom('buffering'));

    await waitFor(() => expect(mockedModule.getZoomInfo).toHaveBeenCalled());
    await waitFor(() => expect(useCameraStore.getState().maxZoom).toBe(8));
    await waitFor(() => expect(mockedModule.setZoom).toHaveBeenCalledWith(1));
  });

  it('setZoom() clamps the requested factor to the known range before applying it', async () => {
    useCameraStore
      .getState()
      .setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    mockedModule.setZoom.mockResolvedValue(8);
    const { result } = await renderHook(() => useZoom('buffering'));

    await act(async () => {
      await result.current.setZoom(50);
    });

    expect(mockedModule.setZoom).toHaveBeenCalledWith(8);
    expect(useCameraStore.getState().zoomFactor).toBe(8);
  });

  it('setZoom() is a no-op until the zoom range is known', async () => {
    const { result } = await renderHook(() => useZoom('idle'));

    await act(async () => {
      await result.current.setZoom(2);
    });

    expect(mockedModule.setZoom).not.toHaveBeenCalled();
  });

  it('exposes no pill levels until maxZoom is known', async () => {
    const { result } = await renderHook(() => useZoom('idle'));

    expect(result.current.pillLevels).toEqual([]);
  });

  it('also queries the zoom range while a recording is in progress', async () => {
    mockedModule.getZoomInfo.mockResolvedValue({ minZoom: 1, maxZoom: 4, hasUltraWide: false });
    mockedModule.setZoom.mockResolvedValue(1);

    await renderHook(() => useZoom('recording'));

    await waitFor(() => expect(useCameraStore.getState().maxZoom).toBe(4));
  });

  it('does not re-query once the zoom range is already known', async () => {
    useCameraStore.getState().setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });

    await renderHook(() => useZoom('buffering'));

    expect(mockedModule.getZoomInfo).not.toHaveBeenCalled();
  });

  it('re-applies the user\'s last-picked zoom (clamped to the new range) when the camera reopens', async () => {
    useCameraStore.getState().setZoomFactor(10);
    mockedModule.getZoomInfo.mockResolvedValue({ minZoom: 1, maxZoom: 5, hasUltraWide: false });
    mockedModule.setZoom.mockResolvedValue(5);

    await renderHook(() => useZoom('buffering'));

    await waitFor(() => expect(mockedModule.setZoom).toHaveBeenCalledWith(5));
    await waitFor(() => expect(useCameraStore.getState().zoomFactor).toBe(5));
  });

  it('keeps the known range even if the initial zoom sync is rejected by native', async () => {
    mockedModule.getZoomInfo.mockResolvedValue({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    mockedModule.setZoom.mockRejectedValue(new Error('session tearing down'));

    const { result } = await renderHook(() => useZoom('buffering'));

    await waitFor(() => expect(mockedModule.setZoom).toHaveBeenCalled());
    await waitFor(() => expect(result.current.maxZoom).toBe(8));
    expect(result.current.zoomFactor).toBe(1);
    expect(result.current.pillLevels.length).toBeGreaterThan(1);
  });

  describe('retrying while the camera is still opening', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries getZoomInfo() until the device has finished opening', async () => {
      mockedModule.getZoomInfo
        .mockRejectedValueOnce(new Error('device not open'))
        .mockRejectedValueOnce(new Error('device not open'))
        .mockResolvedValue({ minZoom: 1, maxZoom: 3, hasUltraWide: false });
      mockedModule.setZoom.mockResolvedValue(1);

      await renderHook(() => useZoom('buffering'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300);
      });

      expect(mockedModule.getZoomInfo).toHaveBeenCalledTimes(3);
      expect(useCameraStore.getState().maxZoom).toBe(3);
    });

    it('gives up after 12 attempts instead of polling forever', async () => {
      mockedModule.getZoomInfo.mockRejectedValue(new Error('no camera'));

      const { result } = await renderHook(() => useZoom('buffering'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300 * 20);
      });

      expect(mockedModule.getZoomInfo).toHaveBeenCalledTimes(12);
      expect(result.current.pillLevels).toEqual([]);
    });

    it('stops retrying once unmounted', async () => {
      mockedModule.getZoomInfo.mockRejectedValue(new Error('device not open'));

      const { unmount } = await renderHook(() => useZoom('buffering'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      const callsBeforeUnmount = mockedModule.getZoomInfo.mock.calls.length;
      await unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300 * 5);
      });

      expect(mockedModule.getZoomInfo).toHaveBeenCalledTimes(callsBeforeUnmount);
    });
  });

  it('does not write to the store if the screen unmounted before getZoomInfo() resolved', async () => {
    let resolveInfo: (info: { minZoom: number; maxZoom: number; hasUltraWide: boolean }) => void =
      () => undefined;
    mockedModule.getZoomInfo.mockReturnValue(
      new Promise(resolve => {
        resolveInfo = resolve;
      }),
    );

    const { unmount } = await renderHook(() => useZoom('buffering'));
    await unmount();
    await act(async () => {
      resolveInfo({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    });

    expect(useCameraStore.getState().maxZoom).toBeNull();
    expect(mockedModule.setZoom).not.toHaveBeenCalled();
  });

  it('does not write the applied zoom to the store if unmounted before the initial sync resolved', async () => {
    let resolveSetZoom: (applied: number) => void = () => undefined;
    mockedModule.getZoomInfo.mockResolvedValue({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    mockedModule.setZoom.mockReturnValue(
      new Promise(resolve => {
        resolveSetZoom = resolve;
      }),
    );

    const { unmount } = await renderHook(() => useZoom('buffering'));
    await waitFor(() => expect(mockedModule.setZoom).toHaveBeenCalled());
    await unmount();
    await act(async () => {
      resolveSetZoom(3);
    });

    expect(useCameraStore.getState().zoomFactor).toBe(1);
  });

  it('setZoom() clamps below the minimum too (e.g. pinching out past the ultra-wide)', async () => {
    useCameraStore.getState().setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    mockedModule.setZoom.mockResolvedValue(0.5);
    const { result } = await renderHook(() => useZoom('buffering'));

    await act(async () => {
      await result.current.setZoom(0.1);
    });

    expect(mockedModule.setZoom).toHaveBeenCalledWith(0.5);
    expect(result.current.zoomFactor).toBe(0.5);
  });

  it('setZoom() swallows a native rejection and leaves the zoom unchanged', async () => {
    useCameraStore.getState().setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    mockedModule.setZoom.mockRejectedValue(new Error('mid-teardown'));
    const { result } = await renderHook(() => useZoom('buffering'));

    await act(async () => {
      await expect(result.current.setZoom(2)).resolves.toBeUndefined();
    });

    expect(result.current.zoomFactor).toBe(1);
  });

  it('setZoom() does not touch the store if the screen unmounted while native was applying it', async () => {
    useCameraStore.getState().setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    let resolveSetZoom: (applied: number) => void = () => undefined;
    mockedModule.setZoom.mockReturnValue(
      new Promise(resolve => {
        resolveSetZoom = resolve;
      }),
    );
    const { result, unmount } = await renderHook(() => useZoom('buffering'));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.setZoom(4);
    });
    await unmount();
    await act(async () => {
      resolveSetZoom(4);
      await pending;
    });

    expect(useCameraStore.getState().zoomFactor).toBe(1);
  });

  it('exposes pill levels once the range is known', async () => {
    useCameraStore.getState().setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });

    const { result } = await renderHook(() => useZoom('buffering'));

    expect(result.current.pillLevels).toContain(1);
    expect(result.current.pillLevels.length).toBeGreaterThan(1);
  });
});
