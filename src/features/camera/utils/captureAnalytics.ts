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

/**
 * Short, stable text for capture_failed: the stage plus the native error
 * code when there is one (E_SAVE_FAILED, E_NOT_BUFFERING...), otherwise the
 * start of the message. Never includes file paths.
 */
export function captureErrorLabel(stage: 'buffer_start' | 'record_start' | 'record_stop' | 'native' | 'finalized', err: unknown): string {
  let detail = 'unknown';
  if (err && typeof err === 'object') {
    const { code, message } = err as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && code) detail = code;
    else if (typeof message === 'string' && message) detail = message;
  } else if (typeof err === 'string' && err) {
    detail = err;
  }
  return `${stage}:${detail.replace(/\/\S+/g, '<path>')}`.slice(0, 100);
}

/** Minutes with one decimal, for buffer_stopped. */
export function minutesSince(startedAt: number, now: number = Date.now()): number {
  return Math.round(((now - startedAt) / 60000) * 10) / 10;
}
