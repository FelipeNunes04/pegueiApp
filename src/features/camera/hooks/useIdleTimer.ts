import { useCallback, useEffect, useRef } from 'react';

// Long single setTimeouts (the 2 h auto-stop) are split into chunks: RN on
// Android has historically warned about / mis-scheduled timers longer than a
// minute, and a chunked deadline re-check costs one wake-up per minute at most.
const MAX_TIMEOUT_CHUNK_MS = 60_000;

/**
 * Calls onIdle once `timeoutMs` passes with no markActivity() call while
 * `enabled` is true. Becoming enabled (or changing timeoutMs) restarts the
 * countdown from now.
 *
 * markActivity() only writes a ref -- it's meant to be called from
 * onTouchStart on every touch, so it deliberately doesn't clear/reschedule a
 * timer or trigger a re-render. Instead the pending timeout re-checks the
 * real deadline when it fires and re-arms itself for whatever is left.
 *
 * Fires at most once per enabled period: callers are expected to flip
 * `enabled` off as a result of onIdle (pocket mode becomes active, the
 * buffer stops), which is also what re-arms it later.
 */
export function useIdleTimer(enabled: boolean, timeoutMs: number, onIdle: () => void): () => void {
  const lastActivityRef = useRef(Date.now());
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) {
      return undefined;
    }
    lastActivityRef.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const remaining = lastActivityRef.current + timeoutMs - Date.now();
      if (remaining <= 0) {
        timer = undefined;
        onIdleRef.current();
        return;
      }
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_CHUNK_MS));
    };
    timer = setTimeout(check, Math.min(timeoutMs, MAX_TIMEOUT_CHUNK_MS));
    return () => clearTimeout(timer);
  }, [enabled, timeoutMs]);

  return useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);
}
