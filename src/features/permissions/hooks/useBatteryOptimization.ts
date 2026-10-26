import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { CircularBufferModule } from '../../camera/native/CircularBufferModule';

/**
 * 'unknown' until the first check resolves; 'unrestricted' means Android
 * already exempts Peguei from battery optimization (or this isn't Android).
 */
export type BatteryOptimizationStatus = 'unknown' | 'restricted' | 'unrestricted';

/**
 * Android-only concern: with battery optimization on, Doze can throttle or
 * kill the background-recording foreground service on some OEMs. iOS has
 * no equivalent switch (the native method always resolves true), so this
 * reports 'unrestricted' there without asking.
 *
 * Re-checks whenever the app returns to the foreground, because the only way
 * to change it is in system Settings (openSettings() leaves the app) -- the
 * card should reflect the new state the moment the user comes back.
 */
export function useBatteryOptimization() {
  const isAndroid = Platform.OS === 'android';
  const [status, setStatus] = useState<BatteryOptimizationStatus>(isAndroid ? 'unknown' : 'unrestricted');

  const refresh = useCallback(() => {
    if (!isAndroid) {
      return;
    }
    CircularBufferModule.isIgnoringBatteryOptimizations()
      .then(ignoring => setStatus(ignoring ? 'unrestricted' : 'restricted'))
      .catch(() => setStatus('unknown'));
  }, [isAndroid]);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const openSettings = useCallback(() => {
    CircularBufferModule.openBatteryOptimizationSettings().catch(() => undefined);
  }, []);

  return { status, isAndroid, refresh, openSettings };
}
