import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RC from '@react-native-firebase/remote-config';
import type { AnalyticsProvider } from '../providers';
import { resetAnalyticsContextForTests, setAnalyticsConnection, setAnalyticsRegion, setAnalyticsUf, toConnection } from '../context';
import { encodeGeohash, regionGeohash5, sanitizeGeohash5 } from '../geohash';

jest.unmock('../track');
const analytics = jest.requireActual<typeof import('../track')>('../track');
const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;

function fakeProvider(): jest.Mocked<AnalyticsProvider> {
  return {
    name: 'fake',
    logEvent: jest.fn(),
    logScreenView: jest.fn(),
    setUserId: jest.fn(),
    setUserProperties: jest.fn(),
    setCollectionEnabled: jest.fn(),
  };
}

describe('common params: uf, region_geohash5, connection', () => {
  let provider: jest.Mocked<AnalyticsProvider>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    setValues({});
    resetAnalyticsContextForTests();
    provider = fakeProvider();
    analytics.resetAnalyticsForTests(provider);
    await analytics.initAnalytics();
  });

  it('leaves out an unknown uf and region, and sends connection unknown', () => {
    analytics.track('app_opened');
    const params = provider.logEvent.mock.calls[0][1];
    expect(params.connection).toBe('unknown');
    expect(params).not.toHaveProperty('uf');
    expect(params).not.toHaveProperty('region_geohash5');
  });

  it('adds the onboarding uf, a geohash5 and the connection at the time of the event', () => {
    setAnalyticsUf('PI');
    setAnalyticsRegion('7pkd3');
    setAnalyticsConnection('cell');
    analytics.track('app_opened');
    setAnalyticsConnection('offline');
    analytics.track('app_opened');
    expect(provider.logEvent.mock.calls[0][1]).toEqual(expect.objectContaining({ uf: 'PI', region_geohash5: '7pkd3', connection: 'cell' }));
    expect(provider.logEvent.mock.calls[1][1]).toEqual(expect.objectContaining({ connection: 'offline' }));
  });

  it('never keeps anything that is not a geohash5', () => {
    setAnalyticsRegion('-5.08,-42.80');
    analytics.track('app_opened');
    expect(provider.logEvent.mock.calls[0][1]).not.toHaveProperty('region_geohash5');
    setAnalyticsUf('nao_informado');
    analytics.track('app_opened');
    expect(provider.logEvent.mock.calls[1][1]).not.toHaveProperty('uf');
  });

  it('the remote kill switch stops every event', () => {
    setValues({ analytics_enabled: false });
    analytics.track('app_opened');
    expect(provider.logEvent).not.toHaveBeenCalled();
  });

  it('cuts user property values at 36 characters (Firebase limit)', () => {
    analytics.setUserProperties({ install_source: 'x'.repeat(50) });
    expect(provider.setUserProperties).toHaveBeenCalledWith({ install_source: 'x'.repeat(36) });
  });
});

describe('offline queue before the opt-out choice is read', () => {
  it('keeps at most 50 events and sends them once the choice is known', async () => {
    await AsyncStorage.clear();
    setValues({});
    const provider = fakeProvider();
    analytics.resetAnalyticsForTests(provider);
    for (let i = 0; i < 60; i++) analytics.track('app_opened');
    expect(provider.logEvent).not.toHaveBeenCalled();
    await analytics.initAnalytics();
    expect(provider.logEvent).toHaveBeenCalledTimes(50);
  });

  it('keeps the connection of when the event happened, not of when it is sent', async () => {
    await AsyncStorage.clear();
    setValues({});
    resetAnalyticsContextForTests();
    const provider = fakeProvider();
    analytics.resetAnalyticsForTests(provider);
    setAnalyticsConnection('offline');
    analytics.track('app_opened');
    setAnalyticsConnection('wifi');
    await analytics.initAnalytics();
    expect(provider.logEvent.mock.calls[0][1].connection).toBe('offline');
  });
});

describe('geohash and connection helpers', () => {
  it('encodes a point to a 5-char area (about 5 km) and never more', () => {
    expect(regionGeohash5(-7.0769, -41.4669)).toHaveLength(5);
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(encodeGeohash(Number.NaN, 0, 5)).toBe('');
  });

  it('sanitizes geohash5 from links', () => {
    expect(sanitizeGeohash5(' 7PKD3 ')).toBe('7pkd3');
    expect(sanitizeGeohash5('7pkd')).toBe('');
    expect(sanitizeGeohash5('7pkda')).toBe('');
    expect(sanitizeGeohash5(undefined)).toBe('');
  });

  it('maps native connection values', () => {
    expect(toConnection('wifi')).toBe('wifi');
    expect(toConnection('cell')).toBe('cell');
    expect(toConnection('5g')).toBe('unknown');
    expect(toConnection(undefined)).toBe('unknown');
  });
});
