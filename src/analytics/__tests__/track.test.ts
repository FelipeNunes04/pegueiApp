import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnalyticsProvider } from '../providers';

jest.unmock('../track');

// Required after unmock so this file gets the real module.
const analytics = jest.requireActual<typeof import('../track')>('../track');

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

describe('track', () => {
  let provider: jest.Mocked<AnalyticsProvider>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    provider = fakeProvider();
    analytics.resetAnalyticsForTests(provider);
  });

  it('holds events until the saved choice is read, then sends them', async () => {
    analytics.track('app_opened');
    expect(provider.logEvent).not.toHaveBeenCalled();

    await analytics.initAnalytics();

    expect(provider.logEvent).toHaveBeenCalledWith('app_opened', expect.objectContaining({ app: 'peguei' }));
  });

  it('adds the common params to every event', async () => {
    await analytics.initAnalytics();
    analytics.track('buffer_started', { buffer_s: 30, lente: '1x' });

    expect(provider.logEvent).toHaveBeenCalledWith('buffer_started', {
      app: 'peguei',
      app_version: expect.any(String),
      platform: expect.any(String),
      device_model: expect.any(String),
      os_version: expect.any(String),
      buffer_s: 30,
      lente: '1x',
    });
  });

  it('turns booleans into 1/0 and trims long strings', async () => {
    await analytics.initAnalytics();
    analytics.track('video_exported', { marca_dagua: true, overlay: false, sponsor_id: 'x'.repeat(150) });

    const params = provider.logEvent.mock.calls[0][1];
    expect(params.marca_dagua).toBe(1);
    expect(params.overlay).toBe(0);
    expect(String(params.sponsor_id)).toHaveLength(100);
  });

  it('sends nothing after the user opts out, and drops what was queued', async () => {
    await AsyncStorage.setItem('peguei:analyticsOptOut', 'true');
    analytics.track('app_opened');
    await analytics.initAnalytics();
    analytics.track('review_prompt_shown');
    analytics.screen('Camera');

    expect(provider.logEvent).not.toHaveBeenCalled();
    expect(provider.logScreenView).not.toHaveBeenCalled();
    expect(provider.setCollectionEnabled).toHaveBeenCalledWith(false);
  });

  it('opting out from Settings stops sending and is saved', async () => {
    await analytics.initAnalytics();
    analytics.setAnalyticsEnabled(false);
    analytics.track('app_opened');

    expect(provider.logEvent).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(await AsyncStorage.getItem('peguei:analyticsOptOut')).toBe('true');

    analytics.setAnalyticsEnabled(true);
    analytics.track('app_opened');
    expect(provider.logEvent).toHaveBeenCalledTimes(1);
  });

  it('never lets a provider error reach the caller', async () => {
    provider.logEvent.mockImplementation(() => {
      throw new Error('boom');
    });
    await analytics.initAnalytics();

    expect(() => analytics.track('app_opened')).not.toThrow();
  });

  it('forwards native events with a known name and drops unknown ones', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await analytics.initAnalytics();
    analytics.handleNativeEventForTests({ name: 'sponsor_impression', props: { sponsor_id: 'loja', posicao: 'top_right' } });
    analytics.handleNativeEventForTests({ name: 'not_an_event', props: {} });

    expect(provider.logEvent).toHaveBeenCalledTimes(1);
    expect(provider.logEvent).toHaveBeenCalledWith(
      'sponsor_impression',
      expect.objectContaining({ sponsor_id: 'loja', posicao: 'top_right' }),
    );
    warn.mockRestore();
  });

  it('sends user properties as strings or null', async () => {
    await analytics.initAnalytics();
    analytics.setUserProperties({ uf: 'PI', tipo_pesca: 'represa_acude' });

    expect(provider.setUserProperties).toHaveBeenCalledWith({ uf: 'PI', tipo_pesca: 'represa_acude' });
  });
});

// Compile-time checks: `tsc` fails if any of these stop being errors.
export function typeChecks() {
  // @ts-expect-error unknown event name
  analytics.track('clip_saved');
  // @ts-expect-error missing required props
  analytics.track('video_saved');
  // @ts-expect-error wrong prop type
  analytics.track('buffer_started', { buffer_s: '30', lente: '1x' });
  // @ts-expect-error unknown prop
  analytics.track('buffer_stopped', { duracao_min: 3, extra: 1 });
  // @ts-expect-error event without props takes none
  analytics.track('app_opened', { foo: 1 });
}
