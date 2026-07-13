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
  reset: () => set(INITIAL_STATE),
}));
