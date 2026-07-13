export interface TouchPoint {
  pageX: number;
  pageY: number;
}

export function distanceBetweenTouches([a, b]: TouchPoint[]): number {
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pure two-finger pinch tracking, deliberately kept independent of
 * `PanResponder` so it's directly unit-testable -- PanResponder's real
 * responder-system event objects carry an internal `touchHistory` that a
 * hand-built fake `GestureResponderEvent` in a test can't reproduce, the
 * same "test the pure algorithm, not the hardware/framework-bound wrapper"
 * approach already used for the native ring buffer (see
 * `SaveClipDurationTest`/`SaveClipDurationTests` in DECISIONS.md).
 */
export class PinchZoomTracker {
  private startDistance: number | null = null;
  private startZoom = 1;

  start(touches: TouchPoint[], currentZoom: number): void {
    if (touches.length === 2) {
      this.startDistance = distanceBetweenTouches(touches as [TouchPoint, TouchPoint]);
      this.startZoom = currentZoom;
    }
  }

  /** Returns the new zoom factor for a two-finger move, or null if this isn't an active pinch. */
  move(touches: TouchPoint[]): number | null {
    if (touches.length === 2 && this.startDistance) {
      const scale = distanceBetweenTouches(touches as [TouchPoint, TouchPoint]) / this.startDistance;
      return this.startZoom * scale;
    }
    return null;
  }

  end(): void {
    this.startDistance = null;
  }
}
