import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CircularBufferModule } from '../native/CircularBufferModule';
import { useSettingsStore } from '../../settings/store/settingsStore';
import { useIdleTimer } from './useIdleTimer';
import type { RecordingPhase } from '../../../shared/types';

/**
 * Pocket mode: a pure-black overlay over the camera screen while the native
 * side dims the backlight and stops compositing the preview
 * (setPocketMode) -- the buffer/recording keep running underneath. Meant
 * for "phone in the shirt pocket / on the dashboard, filming": the screen is
 * the single biggest battery drain once the encoder is running.
 *
 * Exits on its own whenever showing a black screen would hide something the
 * user needs or the screen is no longer ours to dim: the pipeline stopped
 * (idle -- e.g. auto-stop -- or error, so the banner is visible), the screen
 * lost focus (Gallery/Settings), or the app left the foreground. Every exit
 * path goes through the same `isActive` -> setPocketMode(false) sync, so the
 * native brightness is always restored.
 */
export function usePocketMode(phase: RecordingPhase, isFocused: boolean) {
  const autoEnabled = useSettingsStore(s => s.pocketModeAutoEnabled);
  const delaySeconds = useSettingsStore(s => s.pocketModeDelaySeconds);
  const [requested, setRequested] = useState(false);
  // currentState can still be 'unknown' (or null) this early on some
  // launches -- only an explicit background state counts as "not ours";
  // every later transition arrives through the change listener below.
  const [isAppActive, setIsAppActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setIsAppActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);

  const pipelineRunning = phase === 'buffering' || phase === 'recording' || phase === 'saving';
  const isActive = requested && pipelineRunning && isFocused && isAppActive;

  // Clear the request too (not just the derived flag) so coming back from
  // Gallery/background lands on the normal camera UI instead of silently
  // re-entering pocket mode.
  useEffect(() => {
    if (requested && !isActive) {
      setRequested(false);
    }
  }, [requested, isActive]);

  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current === isActive) {
      return;
    }
    sentRef.current = isActive;
    CircularBufferModule.setPocketMode(isActive).catch(() => undefined);
  }, [isActive]);

  useEffect(
    () => () => {
      if (sentRef.current) {
        sentRef.current = false;
        CircularBufferModule.setPocketMode(false).catch(() => undefined);
      }
    },
    [],
  );

  const enter = useCallback(() => setRequested(true), []);
  const exit = useCallback(() => setRequested(false), []);

  // Only while the buffer/recording is actually running -- auto-blacking
  // the screen during 'saving' would hide the save confirmation, and in
  // idle/error there's nothing to protect.
  const autoEligible =
    autoEnabled && !isActive && isFocused && isAppActive && (phase === 'buffering' || phase === 'recording');
  const markActivity = useIdleTimer(autoEligible, delaySeconds * 1000, enter);

  return { isActive, enter, exit, markActivity };
}
