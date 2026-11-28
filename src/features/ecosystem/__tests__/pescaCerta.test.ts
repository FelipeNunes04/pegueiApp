import { Linking } from 'react-native';
import * as RC from '@react-native-firebase/remote-config';
import { setUserProperties, track } from '../../../analytics';
import { resetAnalyticsContextForTests, setAnalyticsRegion } from '../../../analytics/context';
import {
  buildDiaryLink,
  isPescaCertaCtaEnabled,
  localDate,
  pescaCertaStoreUrl,
  sendCatchToPescaCerta,
  toPescaCertaSpecies,
} from '../pescaCerta';

const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;

describe('Pesca Certa link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setValues({});
    resetAnalyticsContextForTests();
  });

  it.each([
    ['Tucunaré', 'tucunare'],
    ['Traíra', 'traira'],
    ['Tilápia', 'tilapia'],
    ['  tambaqui ', 'tambaqui'],
    ['Curimatá', 'curimata'],
    ['Pescada do Piauí', 'pescada_piaui'],
    ['Robalo', 'outra'],
    ['', 'outra'],
  ])('%s -> %s', (text, key) => {
    expect(toPescaCertaSpecies(text)).toBe(key);
  });

  it('builds the agreed link, with geohash5 only when known', () => {
    const at = new Date(2026, 10, 28, 6, 30).getTime();
    expect(localDate(at)).toBe('2026-11-28');
    expect(buildDiaryLink('tucunare', at, '')).toBe(
      'pescacerta://diario?from=peguei&contexto=captura&especie=tucunare&data=2026-11-28',
    );
    expect(buildDiaryLink('tucunare', at, '7PKD3')).toBe(
      'pescacerta://diario?from=peguei&contexto=captura&especie=tucunare&data=2026-11-28&geohash5=7pkd3',
    );
    expect(buildDiaryLink('outra', at, '-5.08,-42.8')).not.toContain('geohash5');
  });

  it('the CTA is off by default', () => {
    expect(isPescaCertaCtaEnabled()).toBe(false);
    setValues({ pesca_certa_cta_enabled: true });
    expect(isPescaCertaCtaEnabled()).toBe(true);
  });

  it('store URLs come from Remote Config, https only', () => {
    expect(pescaCertaStoreUrl('android')).toBe('https://play.google.com/store/apps/details?id=br.com.pescacerta.android');
    expect(pescaCertaStoreUrl('ios')).toBe('https://apps.apple.com/app/id6760917467');
    setValues({ pesca_certa_app_store_url: 'http://insecure' });
    expect(pescaCertaStoreUrl('ios')).toBe('');
  });

  it('opens the diary and logs catch_sent_to_pesca_certa', async () => {
    setAnalyticsRegion('7pkd3');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    expect(await sendCatchToPescaCerta('Tucunaré', new Date(2026, 10, 28).getTime())).toBe('enviado');
    expect(open).toHaveBeenCalledWith(expect.stringContaining('especie=tucunare'));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('geohash5=7pkd3'));
    expect(track).toHaveBeenCalledWith('catch_sent_to_pesca_certa', { especie: 'tucunare' });
    expect(setUserProperties).toHaveBeenCalledWith({ has_pesca_certa: 'sim' });
  });

  it('opens the store when Pesca Certa is not installed, without the catch event', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no app')).mockResolvedValueOnce(true);
    expect(await sendCatchToPescaCerta('Traíra', Date.now())).toBe('loja');
    expect(open).toHaveBeenLastCalledWith('https://apps.apple.com/app/id6760917467');
    expect(track).not.toHaveBeenCalledWith('catch_sent_to_pesca_certa', expect.anything());
  });
});
