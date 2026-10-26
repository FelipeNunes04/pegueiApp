export type VideoQuality = '720p' | '1080p' | '4k';

export interface VideoQualityPreset {
  quality: VideoQuality;
  width: number;
  height: number;
}

export const VIDEO_QUALITY_PRESETS: Record<VideoQuality, VideoQualityPreset> = {
  '720p': { quality: '720p', width: 1280, height: 720 },
  '1080p': { quality: '1080p', width: 1920, height: 1080 },
  '4k': { quality: '4k', width: 3840, height: 2160 },
};

/** Frame rate is independent of the resolution preset -- any quality can be paired with any of these. */
export type VideoFps = 24 | 30 | 60;

export const VIDEO_FPS_OPTIONS: VideoFps[] = [24, 30, 60];

/** Low-to-high, used to find the "nearest" supported option when falling back -- see captureCapabilities.ts. */
export const VIDEO_QUALITY_ORDER: VideoQuality[] = ['720p', '1080p', '4k'];

/**
 * What this device's back camera actually supports, reported by the native
 * getCaptureCapabilities() bridge method. An empty supportedQualities means
 * the native side couldn't determine capabilities at all (e.g. no back
 * camera -- a Simulator/emulator) -- callers must treat that as "unknown,
 * don't restrict anything", not "nothing is supported". See
 * shared/utils/captureCapabilities.ts.
 */
export interface CaptureCapabilities {
  supportedQualities: VideoQuality[];
  fpsByQuality: Partial<Record<VideoQuality, VideoFps[]>>;
}

/** Inclusive bounds enforced by SettingsScreen and validation utils. */
export const BUFFER_SECONDS_MIN = 15;
export const BUFFER_SECONDS_MAX = 60;

/**
 * "Desligar buffer após inatividade" options, in minutes. 0 means "Nunca"
 * (the default) -- kept as a number rather than null so the persisted JSON
 * and the pill list in SettingsScreen stay trivially comparable.
 */
export type AutoStopMinutes = 0 | 30 | 60 | 120;

export const AUTO_STOP_OPTIONS: AutoStopMinutes[] = [0, 30, 60, 120];

/** Seconds without touches before pocket mode turns on by itself (when enabled). */
export const POCKET_MODE_DELAY_OPTIONS = [10, 20, 30, 60] as const;

export interface AppSettings {
  bufferSeconds: number;
  videoQuality: VideoQuality;
  fps: VideoFps;
  /** Auto-enter pocket mode (black screen, buffer still running) after pocketModeDelaySeconds without touches. */
  pocketModeAutoEnabled: boolean;
  pocketModeDelaySeconds: number;
  /** Volume buttons / Bluetooth shutter remotes / iPhone Camera Control toggle recording. */
  hardwareTriggersEnabled: boolean;
  autoStopMinutes: AutoStopMinutes;
}

export type PermissionKey = 'camera' | 'storage' | 'microphone';

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

/**
 * 'recording' is the open-ended manual-recording state between tapping
 * start and tapping stop -- its length is however long the user records,
 * not a fixed post-roll. 'saving' is the brief mux/finalize step right
 * after stop, before the clip is confirmed saved.
 */
export type RecordingPhase = 'idle' | 'buffering' | 'recording' | 'saving' | 'error';

/**
 * Native pipeline health, pushed by the CircularBufferHealth event (only on
 * transitions). Orthogonal to RecordingPhase: the buffer can be 'buffering'
 * while 'throttled' (reduced fps from thermal pressure) or 'recovering'
 * (watchdog rebuilding the encoder). See
 * docs/plans/2026-10-21-reliability-battery-triggers.md.
 */
export type BufferHealth = 'healthy' | 'recovering' | 'interrupted' | 'throttled';

/**
 * Always 'manual' right now -- there is no other capture trigger in this
 * app (wake word was removed, see DECISIONS.md "Wake word (removed)").
 * Kept as a field (rather than assumed implicitly) so the gallery's
 * per-clip origin indicator and this type don't need to change again if a
 * second trigger source is ever reintroduced.
 */
export type ClipTrigger = 'manual';

export interface SavedClip {
  id: string;
  path: string;
  createdAt: number;
  durationSeconds: number;
  triggeredBy: ClipTrigger;
}

export interface BufferConfig {
  bufferSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export interface SaveClipResult {
  path: string;
  durationSeconds: number;
}

export type RootStackParamList = {
  Onboarding: undefined;
  Permissions: undefined;
  Camera: undefined;
  Settings: undefined;
  Gallery: undefined;
  ClipPreview: { clipId: string };
  Tips: undefined;
};
