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
});
