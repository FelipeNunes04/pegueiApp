import { create } from 'zustand';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN, type AppSettings, type VideoQuality } from '../../../shared/types';
import { clamp } from '../utils/validation';

const DEFAULT_SETTINGS: AppSettings = {
  bufferSeconds: 30,
  videoQuality: '1080p',
};

interface SettingsState extends AppSettings {
  setBufferSeconds: (seconds: number) => void;
  setVideoQuality: (quality: VideoQuality) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>(set => ({
  ...DEFAULT_SETTINGS,
  setBufferSeconds: seconds =>
    set({ bufferSeconds: clamp(seconds, BUFFER_SECONDS_MIN, BUFFER_SECONDS_MAX) }),
  setVideoQuality: quality => set({ videoQuality: quality }),
  reset: () => set(DEFAULT_SETTINGS),
}));

export { DEFAULT_SETTINGS };
