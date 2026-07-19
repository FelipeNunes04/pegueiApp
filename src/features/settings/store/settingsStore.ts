import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN, type AppSettings, type VideoFps, type VideoQuality } from '../../../shared/types';
import { clamp } from '../utils/validation';

const DEFAULT_SETTINGS: AppSettings = {
  bufferSeconds: 30,
  videoQuality: '1080p',
  fps: 30,
};

interface SettingsState extends AppSettings {
  setBufferSeconds: (seconds: number) => void;
  setVideoQuality: (quality: VideoQuality) => void;
  setFps: (fps: VideoFps) => void;
  reset: () => void;
}

// Persisted so a user's chosen buffer/quality/fps survive an app restart --
// previously this was a plain in-memory store, so every cold launch silently
// reset back to these defaults regardless of what was last configured.
export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      ...DEFAULT_SETTINGS,
      setBufferSeconds: seconds =>
        set({ bufferSeconds: clamp(seconds, BUFFER_SECONDS_MIN, BUFFER_SECONDS_MAX) }),
      setVideoQuality: quality => set({ videoQuality: quality }),
      setFps: fps => set({ fps }),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'peguei-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export { DEFAULT_SETTINGS };
