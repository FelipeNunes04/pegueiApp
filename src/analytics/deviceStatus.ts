import { NativeModules, Platform } from 'react-native';
import type { StorageBucket, ThermalState, VideosBucket } from './events';

/**
 * Battery, temperature, storage, memory and frame counts read by the native
 * PegueiAnalytics module (ios/Analytics, android/.../analytics):
 * - iOS: `ProcessInfo.thermalState`, `UIDevice.batteryLevel`, free space of
 *   the app's volume, `phys_footprint`;
 * - Android: `PowerManager.getCurrentThermalStatus`, `BatteryManager`,
 *   `StatFs`, `Debug.getPss`.
 *
 * The native call runs on the module's own low-priority queue, never on the
 * camera or encoder threads, and the encoder only bumps a counter it already
 * holds a lock for. Called on session start, every 5 min and on session end.
 */

export interface DeviceStatus {
  /** 0-100, -1 when unknown (simulator). */
  batteryPct: number;
  charging: boolean;
  thermalState: ThermalState;
  /** Free GB on the app's volume, -1 when unknown. Used on the phone on both platforms; sent only on Android. */
  storageFreeGb: number;
  /** Memory the app uses, in MB, -1 when unknown. */
  memoryMb: number;
  /** Video frames the encoder produced since the process started. */
  encodedFrames: number;
}

interface NativeDeviceStatus {
  batteryPct?: unknown;
  charging?: unknown;
  thermalState?: unknown;
  storageFreeGb?: unknown;
  memoryMb?: unknown;
  encodedFrames?: unknown;
}

interface PegueiAnalyticsNative {
  getDeviceStatus?: () => Promise<NativeDeviceStatus>;
}

export const UNKNOWN_STATUS: DeviceStatus = {
  batteryPct: -1,
  charging: false,
  thermalState: 'unknown',
  storageFreeGb: -1,
  memoryMb: -1,
  encodedFrames: 0,
};

const THERMAL: readonly ThermalState[] = ['nominal', 'fair', 'serious', 'critical', 'unknown'];

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Native values checked and rounded. Pure; exported for tests. */
export function normalizeStatus(raw: NativeDeviceStatus | null | undefined): DeviceStatus {
  if (!raw || typeof raw !== 'object') return { ...UNKNOWN_STATUS };
  const thermal = typeof raw.thermalState === 'string' && (THERMAL as readonly string[]).includes(raw.thermalState)
    ? (raw.thermalState as ThermalState)
    : 'unknown';
  const battery = num(raw.batteryPct, -1);
  return {
    batteryPct: battery < 0 || battery > 100 ? -1 : Math.round(battery),
    charging: raw.charging === true,
    thermalState: thermal,
    storageFreeGb: Math.round(num(raw.storageFreeGb, -1) * 10) / 10,
    memoryMb: Math.round(num(raw.memoryMb, -1)),
    encodedFrames: Math.max(0, Math.floor(num(raw.encodedFrames, 0))),
  };
}

/** Reads the device state. Resolves UNKNOWN_STATUS when the native module is older or fails. */
export async function readDeviceStatus(): Promise<DeviceStatus> {
  const native = NativeModules.PegueiAnalytics as PegueiAnalyticsNative | undefined;
  if (!native || typeof native.getDeviceStatus !== 'function') return { ...UNKNOWN_STATUS };
  try {
    return normalizeStatus(await native.getDeviceStatus());
  } catch {
    return { ...UNKNOWN_STATUS };
  }
}

const THERMAL_RANK: Record<ThermalState, number> = { unknown: -1, nominal: 0, fair: 1, serious: 2, critical: 3 };

/** The hotter of two states. */
export function maxThermal(a: ThermalState, b: ThermalState): ThermalState {
  return THERMAL_RANK[b] > THERMAL_RANK[a] ? b : a;
}

export function isThermalAtLeast(state: ThermalState, floor: ThermalState): boolean {
  return THERMAL_RANK[state] >= THERMAL_RANK[floor];
}

export function storageBucket(gb: number): StorageBucket {
  if (!Number.isFinite(gb) || gb < 0) return 'desconhecido';
  if (gb < 1) return '<1';
  if (gb < 2) return '1-2';
  if (gb < 5) return '2-5';
  if (gb < 10) return '5-10';
  if (gb < 30) return '10-30';
  return '30+';
}

/**
 * Whether the free space may be sent. On iOS the disk space API is a
 * "required reason" API and the reason Peguei uses (E174.1, check there is
 * room to write files) does not allow sending it off the phone, not even as
 * a bucket. Android has no such rule.
 */
export function canReportStorage(os: string = Platform.OS): boolean {
  return os === 'android';
}

/** The bucket as sent to analytics: `nao_enviado` on iOS. */
export function reportedStorageBucket(gb: number, os: string = Platform.OS): StorageBucket {
  return canReportStorage(os) ? storageBucket(gb) : 'nao_enviado';
}

export function videosBucket(count: number): VideosBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 50) return '21-50';
  return '51+';
}

/**
 * Share of frames that did not come out of the encoder, against the
 * configured fps, in % with one decimal. A thermal fps step-down also counts
 * here (fewer frames than asked for). Pure; exported for tests.
 */
export function droppedFramesPct(framesDelta: number, elapsedMs: number, fps: number): number {
  if (elapsedMs <= 0 || fps <= 0 || framesDelta < 0) return 0;
  const expected = (elapsedMs / 1000) * fps;
  if (expected <= 0) return 0;
  const pct = (1 - framesDelta / expected) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}
