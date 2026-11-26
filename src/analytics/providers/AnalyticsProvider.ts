/** Values every provider accepts. Booleans are already turned into 1/0 by track(). */
export type AnalyticsParams = Record<string, string | number>;

/**
 * What the app needs from an analytics backend. Screens never talk to a
 * provider directly -- they call track() -- so swapping Firebase for another
 * backend is the one line in providers/index.ts.
 *
 * Implementations must never throw and never block the caller: track() is
 * called from the capture flow.
 */
export interface AnalyticsProvider {
  readonly name: string;
  logEvent(name: string, params: AnalyticsParams): void;
  logScreenView(screenName: string): void;
  setUserId(id: string | null): void;
  setUserProperties(properties: Record<string, string | null>): void;
  /** false stops all collection, automatic events included (opt-out). */
  setCollectionEnabled(enabled: boolean): void;
}
