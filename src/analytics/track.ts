import { Platform } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import {
  isAnalyticsEventName,
  type AnalyticsEventName,
  type TrackArgs,
  type UserProperties,
} from './events';
import { loadAnalyticsConsent, saveAnalyticsConsent } from './consent';
import { getAnalyticsContext, setAnalyticsConnection, toConnection } from './context';
import {
  CONNECTION_EVENT,
  getDeviceConstants,
  nativeAnalyticsEvents,
  NATIVE_EVENT,
  type NativeAnalyticsEvent,
  type NativeConnectionEvent,
} from './nativeAnalytics';
import { breadcrumb, setObservabilityEnabled } from './observability';
import { getFlag } from '../config/remoteConfig';
import { createDefaultProvider, createFirebaseProvider } from './providers';
import type { AnalyticsParams, AnalyticsProvider } from './providers';

/**
 * The single way the app sends analytics. Calls never throw and never wait:
 * they're made from the capture flow, so the worst case is a lost event,
 * never a slower camera.
 */

// Firebase limits: 40-char param names, 100-char string values, 36-char user property values.
const MAX_STRING_LENGTH = 100;
const MAX_USER_PROPERTY_LENGTH = 36;
// Events made before the saved opt-out choice is read. Startup only, so small.
const MAX_PENDING = 50;

type Action = (provider: AnalyticsProvider) => void;

let provider: AnalyticsProvider = createDefaultProvider();
let consent: 'unknown' | 'enabled' | 'disabled' = 'unknown';
let pending: Action[] = [];
let commonParams: AnalyticsParams | null = null;
let nativeSubscription: EmitterSubscription | null = null;
let connectionSubscription: EmitterSubscription | null = null;
let initPromise: Promise<void> | null = null;

function getCommonParams(): AnalyticsParams {
  if (!commonParams) {
    const device = getDeviceConstants();
    commonParams = {
      app: 'peguei',
      app_version: device.appVersion,
      platform: Platform.OS,
      device_model: device.deviceModel,
      os_version: device.osVersion,
    };
  }
  return commonParams;
}

function toParamValue(value: unknown): string | number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  return null;
}

/**
 * Event props + common params, in the types Firebase accepts. `connection`,
 * `uf` and `region_geohash5` are read now, so they are the ones at the time
 * of the event; empty `uf`/region are left out. Exported for tests.
 */
export function toParams(props: object | undefined): AnalyticsParams {
  const ctx = getAnalyticsContext();
  const params: AnalyticsParams = { ...getCommonParams(), connection: ctx.connection };
  if (ctx.uf) params.uf = ctx.uf;
  if (ctx.region_geohash5) params.region_geohash5 = ctx.region_geohash5;
  if (!props) return params;
  for (const [key, value] of Object.entries(props)) {
    const converted = toParamValue(value);
    if (converted !== null) params[key] = converted;
  }
  return params;
}

function run(action: Action): void {
  if (consent === 'disabled') return;
  // Remote kill switch (default on). The local opt-out above always wins.
  if (!getFlag('analytics_enabled')) return;
  if (consent === 'unknown') {
    if (pending.length < MAX_PENDING) pending.push(action);
    return;
  }
  try {
    action(provider);
  } catch {
    // A provider bug must never reach the caller.
  }
}

function logEvent(name: AnalyticsEventName, props: object | undefined): void {
  const params = toParams(props);
  run(p => {
    p.logEvent(name, params);
    breadcrumb(name);
  });
}

/** Sends one event. The compiler checks the name and its props against events.ts. */
export function track<E extends AnalyticsEventName>(event: E, ...args: TrackArgs<E>): void {
  logEvent(event, args[0]);
}

export function screen(screenName: string): void {
  run(p => p.logScreenView(screenName));
}

/** Peguei has no accounts today; kept so a future login can tie events to a user. */
export function identify(userId: string | null): void {
  run(p => p.setUserId(userId));
}

export function setUserProperties(properties: Partial<UserProperties>): void {
  const values: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    values[key] = typeof value === 'string' && value ? value.slice(0, MAX_USER_PROPERTY_LENGTH) : null;
  }
  run(p => p.setUserProperties(values));
}

function handleNativeEvent(event: NativeAnalyticsEvent): void {
  if (!event || typeof event.name !== 'string' || !isAnalyticsEventName(event.name)) {
    if (__DEV__) console.warn('[analytics] unknown native event', event?.name);
    return;
  }
  logEvent(event.name, event.props);
}

function applyConsent(enabled: boolean): void {
  consent = enabled ? 'enabled' : 'disabled';
  if (provider.name !== 'firebase') {
    // Firebase's own automatic events (first_open, session_start) stay off
    // whenever it isn't the active provider, e.g. in development.
    try {
      createFirebaseProvider().setCollectionEnabled(false);
    } catch {
      // Firebase missing (broken build): nothing to switch off.
    }
  }
  try {
    provider.setCollectionEnabled(enabled);
  } catch {
    // ignore
  }
  setObservabilityEnabled(enabled);
  const queued = pending;
  pending = [];
  if (enabled) queued.forEach(run);
}

/** Reads the saved opt-out, then sends (or drops) what was queued. Call once at startup. */
export function initAnalytics(): Promise<void> {
  if (!nativeSubscription && nativeAnalyticsEvents) {
    nativeSubscription = nativeAnalyticsEvents.addListener(NATIVE_EVENT, handleNativeEvent);
  }
  if (!connectionSubscription && nativeAnalyticsEvents) {
    try {
      connectionSubscription = nativeAnalyticsEvents.addListener(CONNECTION_EVENT, (event: NativeConnectionEvent) =>
        setAnalyticsConnection(toConnection(event?.connection)),
      );
    } catch {
      // A native binary older than 1.3.0 does not declare this event.
    }
  }
  if (!initPromise) {
    initPromise = loadAnalyticsConsent().then(applyConsent);
  }
  return initPromise;
}

/** Settings switch. Turning it off also stops Firebase's automatic events, Crashlytics and Performance. */
export function setAnalyticsEnabled(enabled: boolean): void {
  saveAnalyticsConsent(enabled);
  applyConsent(enabled);
}

/** Tests only: swap the provider and reset the module state. */
export function resetAnalyticsForTests(testProvider: AnalyticsProvider): void {
  provider = testProvider;
  consent = 'unknown';
  pending = [];
  commonParams = null;
  initPromise = null;
  nativeSubscription?.remove();
  nativeSubscription = null;
  connectionSubscription?.remove();
  connectionSubscription = null;
}

/** Tests only: what a native event goes through. */
export const handleNativeEventForTests = handleNativeEvent;
