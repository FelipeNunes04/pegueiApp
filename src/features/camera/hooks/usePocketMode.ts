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
 * lost focus (Gallery/Settings), or the app was backgrounded. Every exit
 * path goes through the same `isActive` -> setPocketMode(false) sync, so the
 * native brightness is always restored. A plain 'inactive' (iOS Control
 * Center, call alert) isn't an exit: the screen is still ours, and native
 * already restores brightness on resign and re-dims on becoming active.
 */
export function usePocketMode(phase: RecordingPhase, isFocused: boolean) {
  const autoEnabled = useSettingsStore(s => s.pocketModeAutoEnabled);
  const delaySeconds = useSettingsStore(s => s.pocketModeDelaySeconds);
  const [requested, setRequested] = useState(false);
  // currentState can still be 'unknown' (or null) this early on some
  // launches -- only an explicit background state counts as "not ours";
  // every later transition arrives through the change listener below.
  const [appState, setAppState] = useState(AppState.currentState);
  const isBackgrounded = appState === 'background';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const pipelineRunning = phase === 'buffering' || phase === 'recording' || phase === 'saving';
  const isActive = requested && pipelineRunning && isFocused && !isBackgrounded;

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
  // idle/error there's nothing to protect. Nor while 'inactive': the user is
  // looking at Control Center or a call alert, not leaving the phone alone.
  const autoEligible =
    autoEnabled &&
    !isActive &&
    isFocused &&
    !isBackgrounded &&
    appState !== 'inactive' &&
    (phase === 'buffering' || phase === 'recording');
  const markActivity = useIdleTimer(autoEligible, delaySeconds * 1000, enter);

  return { isActive, enter, exit, markActivity };
}
