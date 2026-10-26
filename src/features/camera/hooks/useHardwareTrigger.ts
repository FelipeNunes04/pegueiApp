import { useEffect, useRef } from 'react';
import {
  CircularBufferModule,
  circularBufferEvents,
  type CircularBufferHardwareTriggerEvent,
} from '../native/CircularBufferModule';

/**
 * Volume up/down presses can arrive as a pair from one physical click on
 * some Bluetooth shutter remotes (they send VOLUME_UP *and* ENTER), and a
 * user mashing the button would otherwise start and immediately stop a
 * recording -- anything closer than this to the previous trigger is dropped.
 */
export const HARDWARE_TRIGGER_DEBOUNCE_MS = 600;

/**
 * Turns the native hardware-trigger interception on while `enabled` (the
 * setting is on AND the camera screen is the one in front -- volume keys
 * must go back to controlling volume in Gallery/ClipPreview), and forwards
 * debounced CircularBufferHardwareTrigger events to onTrigger. onTrigger is
 * read through a ref, so it always sees the caller's latest phase without
 * resubscribing on every render.
 */
export function useHardwareTrigger(
  enabled: boolean,
  onTrigger: (event: CircularBufferHardwareTriggerEvent) => void,
) {
  const onTriggerRef = useRef(onTrigger);
  const lastTriggerAtRef = useRef(0);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    CircularBufferModule.setHardwareTriggerEnabled(true).catch(() => undefined);
    const subscription = circularBufferEvents?.addListener(
      'CircularBufferHardwareTrigger',
      (event: CircularBufferHardwareTriggerEvent) => {
        const now = Date.now();
        if (now - lastTriggerAtRef.current < HARDWARE_TRIGGER_DEBOUNCE_MS) {
          return;
        }
        lastTriggerAtRef.current = now;
        onTriggerRef.current(event);
      },
    );
    return () => {
      subscription?.remove();
      CircularBufferModule.setHardwareTriggerEnabled(false).catch(() => undefined);
    };
  }, [enabled]);
}
