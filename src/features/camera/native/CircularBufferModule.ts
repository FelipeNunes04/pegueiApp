import { NativeEventEmitter, NativeModules, Platform, requireNativeComponent, type ViewProps } from 'react-native';
import type { BufferConfig, BufferHealth, CaptureCapabilities, SaveClipResult } from '../../../shared/types';

export interface ZoomInfo {
  minZoom: number;
  maxZoom: number;
  /** True only when the hardware exposes a lens below 1x (e.g. iPhone/high-end Android ultra-wide). */
  hasUltraWide: boolean;
}

interface CircularBufferNativeInterface {
  startBuffering(config: BufferConfig): Promise<void>;
  stopBuffering(): Promise<void>;
  startManualRecording(): Promise<void>;
  stopManualRecording(): Promise<SaveClipResult>;
  /** Fire-and-forget: plays the platform's built-in "begin video recording" cue. */
  playRecordingStartSound(): void;
  /** Fire-and-forget: plays the platform's built-in "end video recording" cue. */
  playRecordingStopSound(): void;
  isBuffering(): Promise<boolean>;
  /** Returns the zoom factor actually applied (clamped to the device's supported range). */
  setZoom(factor: number): Promise<number>;
  getZoomInfo(): Promise<ZoomInfo>;
  getCaptureCapabilities(): Promise<CaptureCapabilities>;
  /**
   * Pocket mode: dims the screen to ~minimum brightness and stops
   * compositing the preview, while capture/encode keeps running untouched.
   */
  setPocketMode(enabled: boolean): Promise<void>;
  /**
   * Lets volume buttons, Bluetooth shutter remotes (Android) and the
   * iPhone Camera Control / volume buttons via AVCaptureEventInteraction
   * (iOS 17.2+) emit CircularBufferHardwareTrigger instead of their default
   * action.
   */
  setHardwareTriggerEnabled(enabled: boolean): Promise<void>;
  /** Android: PowerManager.isIgnoringBatteryOptimizations. iOS: always true. */
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  /** Android: opens the system battery-optimization list (never the direct REQUEST_ dialog -- Play policy). iOS: no-op. */
  openBatteryOptimizationSettings(): Promise<void>;
}

const LINKING_ERROR =
  `The native module 'CircularBufferModule' is not linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the native module\n' +
  '- You are not running in a simulator/emulator without camera support';

const NativeCircularBuffer = NativeModules.CircularBufferModule as CircularBufferNativeInterface | undefined;

function assertLinked(): CircularBufferNativeInterface {
  if (!NativeCircularBuffer) {
    throw new Error(LINKING_ERROR);
  }
  return NativeCircularBuffer;
}

function callOptional<T>(
  method: keyof CircularBufferNativeInterface,
  call: (module: CircularBufferNativeInterface) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!NativeCircularBuffer || typeof NativeCircularBuffer[method] !== 'function') {
    return Promise.resolve(fallback);
  }
  return call(NativeCircularBuffer);
}

export const CircularBufferModule: CircularBufferNativeInterface = {
  startBuffering: config => assertLinked().startBuffering(config),
  stopBuffering: () => assertLinked().stopBuffering(),
  startManualRecording: () => assertLinked().startManualRecording(),
  stopManualRecording: () => assertLinked().stopManualRecording(),
  playRecordingStartSound: () => assertLinked().playRecordingStartSound(),
  playRecordingStopSound: () => assertLinked().playRecordingStopSound(),
  isBuffering: () => assertLinked().isBuffering(),
  setZoom: factor => assertLinked().setZoom(factor),
  getZoomInfo: () => assertLinked().getZoomInfo(),
  getCaptureCapabilities: () => assertLinked().getCaptureCapabilities(),
  // The four below are progressive enhancements, not part of the core
  // capture path -- so unlike the methods above they resolve to a harmless
  // fallback instead of throwing when the module (or just this method, e.g.
  // a native binary older than the JS bundle) is missing. A missing
  // pocket-mode/hardware-trigger/battery hook must never take the camera
  // screen down with it.
  setPocketMode: enabled => callOptional('setPocketMode', m => m.setPocketMode(enabled), undefined),
  setHardwareTriggerEnabled: enabled =>
    callOptional('setHardwareTriggerEnabled', m => m.setHardwareTriggerEnabled(enabled), undefined),
  // true = "nothing to fix", so an unknown status never shows the battery card.
  isIgnoringBatteryOptimizations: () =>
    callOptional('isIgnoringBatteryOptimizations', m => m.isIgnoringBatteryOptimizations(), true),
  openBatteryOptimizationSettings: () =>
    callOptional('openBatteryOptimizationSettings', m => m.openBatteryOptimizationSettings(), undefined),
};

export const circularBufferEvents = NativeCircularBuffer
  ? new NativeEventEmitter(NativeModules.CircularBufferModule)
  : undefined;

export type CircularBufferErrorEvent = { code: string; message: string };

/** Emitted only on transitions -- see BufferHealth in shared/types. */
export type CircularBufferHealthEvent = { state: BufferHealth; reason?: string };

/**
 * Emitted when native ends an in-flight manual recording on its own. By then
 * native has already saved the clip (`path`) or failed (`error`). Binaries
 * older than this contract simply never emit it.
 */
export type CircularBufferRecordingFinalizedEvent = {
  reason: 'stopped' | 'recovery' | 'memoryLimit';
  path?: string;
  durationSeconds?: number;
  error?: string;
};

export type HardwareTriggerSource = 'volumeUp' | 'volumeDown' | 'camera' | 'media' | 'enter' | 'captureButton';

export type CircularBufferHardwareTriggerEvent = { source: HardwareTriggerSource };

/**
 * Native preview surface backed by the platform camera session that also
 * feeds the encoder (Camera2 on Android, AVCaptureSession on iOS). A plain
 * <Camera> component from a third-party lib is intentionally not used here:
 * the buffer must observe the exact same frames the preview shows.
 */
export interface CircularBufferPreviewProps extends ViewProps {
  isActive: boolean;
}

export const CircularBufferPreview = requireNativeComponent<CircularBufferPreviewProps>('CircularBufferPreviewView');
