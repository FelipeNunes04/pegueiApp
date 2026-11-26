import { currentCaptureContext, lensForZoom } from '../utils/captureAnalytics';
import { useCameraStore } from '../store/cameraStore';
import { useSettingsStore } from '../../settings/store/settingsStore';

describe('captureAnalytics', () => {
  it('reports the ultra-wide lens below 1x', () => {
    expect(lensForZoom(0.5)).toBe('0.5x');
    expect(lensForZoom(1)).toBe('1x');
    expect(lensForZoom(2.5)).toBe('1x');
  });

  it('reads the settings and zoom in effect', () => {
    useSettingsStore.setState({ bufferSeconds: 45, videoQuality: '720p', fps: 60 });
    useCameraStore.setState({ zoomFactor: 0.5 });

    expect(currentCaptureContext()).toEqual({ buffer_s: 45, resolucao: '720p', fps: 60, lente: '0.5x' });
  });
});
