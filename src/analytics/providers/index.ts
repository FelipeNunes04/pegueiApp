import type { AnalyticsProvider } from './AnalyticsProvider';
import { createConsoleProvider } from './consoleProvider';
import { createFirebaseProvider } from './firebaseProvider';

export type { AnalyticsParams, AnalyticsProvider } from './AnalyticsProvider';

/**
 * The one line to change to use another analytics backend. In development
 * nothing is sent: events are only printed. Firebase's own automatic events
 * (first_open, session_start) are switched off in development by track.ts.
 */
export function createDefaultProvider(): AnalyticsProvider {
  return __DEV__ ? createConsoleProvider() : createFirebaseProvider();
}

export { createConsoleProvider, createFirebaseProvider };
