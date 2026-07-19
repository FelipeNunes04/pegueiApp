import {
  VIDEO_FPS_OPTIONS,
  VIDEO_QUALITY_ORDER,
  type CaptureCapabilities,
  type VideoFps,
  type VideoQuality,
} from '../types';

/** True when capabilities are unknown (native couldn't determine, e.g. a Simulator with no back camera) -- callers must not restrict anything in this case. */
export function capabilitiesUnknown(capabilities: CaptureCapabilities | null): boolean {
  return !capabilities || capabilities.supportedQualities.length === 0;
}

export function isQualitySupported(capabilities: CaptureCapabilities | null, quality: VideoQuality): boolean {
  if (capabilitiesUnknown(capabilities)) return true;
  return capabilities!.supportedQualities.includes(quality);
}

/** fpsByQuality having no entry (or an empty one) for a supported quality means "couldn't determine fps for it" -- don't restrict fps either in that case. */
export function isFpsSupported(capabilities: CaptureCapabilities | null, quality: VideoQuality, fps: VideoFps): boolean {
  if (capabilitiesUnknown(capabilities)) return true;
  const supportedFps = capabilities!.fpsByQuality[quality];
  if (!supportedFps || supportedFps.length === 0) return true;
  return supportedFps.includes(fps);
}

function nearest<T>(order: T[], supported: T[], requested: T): T {
  const requestedIndex = order.indexOf(requested);
  let best = supported[0];
  let bestDistance = Infinity;
  for (const candidate of supported) {
    const distance = Math.abs(order.indexOf(candidate) - requestedIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Returns `requestedQuality` unchanged if the device supports it (or if
 * capabilities are unknown); otherwise falls back to whichever supported
 * quality is closest to it. Used by useCircularBuffer.start() so a stale or
 * device-mismatched persisted setting (e.g. restored from a more capable
 * phone's backup) can't cause the native buffer to attempt an unsupported
 * resolution -- it also updates settingsStore so the UI reflects reality.
 */
export function resolveSupportedQuality(capabilities: CaptureCapabilities | null, requestedQuality: VideoQuality): VideoQuality {
  if (isQualitySupported(capabilities, requestedQuality)) return requestedQuality;
  return nearest(VIDEO_QUALITY_ORDER, capabilities!.supportedQualities, requestedQuality);
}

/** Same idea as resolveSupportedQuality, but for fps at a given (already-resolved) quality. */
export function resolveSupportedFps(capabilities: CaptureCapabilities | null, quality: VideoQuality, requestedFps: VideoFps): VideoFps {
  if (isFpsSupported(capabilities, quality, requestedFps)) return requestedFps;
  const supportedFps = capabilities!.fpsByQuality[quality]!;
  return nearest(VIDEO_FPS_OPTIONS, supportedFps, requestedFps);
}
