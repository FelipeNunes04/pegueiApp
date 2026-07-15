import { useCameraStore } from '../store/cameraStore';

describe('cameraStore', () => {
  beforeEach(() => {
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
});
