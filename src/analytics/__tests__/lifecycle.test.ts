import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { setUserProperties, track } from '../track';
import { installSourceFor, isoWeek, parseLink, queryParams, resetLifecycleForTests, startLifecycleAnalytics } from '../lifecycle';
import { getAnalyticsContext, resetAnalyticsContextForTests } from '../context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('lifecycle analytics', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetLifecycleForTests();
    resetAnalyticsContextForTests();
  });

  it('reads the Pesca Certa link contract', () => {
    expect(parseLink('peguei://camera?from=pesca_certa&contexto=checkin')).toEqual({
      source: 'pesca_certa',
      contexto: 'checkin',
      utmCampaign: '',
      geohash5: '',
    });
    expect(parseLink('peguei://camera')).toEqual({ source: '', contexto: '', utmCampaign: '', geohash5: '' });
    expect(parseLink('https://example.com')).toBeNull();
    expect(parseLink(null)).toBeNull();
    expect(queryParams('x://y?a=1&b=%E2%9C%93&bad=%E0%A4%A')).toEqual({ a: '1', b: '✓' });
  });

  it('install source: organico, the link source, or deeplink', () => {
    expect(installSourceFor(null)).toBe('organico');
    expect(installSourceFor(parseLink('peguei://camera?from=pesca_certa'))).toBe('pesca_certa');
    expect(installSourceFor(parseLink('peguei://camera'))).toBe('deeplink');
  });

  it('ISO week', () => {
    expect(isoWeek(new Date(2026, 10, 28))).toBe('2026-W48');
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53');
  });

  it('fires opened_from_pesca_certa and sets has_pesca_certa on a cold start from Pesca Certa', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce('peguei://camera?from=pesca_certa&contexto=viagem&geohash5=7pkd3');
    startLifecycleAnalytics();
    await flush();
    await flush();
    expect(track).toHaveBeenCalledWith('opened_from_pesca_certa', { contexto: 'viagem' });
    expect(setUserProperties).toHaveBeenCalledWith({ has_pesca_certa: 'sim' });
    expect(setUserProperties).toHaveBeenCalledWith({ cohort_week: expect.stringMatching(/^\d{4}-W\d{2}$/), install_source: 'pesca_certa' });
    expect(getAnalyticsContext().region_geohash5).toBe('7pkd3');
  });

  it('a normal open sets the saved cohort and sends no ecosystem event', async () => {
    await AsyncStorage.setItem('peguei:analyticsFirstOpen', '2026-W40');
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce(null);
    startLifecycleAnalytics();
    await flush();
    await flush();
    expect(setUserProperties).toHaveBeenCalledWith({ cohort_week: '2026-W40', install_source: 'organico' });
    expect(track).not.toHaveBeenCalledWith('opened_from_pesca_certa', expect.anything());
  });
});
