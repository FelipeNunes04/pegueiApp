import { NativeEventEmitter, NativeModules, Platform, requireNativeComponent, type ViewProps } from 'react-native';
import type { BufferConfig, CaptureCapabilities, SaveClipResult } from '../../../shared/types';

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
  isBuffering(): Promise<boolean>;
  /** Returns the zoom factor actually applied (clamped to the device's supported range). */
  setZoom(factor: number): Promise<number>;
  getZoomInfo(): Promise<ZoomInfo>;
  getCaptureCapabilities(): Promise<CaptureCapabilities>;
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

export const CircularBufferModule: CircularBufferNativeInterface = {
  startBuffering: config => assertLinked().startBuffering(config),
  stopBuffering: () => assertLinked().stopBuffering(),
  startManualRecording: () => assertLinked().startManualRecording(),
  stopManualRecording: () => assertLinked().stopManualRecording(),
  isBuffering: () => assertLinked().isBuffering(),
  setZoom: factor => assertLinked().setZoom(factor),
  getZoomInfo: () => assertLinked().getZoomInfo(),
  getCaptureCapabilities: () => assertLinked().getCaptureCapabilities(),
};

export const circularBufferEvents = NativeCircularBuffer
  ? new NativeEventEmitter(NativeModules.CircularBufferModule)
  : undefined;

export type CircularBufferErrorEvent = { code: string; message: string };

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
