import { useRef } from 'react';
import { PanResponder } from 'react-native';
import { PinchZoomTracker } from '../utils/pinchZoom';

/**
 * Continuous two-finger pinch-to-zoom over the camera preview, synced with
 * the same setZoom() the fixed-level pills use (see useZoom.ts) -- there's
 * no separate native zoom state, pinch and pills both drive/read the same
 * `zoomFactor`. Implemented with the core `PanResponder` (multi-touch is
 * available on `evt.nativeEvent.touches` without any extra gesture
 * library) rather than adding `react-native-gesture-handler`, consistent
 * with this project's preference for avoiding new native dependencies when
 * a built-in API already covers the need (see the blur-vs-scrim decision in
 * DECISIONS.md). The actual pinch math lives in `PinchZoomTracker`
 * (utils/pinchZoom.ts) so it can be unit-tested without PanResponder.
 */
export function usePinchToZoom(currentZoom: number, onZoomChange: (zoom: number) => void) {
  const currentZoomRef = useRef(currentZoom);
  currentZoomRef.current = currentZoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const trackerRef = useRef(new PinchZoomTracker());

  const panResponderRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: evt => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: evt => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: evt => {
        trackerRef.current.start(evt.nativeEvent.touches, currentZoomRef.current);
      },
      onPanResponderMove: evt => {
        const newZoom = trackerRef.current.move(evt.nativeEvent.touches);
        if (newZoom !== null) {
          onZoomChangeRef.current(newZoom);
        }
      },
      onPanResponderRelease: () => trackerRef.current.end(),
      onPanResponderTerminate: () => trackerRef.current.end(),
    }),
  );

  return panResponderRef.current.panHandlers;
}
