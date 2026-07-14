import { create } from 'zustand';

interface CameraState {
  /** Null until the first successful getZoomInfo() call once the buffer is running. */
  minZoom: number | null;
  maxZoom: number | null;
  hasUltraWide: boolean;
  /** Current zoom factor -- session-only, intentionally not persisted across app restarts (see DECISIONS.md). */
  zoomFactor: number;
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
  reset: () => void;
}

const INITIAL_STATE = {
  minZoom: null as number | null,
  maxZoom: null as number | null,
  hasUltraWide: false,
  zoomFactor: 1,
};

export const useCameraStore = create<CameraState>(set => ({
  ...INITIAL_STATE,
  setZoomRange: ({ minZoom, maxZoom, hasUltraWide }) => set({ minZoom, maxZoom, hasUltraWide }),
  setZoomFactor: factor => set({ zoomFactor: factor }),
  invalidateZoomRange: () => set({ minZoom: null, maxZoom: null }),
  reset: () => set(INITIAL_STATE),
}));
