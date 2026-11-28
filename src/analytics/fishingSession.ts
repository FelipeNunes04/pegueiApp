import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { getConfigNumber, getFlag } from '../config/remoteConfig';
import {
  droppedFramesPct,
  isThermalAtLeast,
  maxThermal,
  canReportStorage,
  readDeviceStatus,
  reportedStorageBucket,
  type DeviceStatus,
} from './deviceStatus';
import type { Lente, MotivoFim, ThermalState, VideoFps, VideoQuality } from './events';
import { setCrashKeys } from './observability';
import { track } from './track';

/**
 * A fishing session is the "real use" of Peguei: from the first buffer start
 * until the buffer has stayed off for SESSION_GRACE_MS. Going to the gallery
 * or settings and back (which stops and restarts the native buffer) stays in
 * the same session.
 *
 * Everything here runs on the JS thread on timers and lifecycle callbacks,
 * never on the capture path: the camera calls notify and return; the device
 * reading is a single async native call on the analytics queue.
 *
 * The open session is kept in AsyncStorage, so a session cut by a crash or by
 * the OS killing the app in the background is still ended (on the next
 * launch) with `motivo_fim` = `crash` or `background`.
 */

export interface SessionSettings {
  buffer_s: number;
  lente: Lente;
  resolucao: VideoQuality;
  fps: VideoFps;
}

/** What is kept on the phone while a session is open. Exported for tests. */
export interface StoredSession {
  startedAt: number;
  /** Last time the session was seen alive (start, capture, sample, stop). */
  lastSeenAt: number;
  /** When the buffer last stopped; null while it runs. */
  stoppedAt: number | null;
  captures: number;
  batteryStart: number;
  batteryLast: number;
  maxThermal: ThermalState;
  /** App state at the last write, to tell a crash from a background kill. */
  appState: 'active' | 'background';
  /** Why the buffer stopped, worked out at stop time. */
  stopReason: MotivoFim | null;
}

const STORAGE_KEY = 'peguei:fishingSession';
/** Buffer off for this long ends the session. */
export const SESSION_GRACE_MS = 10 * 60 * 1000;
/** Never sample more often than every 5 min. */
export const MIN_SAMPLE_INTERVAL_MIN = 5;
const LOW_BATTERY_PCT = 5;
const LOW_STORAGE_GB = 0.5;

let session: StoredSession | null = null;
let settings: SessionSettings | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let frameBase: { frames: number; at: number } | null = null;
let backgroundedAt: number | null = null;
let bufferRunning = false;
let appStateSub: NativeEventSubscription | null = null;
let recovered = false;
/** Called with the device reading of each new session (the storage warning uses it). */
let onSessionStatus: ((status: DeviceStatus) => void) | null = null;

function enabled(): boolean {
  return getFlag('session_metrics_enabled');
}

function persist(): void {
  if (!session) {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    return;
  }
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session)).catch(() => undefined);
}

function minutes(ms: number): number {
  return Math.max(0, Math.round((ms / 60000) * 10) / 10);
}

/** Battery used, never negative (charging), -1 when either end is unknown. Pure; exported for tests. */
export function batteryDrop(start: number, end: number): number {
  if (start < 0 || end < 0) return -1;
  return Math.max(0, start - end);
}

/**
 * Why the buffer stopped, from the device state at that moment. Pure;
 * exported for tests.
 */
export function stopReasonFor(status: DeviceStatus, appState: AppStateStatus): MotivoFim {
  if (status.batteryPct >= 0 && status.batteryPct <= LOW_BATTERY_PCT && !status.charging) return 'bateria';
  if (isThermalAtLeast(status.thermalState, 'critical')) return 'termico';
  if (status.storageFreeGb >= 0 && status.storageFreeGb < LOW_STORAGE_GB) return 'armazenamento';
  if (appState === 'background') return 'background';
  return 'usuario';
}

/** How a session left open by the last run ended. Pure; exported for tests. */
export function recoveredReason(stored: StoredSession): MotivoFim {
  if (stored.stoppedAt !== null) return stored.stopReason ?? 'usuario';
  return stored.appState === 'background' ? 'background' : 'crash';
}

/** Parses what AsyncStorage holds; null for anything unexpected. Exported for tests. */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.startedAt !== 'number' || typeof o.lastSeenAt !== 'number') return null;
    return {
      startedAt: o.startedAt,
      lastSeenAt: o.lastSeenAt,
      stoppedAt: typeof o.stoppedAt === 'number' ? o.stoppedAt : null,
      captures: typeof o.captures === 'number' ? o.captures : 0,
      batteryStart: typeof o.batteryStart === 'number' ? o.batteryStart : -1,
      batteryLast: typeof o.batteryLast === 'number' ? o.batteryLast : -1,
      maxThermal: typeof o.maxThermal === 'string' ? (o.maxThermal as ThermalState) : 'unknown',
      appState: o.appState === 'background' ? 'background' : 'active',
      stopReason: typeof o.stopReason === 'string' ? (o.stopReason as MotivoFim) : null,
    };
  } catch {
    return null;
  }
}

function endSession(stored: StoredSession, endAt: number, reason: MotivoFim): void {
  track('fishing_session_ended', {
    duracao_min: minutes(endAt - stored.startedAt),
    capturas: stored.captures,
    battery_drop_pct: batteryDrop(stored.batteryStart, stored.batteryLast),
    max_thermal_state: stored.maxThermal,
    motivo_fim: reason,
  });
}

function clearTimers(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
}

function applyStatus(status: DeviceStatus): void {
  if (!session) return;
  if (status.batteryPct >= 0) {
    if (session.batteryStart < 0) session.batteryStart = status.batteryPct;
    session.batteryLast = status.batteryPct;
  }
  session.maxThermal = maxThermal(session.maxThermal, status.thermalState);
  setCrashKeys({
    thermal_state: status.thermalState,
    ...(canReportStorage() && status.storageFreeGb >= 0 && { storage_free_gb: String(status.storageFreeGb) }),
  });
}

