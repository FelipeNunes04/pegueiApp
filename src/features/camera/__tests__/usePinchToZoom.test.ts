import { act, renderHook } from '@testing-library/react-native';
import { usePinchToZoom } from '../hooks/usePinchToZoom';

type Point = { pageX: number; pageY: number };

// PanResponder's onResponderGrant/onResponderMove read `event.touchHistory`
// (to compute the gesture centroid / dedupe simultaneous moves), so a test
// event must carry one -- a minimal touchBank is enough, since this hook only
// reads the two finger positions from `nativeEvent.touches`. Each move needs
// a fresh `mostRecentTimeStamp` or PanResponder drops it as a duplicate.
let timestamp = 0;
function touchEvent(touches: Point[] | number) {
  timestamp += 1;
  const list = typeof touches === 'number' ? new Array(touches).fill({ pageX: 0, pageY: 0 }) : touches;
  return {
    nativeEvent: { touches: list },
    touchHistory: {
      numberActiveTouches: list.length,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      // Single-touch math reads touchBank[indexOfSingleActiveTouch], so one
      // inactive record is needed for the one-finger case.
      touchBank: [
        {
          touchActive: false,
          startPageX: 0,
          startPageY: 0,
          startTimeStamp: 0,
          currentPageX: 0,
          currentPageY: 0,
          currentTimeStamp: 0,
          previousPageX: 0,
          previousPageY: 0,
          previousTimeStamp: 0,
        },
      ],
    },
  } as never;
}

const fingersApart = (distance: number): Point[] => [
  { pageX: 100, pageY: 100 },
  { pageX: 100 + distance, pageY: 100 },
];

describe('usePinchToZoom', () => {
  it('returns PanResponder pan handlers', async () => {
    const { result } = await renderHook(() => usePinchToZoom(1, jest.fn()));

    expect(typeof result.current.onStartShouldSetResponder).toBe('function');
    expect(typeof result.current.onResponderMove).toBe('function');
  });

  it('only claims the gesture for a two-finger touch, not a regular one-finger pan', async () => {
    const { result } = await renderHook(() => usePinchToZoom(1, jest.fn()));

    expect(result.current.onStartShouldSetResponder?.(touchEvent(2))).toBe(true);
    expect(result.current.onStartShouldSetResponder?.(touchEvent(1))).toBe(false);
    expect(result.current.onMoveShouldSetResponder?.(touchEvent(2))).toBe(true);
    expect(result.current.onMoveShouldSetResponder?.(touchEvent(1))).toBe(false);
  });

  it('spreading two fingers apart zooms in proportionally from the current zoom', async () => {
    const onZoomChange = jest.fn();
    const { result } = await renderHook(() => usePinchToZoom(2, onZoomChange));

    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderMove?.(touchEvent(fingersApart(150)));
    });

    expect(onZoomChange).toHaveBeenLastCalledWith(3);
  });

  it('pinching fingers together zooms out', async () => {
    const onZoomChange = jest.fn();
    const { result } = await renderHook(() => usePinchToZoom(2, onZoomChange));

    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(200)));
      result.current.onResponderMove?.(touchEvent(fingersApart(100)));
    });

    expect(onZoomChange).toHaveBeenLastCalledWith(1);
  });

  it('starts each pinch from the latest zoom, not the zoom at mount time', async () => {
    const onZoomChange = jest.fn();
    const { result, rerender } = await renderHook(
      ({ zoom }: { zoom: number }) => usePinchToZoom(zoom, onZoomChange),
      { initialProps: { zoom: 1 } },
    );

    await rerender({ zoom: 4 });
    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderMove?.(touchEvent(fingersApart(50)));
    });

    expect(onZoomChange).toHaveBeenLastCalledWith(2);
  });

  it('calls the latest onZoomChange callback after a re-render', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = await renderHook(
      ({ cb }: { cb: (z: number) => void }) => usePinchToZoom(1, cb),
      { initialProps: { cb: first } },
    );

    await rerender({ cb: second });
    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderMove?.(touchEvent(fingersApart(200)));
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(2);
  });

  it('ignores moves once one finger has lifted mid-pinch', async () => {
    const onZoomChange = jest.fn();
    const { result } = await renderHook(() => usePinchToZoom(1, onZoomChange));

    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderMove?.(touchEvent([{ pageX: 300, pageY: 300 }]));
    });

    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it('stops zooming after the gesture is released', async () => {
    const onZoomChange = jest.fn();
    const { result } = await renderHook(() => usePinchToZoom(1, onZoomChange));

    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderRelease?.(touchEvent(0));
      result.current.onResponderMove?.(touchEvent(fingersApart(300)));
    });

    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it('stops zooming after the gesture is terminated by another responder', async () => {
    const onZoomChange = jest.fn();
    const { result } = await renderHook(() => usePinchToZoom(1, onZoomChange));

    await act(async () => {
      result.current.onResponderGrant?.(touchEvent(fingersApart(100)));
      result.current.onResponderTerminate?.(touchEvent(0));
      result.current.onResponderMove?.(touchEvent(fingersApart(300)));
    });

    expect(onZoomChange).not.toHaveBeenCalled();
  });
});
