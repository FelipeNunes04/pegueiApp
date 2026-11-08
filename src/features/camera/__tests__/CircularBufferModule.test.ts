import { NativeModules } from 'react-native';

type ModuleExports = typeof import('../native/CircularBufferModule');

// The module reads NativeModules.CircularBufferModule once at import time,
// so each scenario needs a fresh copy of it.
function loadWith(native: Record<string, unknown> | undefined): ModuleExports {
  (NativeModules as Record<string, unknown>).CircularBufferModule = native;
  let loaded: ModuleExports | undefined;
  jest.isolateModules(() => {
    loaded = require('../native/CircularBufferModule');
  });
  return loaded as ModuleExports;
}

describe('CircularBufferModule wrappers', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).CircularBufferModule;
  });

  it('throws the linking error for core capture methods when the native module is missing', () => {
    const { CircularBufferModule, circularBufferEvents } = loadWith(undefined);

    expect(() => CircularBufferModule.isBuffering()).toThrow(/not linked/);
    expect(circularBufferEvents).toBeUndefined();
  });

  // Pocket mode / hardware triggers / battery are progressive enhancements:
  // a missing module must degrade to harmless no-ops, never crash the screen.
  it('resolves harmless fallbacks for the optional methods when the native module is missing', async () => {
    const { CircularBufferModule } = loadWith(undefined);

    await expect(CircularBufferModule.setPocketMode(true)).resolves.toBeUndefined();
    await expect(CircularBufferModule.setHardwareTriggerEnabled(true)).resolves.toBeUndefined();
    await expect(CircularBufferModule.isIgnoringBatteryOptimizations()).resolves.toBe(true);
    await expect(CircularBufferModule.openBatteryOptimizationSettings()).resolves.toBeUndefined();
  });

  it('falls back when the module is linked but predates a given method (older native binary)', async () => {
    const { CircularBufferModule } = loadWith({ isBuffering: jest.fn(), addListener: jest.fn(), removeListeners: jest.fn() });

    await expect(CircularBufferModule.isIgnoringBatteryOptimizations()).resolves.toBe(true);
    await expect(CircularBufferModule.setPocketMode(false)).resolves.toBeUndefined();
  });

  it('delegates every method to the native module when it is linked', async () => {
    const native = {
      startBuffering: jest.fn().mockResolvedValue(undefined),
      stopBuffering: jest.fn().mockResolvedValue(undefined),
      startManualRecording: jest.fn().mockResolvedValue(undefined),
      stopManualRecording: jest.fn().mockResolvedValue({ path: '/a.mp4', durationSeconds: 3 }),
      playRecordingStartSound: jest.fn(),
      playRecordingStopSound: jest.fn(),
      isBuffering: jest.fn().mockResolvedValue(true),
      setZoom: jest.fn().mockResolvedValue(2),
      getZoomInfo: jest.fn().mockResolvedValue({ minZoom: 1, maxZoom: 5, hasUltraWide: false }),
      getCaptureCapabilities: jest.fn().mockResolvedValue({ supportedQualities: [], fpsByQuality: {} }),
      setPocketMode: jest.fn().mockResolvedValue(undefined),
      setHardwareTriggerEnabled: jest.fn().mockResolvedValue(undefined),
      isIgnoringBatteryOptimizations: jest.fn().mockResolvedValue(false),
      openBatteryOptimizationSettings: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const { CircularBufferModule, circularBufferEvents } = loadWith(native);
    const config = { bufferSeconds: 30, width: 1920, height: 1080, fps: 30 };

    await CircularBufferModule.startBuffering(config);
    await CircularBufferModule.stopBuffering();
    await CircularBufferModule.startManualRecording();
    await CircularBufferModule.stopManualRecording();
    CircularBufferModule.playRecordingStartSound();
    CircularBufferModule.playRecordingStopSound();
    await CircularBufferModule.isBuffering();
    await CircularBufferModule.setZoom(2);
    await CircularBufferModule.getZoomInfo();
    await CircularBufferModule.getCaptureCapabilities();
    await CircularBufferModule.setPocketMode(true);
    await CircularBufferModule.setHardwareTriggerEnabled(false);
    await expect(CircularBufferModule.isIgnoringBatteryOptimizations()).resolves.toBe(false);
    await CircularBufferModule.openBatteryOptimizationSettings();

    expect(native.startBuffering).toHaveBeenCalledWith(config);
    expect(native.setZoom).toHaveBeenCalledWith(2);
    expect(native.setPocketMode).toHaveBeenCalledWith(true);
    expect(native.setHardwareTriggerEnabled).toHaveBeenCalledWith(false);
    expect(native.openBatteryOptimizationSettings).toHaveBeenCalled();
    for (const key of ['stopBuffering', 'startManualRecording', 'stopManualRecording', 'playRecordingStartSound', 'playRecordingStopSound', 'isBuffering', 'getZoomInfo', 'getCaptureCapabilities'] as const) {
      expect(native[key]).toHaveBeenCalled();
    }
    expect(circularBufferEvents).toBeDefined();
  });
});