async function sample(): Promise<void> {
  if (!session || !settings || !bufferRunning || !enabled()) return;
  const status = await readDeviceStatus();
  if (!session) return;
  const now = Date.now();
  const base = frameBase;
  frameBase = { frames: status.encodedFrames, at: now };
  applyStatus(status);
  session.lastSeenAt = now;
  persist();
  track('buffer_health_sampled', {
    dropped_frames_pct: base ? droppedFramesPct(status.encodedFrames - base.frames, now - base.at, settings.fps) : 0,
    memoria_mb: status.memoryMb,
    thermal_state: status.thermalState,
  });
}

function startSampling(): void {
  if (sampleTimer) clearInterval(sampleTimer);
  const intervalMin = Math.max(MIN_SAMPLE_INTERVAL_MIN, getConfigNumber('buffer_sample_interval_min'));
  sampleTimer = setInterval(() => {
    sample().catch(() => undefined);
  }, intervalMin * 60 * 1000);
}

function finishOpenSession(reason: MotivoFim | null): void {
  if (!session) return;
  const stored = session;
  const endAt = stored.stoppedAt ?? Date.now();
  session = null;
  clearTimers();
  persist();
  endSession(stored, endAt, reason ?? stored.stopReason ?? 'usuario');
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background') {
    if (bufferRunning && backgroundedAt === null) backgroundedAt = Date.now();
    if (session) {
      session.appState = 'background';
      persist();
    }
    return;
  }
  if (next !== 'active') return;
  if (session) {
    session.appState = 'active';
    persist();
  }
  if (backgroundedAt !== null) {
    const seconds = Math.round((Date.now() - backgroundedAt) / 1000);
    backgroundedAt = null;
    if (session) track('app_backgrounded_during_buffer', { duracao_s: seconds });
  }
}

/**
 * Call once at startup: ends a session the last run left open (crash or
 * background kill) and starts listening to the app state. Never throws.
 */
export async function initFishingSessions(): Promise<void> {
  if (!appStateSub) appStateSub = AppState.addEventListener('change', onAppStateChange);
  if (recovered) return;
  recovered = true;
  try {
    const stored = parseStoredSession(await AsyncStorage.getItem(STORAGE_KEY));
    // A session started in this run while we were reading is not the old one.
    if (!stored || session) return;
    await AsyncStorage.removeItem(STORAGE_KEY);
    if (enabled()) endSession(stored, stored.stoppedAt ?? stored.lastSeenAt, recoveredReason(stored));
  } catch {
    // ignore
  }
}

/** The native buffer is running with these settings (useCircularBuffer, after startBuffering resolves). */
export function noteBufferStarted(current: SessionSettings): void {
  settings = current;
  bufferRunning = true;
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
  setCrashKeys({ buffer_s: String(current.buffer_s), lente: current.lente, resolucao: current.resolucao });
  if (!enabled()) return;
  const now = Date.now();
  if (session) {
    // Restart inside the grace window: same session.
    session.stoppedAt = null;
    session.stopReason = null;
    session.lastSeenAt = now;
    persist();
  } else {
    session = {
      startedAt: now,
      lastSeenAt: now,
      stoppedAt: null,
      captures: 0,
      batteryStart: -1,
      batteryLast: -1,
      maxThermal: 'unknown',
      appState: AppState.currentState === 'background' ? 'background' : 'active',
      stopReason: null,
    };
    persist();
    readDeviceStatus()
      .then(status => {
        applyStatus(status);
        persist();
        track('fishing_session_started', {
          buffer_s: current.buffer_s,
          lente: current.lente,
          resolucao: current.resolucao,
          fps: current.fps,
          battery_pct: status.batteryPct,
          thermal_state: status.thermalState,
          storage_free_gb_bucket: reportedStorageBucket(status.storageFreeGb),
        });
        onSessionStatus?.(status);
      })
      .catch(() => undefined);
  }
  readDeviceStatus()
    .then(status => {
      frameBase = { frames: status.encodedFrames, at: Date.now() };
    })
    .catch(() => undefined);
  startSampling();
}

/** The native buffer stopped. The session ends if it stays off for SESSION_GRACE_MS. */
export function noteBufferStopped(): void {
  bufferRunning = false;
  frameBase = null;
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
  if (!session) return;
  const stoppedAt = Date.now();
  session.stoppedAt = stoppedAt;
  session.lastSeenAt = stoppedAt;
  session.stopReason = AppState.currentState === 'background' ? 'background' : 'usuario';
  persist();
  const appState = AppState.currentState;
  readDeviceStatus()
    .then(status => {
      if (!session || session.stoppedAt !== stoppedAt) return;
      applyStatus(status);
      session.stopReason = stopReasonFor(status, appState);
      persist();
    })
    .catch(() => undefined);
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = setTimeout(() => finishOpenSession(null), SESSION_GRACE_MS);
}

/** A clip was saved in the current session. */
export function noteCaptureSaved(): void {
  if (!session) return;
  session.captures += 1;
  session.lastSeenAt = Date.now();
  persist();
}

export function setSessionStatusListener(listener: ((status: DeviceStatus) => void) | null): void {
  onSessionStatus = listener;
}

/** Tests only. */
export function resetFishingSessionsForTests(): void {
  clearTimers();
  session = null;
  settings = null;
  frameBase = null;
  backgroundedAt = null;
  bufferRunning = false;
  appStateSub?.remove();
  appStateSub = null;
  recovered = false;
  onSessionStatus = null;
}

/** Tests only. */
export const sampleNowForTests = sample;
