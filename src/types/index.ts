export type VideoQuality = '720p' | '1080p' | '4k';

export interface VideoQualityPreset {
  quality: VideoQuality;
  width: number;
  height: number;
  fps: number;
}

export const VIDEO_QUALITY_PRESETS: Record<VideoQuality, VideoQualityPreset> = {
  '720p': { quality: '720p', width: 1280, height: 720, fps: 30 },
  '1080p': { quality: '1080p', width: 1920, height: 1080, fps: 30 },
  '4k': { quality: '4k', width: 3840, height: 2160, fps: 30 },
};

/** Inclusive bounds enforced by SettingsScreen and validation utils. */
export const BUFFER_SECONDS_MIN = 15;
export const BUFFER_SECONDS_MAX = 60;

export interface AppSettings {
  bufferSeconds: number;
  videoQuality: VideoQuality;
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
