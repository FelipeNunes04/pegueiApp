import { useCallback, useEffect, useRef } from 'react';
import { CircularBufferModule } from '../native/CircularBufferModule';
import { useCameraStore } from '../store/cameraStore';
import { computeZoomPillLevels } from '../utils/zoom';
import type { RecordingPhase } from '../../../shared/types';

const ZOOM_INFO_POLL_MS = 300;
const ZOOM_INFO_MAX_ATTEMPTS = 12; // ~3.6s -- generous enough for openCameraAndStart() to finish opening the device.

/**
 * Queries the native zoom range once the buffer is running (retrying
 * briefly, since `startBuffering()`'s promise resolving doesn't mean the
 * camera device has actually finished opening yet -- see DECISIONS.md on
 * the buffering-race history) and exposes a clamped setZoom() plus the pill
 * levels to render.
 *
 * Takes `phase` as a parameter (from the same `useCircularBuffer()` call the
 * screen already makes) rather than re-subscribing to the recording store
 * directly, so this hook has exactly one source of truth for "is the buffer
 * actually running" -- the same one the rest of CameraScreen uses.
 */
export function useZoom(phase: RecordingPhase) {
  const minZoom = useCameraStore(s => s.minZoom);
  const maxZoom = useCameraStore(s => s.maxZoom);
  const hasUltraWide = useCameraStore(s => s.hasUltraWide);
  const zoomFactor = useCameraStore(s => s.zoomFactor);
  const setZoomRange = useCameraStore(s => s.setZoomRange);
  const setZoomFactorInStore = useCameraStore(s => s.setZoomFactor);

  const isMountedRef = useRef(true);
  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const isActive = phase === 'buffering' || phase === 'recording';

  useEffect(() => {
    if (!isActive || minZoom !== null) {
      return undefined;
    }
    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const attempt = async () => {
      attempts += 1;
      try {
        const info = await CircularBufferModule.getZoomInfo();
        if (isMountedRef.current) {
          setZoomRange(info);

          // The camera opens at whatever raw zoom factor the hardware
          // defaults to -- which is *not* guaranteed to be display "1x"
          // (on a triple/dual-wide-camera device it's the device's own
          // internal minimum, which is the ultra-wide lens; see
          // DECISIONS.md "Camera zoom"). Explicitly push the session's
          // current target zoom (the store's default of 1 on a fresh
          // launch, or the user's last-picked level if the camera is
          // reopening after navigating away and back within the same
          // session) so the actual framing always matches what the pills
          // display, instead of only correcting itself the next time the
          // user taps a pill or pinches.
          const targetFactor = useCameraStore.getState().zoomFactor;
          const clamped = Math.min(Math.max(targetFactor, info.minZoom), info.maxZoom);
          CircularBufferModule.setZoom(clamped)
            .then(applied => {
              if (isMountedRef.current) {
                setZoomFactorInStore(applied);
              }
            })
            .catch(() => undefined);
        }
      } catch {
        if (isMountedRef.current && attempts < ZOOM_INFO_MAX_ATTEMPTS) {
          timeoutId = setTimeout(attempt, ZOOM_INFO_POLL_MS);
        }
      }
    };
    attempt();

    return () => clearTimeout(timeoutId);
  }, [isActive, minZoom, setZoomRange, setZoomFactorInStore]);

  const setZoom = useCallback(
    async (factor: number) => {
      if (minZoom === null || maxZoom === null) {
        return;
      }
      const clamped = Math.min(Math.max(factor, minZoom), maxZoom);
      try {
        const applied = await CircularBufferModule.setZoom(clamped);
        if (isMountedRef.current) {
          setZoomFactorInStore(applied);
        }
      } catch {
        // Zoom is a nice-to-have, cosmetic control -- a transient native
        // rejection (e.g. mid-teardown) shouldn't surface as a user-facing
        // error banner the way a recording failure does.
      }
    },
    [minZoom, maxZoom, setZoomFactorInStore],
  );

  const pillLevels = maxZoom !== null ? computeZoomPillLevels(maxZoom, hasUltraWide) : [];

  return { zoomFactor, minZoom, maxZoom, hasUltraWide, pillLevels, setZoom };
}
