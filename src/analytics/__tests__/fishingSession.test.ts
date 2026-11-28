import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RC from '@react-native-firebase/remote-config';
import { NativeModules } from 'react-native';
import { track } from '../track';

import {
  batteryDrop,
  initFishingSessions,
  noteBufferStarted,
  noteBufferStopped,
  noteCaptureSaved,
  parseStoredSession,
  recoveredReason,
  resetFishingSessionsForTests,
  sampleNowForTests,
  SESSION_GRACE_MS,
  stopReasonFor,
  type StoredSession,
} from '../fishingSession';
import { UNKNOWN_STATUS } from '../deviceStatus';

jest.unmock('../fishingSession');

const mockedTrack = track as jest.Mock;
const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;
const SETTINGS = { buffer_s: 30, lente: '1x' as const, resolucao: '1080p' as const, fps: 30 as const };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

let frames = 0;
let battery = 90;
function installNative() {
  (NativeModules as Record<string, unknown>).PegueiAnalytics = {
    getDeviceStatus: jest.fn(async () => ({
      batteryPct: battery,
      charging: false,
      thermalState: 'fair',
      storageFreeGb: 20,
      memoryMb: 250,
      encodedFrames: frames,
    })),
  };
}

function stored(partial: Partial<StoredSession>): StoredSession {
  return {
    startedAt: 1000,
    lastSeenAt: 61_000,
    stoppedAt: null,
    captures: 2,
    batteryStart: 80,
    batteryLast: 70,
    maxThermal: 'serious',
    appState: 'active',
    stopReason: null,
    ...partial,
  };
}

describe('fishing sessions', () => {
  beforeEach(async () => {
    jest.useRealTimers();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    setValues({});
    resetFishingSessionsForTests();
    frames = 0;
    battery = 90;
    installNative();
  });

  afterAll(() => {
    resetFishingSessionsForTests();
    delete (NativeModules as Record<string, unknown>).PegueiAnalytics;
  });

  it('starts one session with the device state, and a restart stays in it', async () => {
    noteBufferStarted(SETTINGS);
    await flush();
    noteBufferStopped();
    noteBufferStarted(SETTINGS);
    await flush();
    const started = mockedTrack.mock.calls.filter(c => c[0] === 'fishing_session_started');
    expect(started).toHaveLength(1);
    expect(started[0][1]).toEqual({
      buffer_s: 30,
      lente: '1x',
      resolucao: '1080p',
      fps: 30,
      battery_pct: 90,
      thermal_state: 'fair',
      // Tests run as iOS: free space is never sent there.
      storage_free_gb_bucket: 'nao_enviado',
    });
    expect(mockedTrack).not.toHaveBeenCalledWith('fishing_session_ended', expect.anything());
  });

  it('ends the session after the buffer stays off for the grace window', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    noteBufferStarted(SETTINGS);
    await flush();
    noteCaptureSaved();
    noteCaptureSaved();
    battery = 75;
    noteBufferStopped();
    await flush();
    jest.advanceTimersByTime(SESSION_GRACE_MS + 1);
    expect(mockedTrack).toHaveBeenCalledWith('fishing_session_ended', {
      duracao_min: expect.any(Number),
      capturas: 2,
      battery_drop_pct: 15,
      max_thermal_state: 'fair',
      motivo_fim: 'usuario',
    });
    expect(await AsyncStorage.getItem('peguei:fishingSession')).toBeNull();
  });

  it('samples dropped frames, memory and temperature', async () => {
    noteBufferStarted(SETTINGS);
    await flush();
    frames = 1000;
    await sampleNowForTests();
    expect(mockedTrack).toHaveBeenCalledWith('buffer_health_sampled', {
      dropped_frames_pct: expect.any(Number),
      memoria_mb: 250,
      thermal_state: 'fair',
    });
  });

  it('does not sample while the buffer is off', async () => {
    noteBufferStarted(SETTINGS);
    await flush();
    noteBufferStopped();
    await sampleNowForTests();
    expect(mockedTrack).not.toHaveBeenCalledWith('buffer_health_sampled', expect.anything());
  });

  it('sends nothing when session_metrics_enabled is off', async () => {
    setValues({ session_metrics_enabled: false });
    noteBufferStarted(SETTINGS);
    await flush();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('ends a session the last run left open as crash', async () => {
    await AsyncStorage.setItem('peguei:fishingSession', JSON.stringify(stored({})));
    await initFishingSessions();
    expect(mockedTrack).toHaveBeenCalledWith('fishing_session_ended', {
      duracao_min: 1,
      capturas: 2,
      battery_drop_pct: 10,
      max_thermal_state: 'serious',
      motivo_fim: 'crash',
    });
    expect(await AsyncStorage.getItem('peguei:fishingSession')).toBeNull();
  });

  it('works out why a recovered session ended', () => {
    expect(recoveredReason(stored({ appState: 'background' }))).toBe('background');
    expect(recoveredReason(stored({ stoppedAt: 5000, stopReason: 'bateria' }))).toBe('bateria');
    expect(recoveredReason(stored({ stoppedAt: 5000 }))).toBe('usuario');
  });

  it('works out why the buffer stopped from the device state', () => {
    expect(stopReasonFor({ ...UNKNOWN_STATUS, batteryPct: 4 }, 'active')).toBe('bateria');
    expect(stopReasonFor({ ...UNKNOWN_STATUS, batteryPct: 4, charging: true }, 'active')).toBe('usuario');
    expect(stopReasonFor({ ...UNKNOWN_STATUS, thermalState: 'critical' }, 'active')).toBe('termico');
    expect(stopReasonFor({ ...UNKNOWN_STATUS, storageFreeGb: 0.2 }, 'active')).toBe('armazenamento');
    expect(stopReasonFor(UNKNOWN_STATUS, 'background')).toBe('background');
    expect(stopReasonFor(UNKNOWN_STATUS, 'active')).toBe('usuario');
  });

  it('battery drop is never negative and -1 when unknown', () => {
    expect(batteryDrop(80, 60)).toBe(20);
    expect(batteryDrop(60, 80)).toBe(0);
    expect(batteryDrop(-1, 80)).toBe(-1);
  });

  it('ignores a broken stored session', () => {
    expect(parseStoredSession('not json')).toBeNull();
    expect(parseStoredSession('{"startedAt":"x"}')).toBeNull();
    expect(parseStoredSession(null)).toBeNull();
  });
});
