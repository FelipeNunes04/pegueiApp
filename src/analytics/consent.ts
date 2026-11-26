import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Local analytics opt-out (LGPD). Stored only on the phone. While the saved
 * choice is still being read at startup, track() holds events in memory and
 * sends or drops them once it is known.
 */
const STORAGE_KEY = 'peguei:analyticsOptOut';

interface ConsentState {
  hydrated: boolean;
  enabled: boolean;
}

export const useAnalyticsConsent = create<ConsentState>(() => ({
  hydrated: false,
  enabled: true,
}));

export async function loadAnalyticsConsent(): Promise<boolean> {
  let enabled = true;
  try {
    enabled = (await AsyncStorage.getItem(STORAGE_KEY)) !== 'true';
  } catch {
    enabled = true;
  }
  useAnalyticsConsent.setState({ hydrated: true, enabled });
  return enabled;
}

export function saveAnalyticsConsent(enabled: boolean): void {
  useAnalyticsConsent.setState({ hydrated: true, enabled });
  const write = enabled ? AsyncStorage.removeItem(STORAGE_KEY) : AsyncStorage.setItem(STORAGE_KEY, 'true');
  write.catch(() => undefined);
}
