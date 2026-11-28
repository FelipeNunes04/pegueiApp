import * as RC from '@react-native-firebase/remote-config';
import { getConfigNumber, getConfigString, getFlag, REMOTE_CONFIG_DEFAULTS } from '../remoteConfig';

const setValues = (RC as unknown as { __setValues: (v: Record<string, unknown>) => void }).__setValues;

describe('Remote Config flags', () => {
  beforeEach(() => {
    setValues({});
    (RC.getRemoteConfig() as unknown as { defaultConfig: Record<string, unknown> }).defaultConfig = {};
  });

  it('uses the local defaults before Remote Config is ready (offline cold start)', () => {
    expect(getFlag('analytics_enabled')).toBe(true);
    expect(getFlag('session_metrics_enabled')).toBe(true);
    expect(getFlag('pesca_certa_cta_enabled')).toBe(false);
    expect(getFlag('storage_warning_enabled')).toBe(false);
    expect(getConfigNumber('buffer_sample_interval_min')).toBe(5);
    expect(getConfigString('pesca_certa_play_url')).toBe(REMOTE_CONFIG_DEFAULTS.pesca_certa_play_url);
  });

  it('reads fetched values', () => {
    setValues({ analytics_enabled: false, storage_warning_gb: 3, sponsor_link_url: 'https://x.y' });
    expect(getFlag('analytics_enabled')).toBe(false);
    expect(getConfigNumber('storage_warning_gb')).toBe(3);
    expect(getConfigString('sponsor_link_url')).toBe('https://x.y');
  });

  it('falls back to the default for a non-number', () => {
    setValues({ storage_warning_gb: 'abc' });
    expect(getConfigNumber('storage_warning_gb')).toBe(2);
  });

  it('falls back to the defaults when Firebase throws', () => {
    (RC.getRemoteConfig as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no firebase');
    });
    expect(getFlag('analytics_enabled')).toBe(true);
  });
});
