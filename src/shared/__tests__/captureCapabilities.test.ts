import {
  capabilitiesUnknown,
  isFpsSupported,
  isQualitySupported,
  resolveSupportedFps,
  resolveSupportedQuality,
} from '../utils/captureCapabilities';
import type { CaptureCapabilities } from '../types';

const UNKNOWN: CaptureCapabilities = { supportedQualities: [], fpsByQuality: {} };
const PARTIAL: CaptureCapabilities = {
  supportedQualities: ['720p', '1080p'],
  fpsByQuality: { '720p': [24, 30, 60], '1080p': [24, 30] },
};

describe('captureCapabilities', () => {
  describe('capabilitiesUnknown', () => {
    it('is true for null and for an empty supportedQualities list', () => {
      expect(capabilitiesUnknown(null)).toBe(true);
      expect(capabilitiesUnknown(UNKNOWN)).toBe(true);
    });

    it('is false once at least one quality is reported supported', () => {
      expect(capabilitiesUnknown(PARTIAL)).toBe(false);
    });
  });

  describe('isQualitySupported', () => {
    it('treats unknown capabilities as "everything supported"', () => {
      expect(isQualitySupported(null, '4k')).toBe(true);
      expect(isQualitySupported(UNKNOWN, '4k')).toBe(true);
    });

    it('reflects supportedQualities once known', () => {
      expect(isQualitySupported(PARTIAL, '720p')).toBe(true);
      expect(isQualitySupported(PARTIAL, '1080p')).toBe(true);
      expect(isQualitySupported(PARTIAL, '4k')).toBe(false);
    });
  });

  describe('isFpsSupported', () => {
    it('treats unknown capabilities as "everything supported"', () => {
      expect(isFpsSupported(null, '4k', 60)).toBe(true);
      expect(isFpsSupported(UNKNOWN, '4k', 60)).toBe(true);
    });

    it('treats a quality with no fps data as "every fps supported" for it', () => {
      const noFpsData: CaptureCapabilities = { supportedQualities: ['4k'], fpsByQuality: {} };
      expect(isFpsSupported(noFpsData, '4k', 60)).toBe(true);
    });

    it('reflects fpsByQuality once known', () => {
      expect(isFpsSupported(PARTIAL, '1080p', 30)).toBe(true);
      expect(isFpsSupported(PARTIAL, '1080p', 60)).toBe(false);
      expect(isFpsSupported(PARTIAL, '720p', 60)).toBe(true);
    });
  });

  describe('resolveSupportedQuality', () => {
    it('returns the requested quality unchanged when supported', () => {
      expect(resolveSupportedQuality(PARTIAL, '1080p')).toBe('1080p');
    });

    it('returns the requested quality unchanged when capabilities are unknown', () => {
      expect(resolveSupportedQuality(UNKNOWN, '4k')).toBe('4k');
    });

    it('falls back to the nearest supported quality (by resolution order) when unsupported', () => {
      // '4k' unsupported -> nearest by VIDEO_QUALITY_ORDER (720p, 1080p, 4k) is '1080p'.
      expect(resolveSupportedQuality(PARTIAL, '4k')).toBe('1080p');
    });

    it('falls back correctly even when the nearest supported option is on the other side', () => {
      const only4k: CaptureCapabilities = { supportedQualities: ['4k'], fpsByQuality: {} };
      expect(resolveSupportedQuality(only4k, '720p')).toBe('4k');
    });
  });

  describe('resolveSupportedFps', () => {
    it('returns the requested fps unchanged when supported', () => {
      expect(resolveSupportedFps(PARTIAL, '720p', 60)).toBe(60);
    });

    it('returns the requested fps unchanged when capabilities are unknown', () => {
      expect(resolveSupportedFps(UNKNOWN, '4k', 60)).toBe(60);
    });

    it('falls back to the nearest supported fps (by VIDEO_FPS_OPTIONS order) when unsupported', () => {
      // 60fps unsupported at 1080p here -> nearest supported (24, 30) is 30.
      expect(resolveSupportedFps(PARTIAL, '1080p', 60)).toBe(30);
    });
  });
});
