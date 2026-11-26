import {
  getAnalytics,
  logEvent,
  logScreenView,
  setAnalyticsCollectionEnabled,
  setUserId,
  setUserProperties,
} from '@react-native-firebase/analytics';
import type { AnalyticsParams, AnalyticsProvider } from './AnalyticsProvider';

// Firebase's calls return promises; a failure (no Firebase app, offline
// edge cases) must never surface to the caller.
function ignore(promise: Promise<void>): void {
  promise.catch(() => undefined);
}

/** Firebase Analytics. It keeps events on disk and sends them when the phone is online again. */
export function createFirebaseProvider(): AnalyticsProvider {
  return {
    name: 'firebase',
    logEvent(name: string, params: AnalyticsParams) {
      ignore(logEvent(getAnalytics(), name, params));
    },
    logScreenView(screenName: string) {
      ignore(logScreenView(getAnalytics(), { screen_name: screenName, screen_class: screenName }));
    },
    setUserId(id: string | null) {
      ignore(setUserId(getAnalytics(), id));
    },
    setUserProperties(properties: Record<string, string | null>) {
      ignore(setUserProperties(getAnalytics(), properties));
    },
    setCollectionEnabled(enabled: boolean) {
      ignore(setAnalyticsCollectionEnabled(getAnalytics(), enabled));
    },
  };
}
