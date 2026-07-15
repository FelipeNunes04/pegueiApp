import { renderHook } from '@testing-library/react-native';
import { usePinchToZoom } from '../hooks/usePinchToZoom';

// PanResponder's onResponderGrant/onResponderMove read `event.touchHistory`,
// which a hand-built test event can't reproduce without crashing (see
// DECISIONS.md "Camera zoom" -- the pinch math itself is covered directly by
// pinchZoom.test.ts instead). onStartShouldSetResponder/onMoveShouldSetResponder
// are a plain passthrough to this hook's own predicates with no touchHistory
// involved, so they're safe to exercise here.
function touchEvent(touchCount: number) {
  return { nativeEvent: { touches: new Array(touchCount).fill({}) } } as never;
}

describe('usePinchToZoom', () => {
  it('returns PanResponder pan handlers', async () => {
    const { result } = await renderHook(() => usePinchToZoom(1, jest.fn()));

    expect(typeof result.current.onStartShouldSetResponder).toBe('function');
    expect(typeof result.current.onResponderMove).toBe('function');
  });

  it('only claims the gesture for a two-finger touch, not a regular one-finger pan', async () => {
    const { result } = await renderHook(() => usePinchToZoom(1, jest.fn()));

    expect(result.current.onStartShouldSetResponder?.(touchEvent(2))).toBe(
      true,
    );
    expect(result.current.onStartShouldSetResponder?.(touchEvent(1))).toBe(
      false,
    );
    expect(result.current.onMoveShouldSetResponder?.(touchEvent(2))).toBe(true);
    expect(result.current.onMoveShouldSetResponder?.(touchEvent(1))).toBe(
      false,
    );
  });
});
