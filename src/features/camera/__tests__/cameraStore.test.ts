import { useCameraStore } from '../store/cameraStore';
import { CircularBufferModule } from '../native/CircularBufferModule';
import type { CaptureCapabilities } from '../../../shared/types';

jest.mock('../native/CircularBufferModule', () => ({
  CircularBufferModule: {
    getCaptureCapabilities: jest.fn(),
  },
}));

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

describe('cameraStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCameraStore.getState().reset();
  });

  it('starts with no known zoom range and a 1x factor', () => {
    const state = useCameraStore.getState();
    expect(state.minZoom).toBeNull();
    expect(state.maxZoom).toBeNull();
    expect(state.hasUltraWide).toBe(false);
    expect(state.zoomFactor).toBe(1);
  });

  it('setZoomRange stores the reported min/max/hasUltraWide', () => {
    useCameraStore
      .getState()
      .setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    const state = useCameraStore.getState();
    expect(state.minZoom).toBe(0.5);
    expect(state.maxZoom).toBe(8);
    expect(state.hasUltraWide).toBe(true);
  });

  it('setZoomFactor updates only the current factor', () => {
    useCameraStore
      .getState()
      .setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    useCameraStore.getState().setZoomFactor(2);
    const state = useCameraStore.getState();
    expect(state.zoomFactor).toBe(2);
    expect(state.minZoom).toBe(0.5);
  });

  it('invalidateZoomRange clears the range but preserves the chosen zoom factor', () => {
    useCameraStore
      .getState()
      .setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    useCameraStore.getState().setZoomFactor(2);

    useCameraStore.getState().invalidateZoomRange();

    const state = useCameraStore.getState();
    expect(state.minZoom).toBeNull();
    expect(state.maxZoom).toBeNull();
    expect(state.zoomFactor).toBe(2);
  });

  it('reset restores the initial state entirely, including the zoom factor', () => {
    useCameraStore
      .getState()
      .setZoomRange({ minZoom: 0.5, maxZoom: 8, hasUltraWide: true });
    useCameraStore.getState().setZoomFactor(3);

    useCameraStore.getState().reset();

    expect(useCameraStore.getState()).toMatchObject({
      minZoom: null,
      maxZoom: null,
      hasUltraWide: false,
      zoomFactor: 1,
    });
  });

  describe('loadCaptureCapabilities', () => {
    it('stores the result of the native query', async () => {
      mockedModule.getCaptureCapabilities.mockResolvedValue({
        supportedQualities: ['720p', '1080p'],
        fpsByQuality: { '720p': [24, 30], '1080p': [24, 30] },
      });

      const result = await useCameraStore.getState().loadCaptureCapabilities();

      expect(result).toEqual({ supportedQualities: ['720p', '1080p'], fpsByQuality: { '720p': [24, 30], '1080p': [24, 30] } });
      expect(useCameraStore.getState().captureCapabilities).toEqual(result);
    });

    it('caches the result -- a second call does not hit the native bridge again', async () => {
      mockedModule.getCaptureCapabilities.mockResolvedValue({ supportedQualities: ['4k'], fpsByQuality: {} });

      await useCameraStore.getState().loadCaptureCapabilities();
      await useCameraStore.getState().loadCaptureCapabilities();

      expect(mockedModule.getCaptureCapabilities).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent calls into a single native query', async () => {
      let resolveNative: (value: CaptureCapabilities) => void = () => undefined;
      mockedModule.getCaptureCapabilities.mockReturnValue(
        new Promise(resolve => {
          resolveNative = resolve;
        }),
      );

      const first = useCameraStore.getState().loadCaptureCapabilities();
      const second = useCameraStore.getState().loadCaptureCapabilities();
      resolveNative({ supportedQualities: ['1080p'], fpsByQuality: {} });

      await Promise.all([first, second]);
      expect(mockedModule.getCaptureCapabilities).toHaveBeenCalledTimes(1);
    });

    it('resolves to "unknown" (not a rejection) when the native query fails', async () => {
      mockedModule.getCaptureCapabilities.mockRejectedValue(new Error('not linked'));

      const result = await useCameraStore.getState().loadCaptureCapabilities();

      expect(result).toEqual({ supportedQualities: [], fpsByQuality: {} });
    });

    it('reset() clears the cache so the next call re-queries the native bridge', async () => {
      mockedModule.getCaptureCapabilities.mockResolvedValue({ supportedQualities: ['4k'], fpsByQuality: {} });
      await useCameraStore.getState().loadCaptureCapabilities();

      useCameraStore.getState().reset();
      await useCameraStore.getState().loadCaptureCapabilities();

      expect(mockedModule.getCaptureCapabilities).toHaveBeenCalledTimes(2);
    });
  });
});
