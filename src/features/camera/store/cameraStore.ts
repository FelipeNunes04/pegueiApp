import { create } from 'zustand';
import { CircularBufferModule } from '../native/CircularBufferModule';
import type { CaptureCapabilities } from '../../../shared/types';

interface CameraState {
  /** Null until the first successful getZoomInfo() call once the buffer is running. */
  minZoom: number | null;
  maxZoom: number | null;
  hasUltraWide: boolean;
  /** Current zoom factor -- session-only, intentionally not persisted across app restarts (see DECISIONS.md). */
  zoomFactor: number;
  /** Null until loadCaptureCapabilities() resolves at least once -- see its own doc comment. */
  captureCapabilities: CaptureCapabilities | null;
  setZoomRange: (info: { minZoom: number; maxZoom: number; hasUltraWide: boolean }) => void;
  setZoomFactor: (factor: number) => void;
  /**
   * Forces the next getZoomInfo() poll (see useZoom.ts) to run again --
   * e.g. when the screen regains focus after the native camera session
   * silently restarted (navigating away and back re-detaches/re-attaches
   * the preview, which reopens the device at its hardware-default zoom).
   * Deliberately does not touch zoomFactor: unlike reset(), this must
   * preserve the user's last-picked level so useZoom's correction effect
   * has something to reapply, not just fall back to 1x.
   */
  invalidateZoomRange: () => void;
  /**
   * Queries which quality/fps combinations this device's back camera
   * actually supports, once per app session (a real camera's capabilities
   * don't change at runtime) -- cached in this store so SettingsScreen and
   * useCircularBuffer.start() both read the same result without re-hitting
   * the native bridge on every render/settings change. Never rejects: a
   * failed/unsupported query resolves to the "unknown, don't restrict
   * anything" shape (empty supportedQualities) instead, since not being
   * able to determine capabilities shouldn't itself block recording.
   */
  loadCaptureCapabilities: () => Promise<CaptureCapabilities>;
  reset: () => void;
}

const INITIAL_STATE = {
  minZoom: null as number | null,
  maxZoom: null as number | null,
  hasUltraWide: false,
  zoomFactor: 1,
  captureCapabilities: null as CaptureCapabilities | null,
};

const UNKNOWN_CAPABILITIES: CaptureCapabilities = { supportedQualities: [], fpsByQuality: {} };

let pendingLoad: Promise<CaptureCapabilities> | null = null;

export const useCameraStore = create<CameraState>((set, get) => ({
  ...INITIAL_STATE,
  setZoomRange: ({ minZoom, maxZoom, hasUltraWide }) => set({ minZoom, maxZoom, hasUltraWide }),
  setZoomFactor: factor => set({ zoomFactor: factor }),
  invalidateZoomRange: () => set({ minZoom: null, maxZoom: null }),
  loadCaptureCapabilities: () => {
    const cached = get().captureCapabilities;
    if (cached) return Promise.resolve(cached);
    if (pendingLoad) return pendingLoad;

    pendingLoad = CircularBufferModule.getCaptureCapabilities()
      .catch(() => UNKNOWN_CAPABILITIES)
      .then(capabilities => {
        set({ captureCapabilities: capabilities });
        pendingLoad = null;
        return capabilities;
      });
    return pendingLoad;
  },
  reset: () => {
    pendingLoad = null;
    set(INITIAL_STATE);
  },
}));
