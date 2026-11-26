import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * JS side of the native PegueiAnalytics module (ios/Analytics,
 * android/.../analytics). Native code calls `PegueiAnalytics.track(...)`;
 * the module queues the event off the camera threads and hands it to JS as
 * `PegueiAnalyticsEvent`, so native events go through the same track()
 * path (opt-out, development mode, provider) as JS events.
 */
export const NATIVE_EVENT = 'PegueiAnalyticsEvent';

export interface NativeAnalyticsEvent {
  name: string;
  props?: Record<string, unknown>;
}

interface DeviceConstants {
  appVersion: string;
  buildNumber: string;
  deviceModel: string;
  osVersion: string;
}

interface PegueiAnalyticsNative {
  getConstants?: () => Partial<DeviceConstants>;
  appVersion?: string;
  buildNumber?: string;
  deviceModel?: string;
  osVersion?: string;
}

const nativeModule = NativeModules.PegueiAnalytics as PegueiAnalyticsNative | undefined;

export const nativeAnalyticsEvents = nativeModule
  ? new NativeEventEmitter(NativeModules.PegueiAnalytics)
  : undefined;

function readConstants(): Partial<DeviceConstants> {
  if (!nativeModule) return {};
  if (typeof nativeModule.getConstants === 'function') {
    try {
      return nativeModule.getConstants();
    } catch {
      return {};
    }
  }
  return nativeModule;
}

/** App and device info for the common event params. Falls back to what React Native knows. */
export function getDeviceConstants(): DeviceConstants {
  const c = readConstants();
  return {
    appVersion: c.appVersion ?? 'unknown',
    buildNumber: c.buildNumber ?? 'unknown',
    deviceModel: c.deviceModel ?? 'unknown',
    osVersion: c.osVersion ?? String(Platform.Version),
  };
}
