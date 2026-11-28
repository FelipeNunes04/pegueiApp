import { NativeModules } from 'react-native';
import {
  canReportStorage,
  droppedFramesPct,
  isThermalAtLeast,
  maxThermal,
  normalizeStatus,
  readDeviceStatus,
  reportedStorageBucket,
  storageBucket,
  UNKNOWN_STATUS,
  videosBucket,
} from '../deviceStatus';

describe('deviceStatus', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).PegueiAnalytics;
  });

  it('normalizes what native sends', () => {
    expect(
      normalizeStatus({ batteryPct: 81.6, charging: true, thermalState: 'fair', storageFreeGb: 12.345, memoryMb: 301.4, encodedFrames: 900.7 }),
    ).toEqual({ batteryPct: 82, charging: true, thermalState: 'fair', storageFreeGb: 12.3, memoryMb: 301, encodedFrames: 900 });
    expect(normalizeStatus({ batteryPct: 140, thermalState: 'hot' })).toEqual(expect.objectContaining({ batteryPct: -1, thermalState: 'unknown' }));
    expect(normalizeStatus(null)).toEqual(UNKNOWN_STATUS);
  });

  it('falls back to unknown values with an older native module or a failure', async () => {
    expect(await readDeviceStatus()).toEqual(UNKNOWN_STATUS);
    (NativeModules as Record<string, unknown>).PegueiAnalytics = { getDeviceStatus: jest.fn().mockRejectedValue(new Error('x')) };
    expect(await readDeviceStatus()).toEqual(UNKNOWN_STATUS);
    (NativeModules as Record<string, unknown>).PegueiAnalytics = {
      getDeviceStatus: jest.fn().mockResolvedValue({ batteryPct: 50, thermalState: 'serious', storageFreeGb: 3, memoryMb: 200, encodedFrames: 10 }),
    };
    expect(await readDeviceStatus()).toEqual(expect.objectContaining({ batteryPct: 50, thermalState: 'serious' }));
  });

  it('orders thermal states', () => {
    expect(maxThermal('nominal', 'serious')).toBe('serious');
    expect(maxThermal('critical', 'fair')).toBe('critical');
    expect(maxThermal('unknown', 'nominal')).toBe('nominal');
    expect(isThermalAtLeast('critical', 'critical')).toBe(true);
    expect(isThermalAtLeast('serious', 'critical')).toBe(false);
  });

  it.each([
    [-1, 'desconhecido'],
    [0.4, '<1'],
    [1.5, '1-2'],
    [4.9, '2-5'],
    [9, '5-10'],
    [29, '10-30'],
    [64, '30+'],
  ])('storage %s GB -> %s', (gb, bucket) => {
    expect(storageBucket(gb)).toBe(bucket);
  });

  it('never reports free space on iOS (required reason API E174.1)', () => {
    expect(canReportStorage('ios')).toBe(false);
    expect(reportedStorageBucket(3, 'ios')).toBe('nao_enviado');
    expect(canReportStorage('android')).toBe(true);
    expect(reportedStorageBucket(3, 'android')).toBe('2-5');
  });

  it.each([
    [0, '0'],
    [1, '1'],
    [5, '2-5'],
    [20, '6-20'],
    [50, '21-50'],
    [51, '51+'],
  ])('%s videos -> %s', (count, bucket) => {
    expect(videosBucket(count)).toBe(bucket);
  });

  it('computes dropped frames against the configured fps', () => {
    expect(droppedFramesPct(9000, 300_000, 30)).toBe(0);
    expect(droppedFramesPct(8100, 300_000, 30)).toBe(10);
    expect(droppedFramesPct(9500, 300_000, 30)).toBe(0);
    expect(droppedFramesPct(0, 300_000, 30)).toBe(100);
    expect(droppedFramesPct(10, 0, 30)).toBe(0);
    expect(droppedFramesPct(-5, 1000, 30)).toBe(0);
  });
});
