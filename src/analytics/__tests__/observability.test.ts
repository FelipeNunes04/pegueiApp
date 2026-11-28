import * as Crashlytics from '@react-native-firebase/crashlytics';
import * as Perf from '@react-native-firebase/perf';
import { breadcrumb, recordError, resetObservabilityForTests, setCrashKeys, setObservabilityEnabled, startTrace } from '../observability';

describe('observability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends nothing while disabled (development, opt-out)', () => {
    resetObservabilityForTests(false);
    breadcrumb('x');
    setCrashKeys({ buffer_s: '30' });
    startTrace('capture_save').stop();
    expect(Crashlytics.log).not.toHaveBeenCalled();
    expect(Crashlytics.setAttributes).not.toHaveBeenCalled();
    expect(Perf.trace).not.toHaveBeenCalled();
  });

  it('records traces, keys, breadcrumbs and non-fatal errors when enabled', () => {
    resetObservabilityForTests(true);
    const t = startTrace('export_9_16');
    t.putAttribute('marca_dagua', '1');
    t.putMetric('ms', 12.6);
    t.stop();
    t.stop();
    setCrashKeys({ buffer_s: '30', lente: '0.5x' });
    breadcrumb('video_saved');
    recordError(new Error('boom'), 'export');
    expect(Perf.trace).toHaveBeenCalledWith(expect.anything(), 'export_9_16');
    expect(Crashlytics.setAttributes).toHaveBeenCalledWith(expect.anything(), { buffer_s: '30', lente: '0.5x' });
    expect(Crashlytics.log).toHaveBeenCalledWith(expect.anything(), 'video_saved');
    expect(Crashlytics.recordError).toHaveBeenCalledWith(expect.anything(), expect.any(Error), 'export');
  });

  it('opt-out switches Crashlytics and Performance collection (always off in __DEV__)', () => {
    setObservabilityEnabled(true);
    expect(Crashlytics.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), !__DEV__);
    expect(Perf.getPerformance().dataCollectionEnabled).toBe(!__DEV__);
    setObservabilityEnabled(false);
    expect(Crashlytics.setCrashlyticsCollectionEnabled).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it('never throws when Firebase fails', () => {
    resetObservabilityForTests(true);
    (Perf.trace as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no firebase');
    });
    expect(() => startTrace('buffer_start').stop()).not.toThrow();
  });
});
