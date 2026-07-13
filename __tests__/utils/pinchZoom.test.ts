import { PinchZoomTracker } from '../../src/utils/pinchZoom';

describe('PinchZoomTracker', () => {
  it('scales zoom proportionally to the change in distance between two touches', () => {
    const tracker = new PinchZoomTracker();

    tracker.start(
      [
        { pageX: 0, pageY: 0 },
        { pageX: 100, pageY: 0 },
      ],
      1,
    );

    // Fingers moved twice as far apart -> distance doubled -> zoom should double.
    const newZoom = tracker.move([
      { pageX: 0, pageY: 0 },
      { pageX: 200, pageY: 0 },
    ]);

    expect(newZoom).toBe(2);
  });

  it('ignores single-touch gestures (does not treat a regular pan as a pinch)', () => {
    const tracker = new PinchZoomTracker();

    tracker.start([{ pageX: 0, pageY: 0 }], 1);
    const result = tracker.move([{ pageX: 50, pageY: 0 }]);

    expect(result).toBeNull();
  });

  it('starts each new pinch from the zoom factor passed to start(), not a stale one', () => {
    const tracker = new PinchZoomTracker();

    tracker.start(
      [
        { pageX: 0, pageY: 0 },
        { pageX: 100, pageY: 0 },
      ],
      2,
    );

    const newZoom = tracker.move([
      { pageX: 0, pageY: 0 },
      { pageX: 150, pageY: 0 },
    ]);

    // Distance grew 1.5x, starting from zoom 2 -> 3, not 1.5.
    expect(newZoom).toBe(3);
  });

  it('stops reporting a pinch after end() until a new start()', () => {
    const tracker = new PinchZoomTracker();
    tracker.start(
      [
        { pageX: 0, pageY: 0 },
        { pageX: 100, pageY: 0 },
      ],
      1,
    );
    tracker.end();

    const result = tracker.move([
      { pageX: 0, pageY: 0 },
      { pageX: 200, pageY: 0 },
    ]);

    expect(result).toBeNull();
  });
});
