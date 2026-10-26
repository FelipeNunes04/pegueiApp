import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUFFER_SECONDS_MAX,
  BUFFER_SECONDS_MIN,
  type AppSettings,
  type AutoStopMinutes,
  type VideoFps,
  type VideoQuality,
} from '../../../shared/types';
import { clamp } from '../utils/validation';

const DEFAULT_SETTINGS: AppSettings = {
  bufferSeconds: 30,
  videoQuality: '1080p',
  fps: 30,
  pocketModeAutoEnabled: true,
  pocketModeDelaySeconds: 20,
  hardwareTriggersEnabled: true,
  autoStopMinutes: 0,
};

// Bounds for the pocket-mode delay -- below ~5 s it would kick in while the
// user is still framing a shot; the UI only offers POCKET_MODE_DELAY_OPTIONS
// anyway, this just guards against a bad persisted value.
const POCKET_DELAY_MIN = 5;
const POCKET_DELAY_MAX = 300;

interface SettingsState extends AppSettings {
  setBufferSeconds: (seconds: number) => void;
  setVideoQuality: (quality: VideoQuality) => void;
  setFps: (fps: VideoFps) => void;
  setPocketModeAutoEnabled: (enabled: boolean) => void;
  setPocketModeDelaySeconds: (seconds: number) => void;
  setHardwareTriggersEnabled: (enabled: boolean) => void;
  setAutoStopMinutes: (minutes: AutoStopMinutes) => void;
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
      setPocketModeAutoEnabled: enabled => set({ pocketModeAutoEnabled: enabled }),
      setPocketModeDelaySeconds: seconds =>
        set({ pocketModeDelaySeconds: clamp(seconds, POCKET_DELAY_MIN, POCKET_DELAY_MAX) }),
      setHardwareTriggersEnabled: enabled => set({ hardwareTriggersEnabled: enabled }),
      setAutoStopMinutes: minutes => set({ autoStopMinutes: minutes }),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'peguei-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // No version/migrate needed for the pocket-mode/hardware-trigger/
      // auto-stop fields added 2026-10-21: persist()'s default merge is
      // { ...currentState, ...persistedState }, so a payload saved by an
      // older build simply lacks those keys and they keep DEFAULT_SETTINGS'
      // values (covered by settingsStore.test.ts).
    },
  ),
);

export { DEFAULT_SETTINGS };
