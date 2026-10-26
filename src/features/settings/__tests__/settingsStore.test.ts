import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { DEFAULT_SETTINGS, useSettingsStore } from '../store/settingsStore';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN } from '../../../shared/types';

describe('settingsStore', () => {
  beforeEach(async () => {
    useSettingsStore.setState(DEFAULT_SETTINGS);
    await AsyncStorage.clear();
  });

  it('clamps buffer seconds to the configured bounds', () => {
    useSettingsStore.getState().setBufferSeconds(999);
    expect(useSettingsStore.getState().bufferSeconds).toBe(BUFFER_SECONDS_MAX);

    useSettingsStore.getState().setBufferSeconds(-5);
    expect(useSettingsStore.getState().bufferSeconds).toBe(BUFFER_SECONDS_MIN);
  });

  it('setFps() updates the configured frame rate', () => {
    useSettingsStore.getState().setFps(60);
    expect(useSettingsStore.getState().fps).toBe(60);

    useSettingsStore.getState().setFps(24);
    expect(useSettingsStore.getState().fps).toBe(24);
  });

  it('defaults to 30fps, 1080p and a 30s buffer', () => {
    expect(useSettingsStore.getState()).toMatchObject({ bufferSeconds: 30, videoQuality: '1080p', fps: 30 });
  });

  it('reset() restores all defaults', () => {
    useSettingsStore.getState().setBufferSeconds(60);
    useSettingsStore.getState().setFps(60);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().bufferSeconds).toBe(DEFAULT_SETTINGS.bufferSeconds);
    expect(useSettingsStore.getState().fps).toBe(DEFAULT_SETTINGS.fps);
  });

  // Regression test: settingsStore previously held no persistence at all, so
  // a cold app restart silently reset bufferSeconds/videoQuality back to the
  // hardcoded defaults regardless of what the user had configured -- which
  // is exactly the "buffer is always 30s" symptom reported against a fresh
  // launch. persist() writes to AsyncStorage asynchronously, so this must
  // wait for the write rather than asserting immediately after the setter.
  it('persists bufferSeconds/videoQuality/fps to AsyncStorage so they survive a cold restart', async () => {
    useSettingsStore.getState().setBufferSeconds(45);
    useSettingsStore.getState().setVideoQuality('4k');
    useSettingsStore.getState().setFps(60);

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('peguei-settings');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed.state).toMatchObject({ bufferSeconds: 45, videoQuality: '4k', fps: 60 });
    });
  });

  it('defaults to pocket mode on after 20 s, hardware triggers on and auto-stop "Nunca"', () => {
    expect(useSettingsStore.getState()).toMatchObject({
      pocketModeAutoEnabled: true,
      pocketModeDelaySeconds: 20,
      hardwareTriggersEnabled: true,
      autoStopMinutes: 0,
    });
  });

  it('updates the pocket-mode, hardware-trigger and auto-stop settings, clamping the delay', () => {
    const state = useSettingsStore.getState();
    state.setPocketModeAutoEnabled(false);
    state.setPocketModeDelaySeconds(30);
    state.setHardwareTriggersEnabled(false);
    state.setAutoStopMinutes(120);
    expect(useSettingsStore.getState()).toMatchObject({
      pocketModeAutoEnabled: false,
      pocketModeDelaySeconds: 30,
      hardwareTriggersEnabled: false,
      autoStopMinutes: 120,
    });

    state.setPocketModeDelaySeconds(1);
    expect(useSettingsStore.getState().pocketModeDelaySeconds).toBe(5);
    state.setPocketModeDelaySeconds(10_000);
    expect(useSettingsStore.getState().pocketModeDelaySeconds).toBe(300);
  });

  // A payload persisted by a build from before these settings existed must
  // hydrate with the new fields at their defaults, not undefined.
  it('hydrates an older persisted payload with defaults for the new fields', async () => {
    await AsyncStorage.setItem(
      'peguei-settings',
      JSON.stringify({ state: { bufferSeconds: 45, videoQuality: '720p', fps: 24 }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      bufferSeconds: 45,
      videoQuality: '720p',
      fps: 24,
      pocketModeAutoEnabled: true,
      pocketModeDelaySeconds: 20,
      hardwareTriggersEnabled: true,
      autoStopMinutes: 0,
    });
  });
});
