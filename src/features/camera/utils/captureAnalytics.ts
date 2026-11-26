import type { Lente } from '../../../analytics';
import { useSettingsStore } from '../../settings/store/settingsStore';
import { useCameraStore } from '../store/cameraStore';
import type { VideoFps, VideoQuality } from '../../../shared/types';

/** Below 1x the ultra-wide (0.5x) lens is the one capturing. */
export function lensForZoom(zoomFactor: number): Lente {
  return zoomFactor < 1 ? '0.5x' : '1x';
}

export interface CaptureContext {
  buffer_s: number;
  resolucao: VideoQuality;
  fps: VideoFps;
  lente: Lente;
}

/** The settings in effect right now, read from the stores (no render needed). */
export function currentCaptureContext(): CaptureContext {
  const settings = useSettingsStore.getState();
  return {
    buffer_s: settings.bufferSeconds,
    resolucao: settings.videoQuality,
    fps: settings.fps,
    lente: lensForZoom(useCameraStore.getState().zoomFactor),
  };
}
