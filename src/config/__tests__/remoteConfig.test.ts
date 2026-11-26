import * as RC from '@react-native-firebase/remote-config';
import { getSponsorConfig, initRemoteConfig, resetRemoteConfigForTests, safeHttpsUrl } from '../remoteConfig';

const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;
const mockedFetch = RC.fetchAndActivate as jest.Mock;

describe('remoteConfig', () => {
  beforeEach(() => {
    resetRemoteConfigForTests();
    setValues({});
    jest.clearAllMocks();
  });

  it('applies the local defaults: no watermark', async () => {
    await initRemoteConfig();
    expect(getSponsorConfig()).toEqual({
      watermarkEnabled: false,
      watermarkAssetUrl: '',
      sponsorId: '',
      sponsorPosition: 'bottom_right',
      overlaySponsorLogoUrl: '',
    });
  });

  it('reads the activated values', async () => {
    await initRemoteConfig();
    setValues({
      watermark_enabled: true,
      watermark_asset_url: 'https://cdn.example.com/w.png',
      sponsor_id: 'loja_picos',
      sponsor_position: 'top_left',
      overlay_sponsor_logo_url: 'https://cdn.example.com/logo.png',
    });
    expect(getSponsorConfig()).toEqual({
      watermarkEnabled: true,
      watermarkAssetUrl: 'https://cdn.example.com/w.png',
      sponsorId: 'loja_picos',
      sponsorPosition: 'top_left',
      overlaySponsorLogoUrl: 'https://cdn.example.com/logo.png',
    });
  });

  it('rejects a bad position and non-https URLs', async () => {
    await initRemoteConfig();
    setValues({ sponsor_position: 'middle', watermark_asset_url: 'http://insecure/w.png' });
    const config = getSponsorConfig();
    expect(config.sponsorPosition).toBe('bottom_right');
    expect(config.watermarkAssetUrl).toBe('');
    expect(safeHttpsUrl(' https://a.b/c.png ')).toBe('https://a.b/c.png');
  });

  it('never throws when the fetch fails (offline)', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(initRemoteConfig()).resolves.toBe(false);
    expect(getSponsorConfig().watermarkEnabled).toBe(false);
  });
});
