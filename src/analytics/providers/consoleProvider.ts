import type { AnalyticsParams, AnalyticsProvider } from './AnalyticsProvider';

/** Development only: prints each event and sends nothing. */
export function createConsoleProvider(): AnalyticsProvider {
  return {
    name: 'console',
    logEvent(name: string, params: AnalyticsParams) {
      console.log('[analytics]', name, params);
    },
    logScreenView(screenName: string) {
      console.log('[analytics] screen', screenName);
    },
    setUserId(id: string | null) {
      console.log('[analytics] user id', id);
    },
    setUserProperties(properties: Record<string, string | null>) {
      console.log('[analytics] user properties', properties);
    },
    setCollectionEnabled(enabled: boolean) {
      console.log('[analytics] collection enabled', enabled);
    },
  };
}
