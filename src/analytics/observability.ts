import {
  getCrashlytics,
  log as crashLog,
  recordError as crashRecordError,
  setAttributes as crashSetAttributes,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics';
import { getPerformance, trace as perfTrace } from '@react-native-firebase/perf';

/**
 * Crashlytics (crashes, non-fatal errors, breadcrumbs, custom keys) and
 * Performance Monitoring (custom traces), the same shape as Pesca Certa's
 * analytics/observability.ts. Everything here is called from JS, never from
 * the camera or encoder threads, and nothing throws: a Firebase failure is
 * a lost metric, never a slower camera.
 */

/** Every custom trace (docs/analytics.md, "Performance"). */
export type TraceName = 'camera_cold_start' | 'buffer_start' | 'capture_save' | 'export_9_16';

/** Crashlytics custom keys. No personal data: settings, lens, device state. */
export interface CrashKeys {
  buffer_s: string;
  lente: string;
  resolucao: string;
  thermal_state: string;
  /** Android only (see docs/privacidade.md). */
  storage_free_gb: string;
  app: string;
}

export interface TraceHandle {
  putAttribute(name: string, value: string): void;
  putMetric(name: string, value: number): void;
  stop(): void;
}

const NOOP_TRACE: TraceHandle = {
  putAttribute: () => undefined,
  putMetric: () => undefined,
  stop: () => undefined,
};

/** Development builds send no crash or performance data. */
let enabled = !__DEV__;

function quiet(result: unknown): void {
  if (result instanceof Promise) result.catch(() => undefined);
}

/** Follows the analytics opt-out. Always off in development. */
export function setObservabilityEnabled(on: boolean): void {
  enabled = on && !__DEV__;
  try {
    quiet(setCrashlyticsCollectionEnabled(getCrashlytics(), enabled));
  } catch {
    // Firebase missing: nothing to switch.
  }
  try {
    const perf = getPerformance();
    perf.dataCollectionEnabled = enabled;
    perf.instrumentationEnabled = enabled;
  } catch {
    // Firebase missing: nothing to switch.
  }
}

/** A line in the Crashlytics log, shown with the next crash or non-fatal error. */
export function breadcrumb(message: string): void {
  if (!enabled) return;
  try {
    crashLog(getCrashlytics(), message.slice(0, 300));
  } catch {
    // ignore
  }
}

/** Non-fatal error. `where` says which flow it came from, e.g. "export". */
export function recordError(error: unknown, where: string): void {
  if (!enabled) return;
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'unknown error');
    const crashlytics = getCrashlytics();
    crashLog(crashlytics, `non_fatal ${where}`);
    crashRecordError(crashlytics, err, where);
  } catch {
    // ignore
  }
}

export function setCrashKeys(keys: Partial<CrashKeys>): void {
  if (!enabled) return;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(keys)) {
    if (typeof value === 'string') values[key] = value.slice(0, 100);
  }
  try {
    quiet(crashSetAttributes(getCrashlytics(), values));
  } catch {
    // ignore
  }
}

export function startTrace(name: TraceName): TraceHandle {
  if (!enabled) return NOOP_TRACE;
  try {
    const t = perfTrace(getPerformance(), name);
    quiet(t.start());
    let stopped = false;
    return {
      putAttribute(attr, value) {
        if (stopped) return;
        try {
          // Firebase: attribute names up to 40 chars, values up to 100.
          t.putAttribute(attr.slice(0, 40), value.slice(0, 100));
        } catch {
          // ignore
        }
      },
      putMetric(metric, value) {
        if (stopped || !Number.isFinite(value)) return;
        try {
          t.putMetric(metric.slice(0, 100), Math.round(value));
        } catch {
          // ignore
        }
      },
      stop() {
        if (stopped) return;
        stopped = true;
        try {
          quiet(t.stop());
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return NOOP_TRACE;
  }
}

/** Tests only. */
export function resetObservabilityForTests(on: boolean): void {
  enabled = on;
}
