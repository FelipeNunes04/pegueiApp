import { Platform } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import {
  isAnalyticsEventName,
  type AnalyticsEventName,
  type TrackArgs,
  type UserProperties,
} from './events';
import { loadAnalyticsConsent, saveAnalyticsConsent } from './consent';
import { getDeviceConstants, nativeAnalyticsEvents, NATIVE_EVENT, type NativeAnalyticsEvent } from './nativeAnalytics';
import { createDefaultProvider, createFirebaseProvider } from './providers';
import type { AnalyticsParams, AnalyticsProvider } from './providers';

/**
 * The single way the app sends analytics. Calls never throw and never wait:
 * they're made from the capture flow, so the worst case is a lost event,
 * never a slower camera.
 */

// Firebase limits: 40-char param names, 100-char string values.
const MAX_STRING_LENGTH = 100;
// Events made before the saved opt-out choice is read. Startup only, so small.
const MAX_PENDING = 50;

type Action = (provider: AnalyticsProvider) => void;

let provider: AnalyticsProvider = createDefaultProvider();
let consent: 'unknown' | 'enabled' | 'disabled' = 'unknown';
let pending: Action[] = [];
let commonParams: AnalyticsParams | null = null;
let nativeSubscription: EmitterSubscription | null = null;
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

/** Event props + common params, in the types Firebase accepts. Exported for tests. */
export function toParams(props: object | undefined): AnalyticsParams {
  const params: AnalyticsParams = { ...getCommonParams() };
  if (!props) return params;
  for (const [key, value] of Object.entries(props)) {
    const converted = toParamValue(value);
    if (converted !== null) params[key] = converted;
  }
  return params;
}

function run(action: Action): void {
  if (consent === 'disabled') return;
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
  run(p => p.logEvent(name, toParams(props)));
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
    values[key] = value ?? null;
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
  provider.setCollectionEnabled(enabled);
  const queued = pending;
  pending = [];
  if (enabled) queued.forEach(run);
}

/** Reads the saved opt-out, then sends (or drops) what was queued. Call once at startup. */
export function initAnalytics(): Promise<void> {
  if (!nativeSubscription && nativeAnalyticsEvents) {
    nativeSubscription = nativeAnalyticsEvents.addListener(NATIVE_EVENT, handleNativeEvent);
  }
  if (!initPromise) {
    initPromise = loadAnalyticsConsent().then(applyConsent);
  }
  return initPromise;
}

/** Settings switch. Turning it off also stops Firebase's automatic events. */
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
}

/** Tests only: what a native event goes through. */
export const handleNativeEventForTests = handleNativeEvent;
