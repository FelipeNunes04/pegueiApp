import { DEFAULT_SETTINGS, useSettingsStore } from '../store/settingsStore';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN } from '../../../shared/types';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState(DEFAULT_SETTINGS);
  });

  it('clamps buffer seconds to the configured bounds', () => {
    useSettingsStore.getState().setBufferSeconds(999);
    expect(useSettingsStore.getState().bufferSeconds).toBe(BUFFER_SECONDS_MAX);

    useSettingsStore.getState().setBufferSeconds(-5);
    expect(useSettingsStore.getState().bufferSeconds).toBe(BUFFER_SECONDS_MIN);
  });

  it('reset() restores all defaults', () => {
    useSettingsStore.getState().setBufferSeconds(60);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().bufferSeconds).toBe(DEFAULT_SETTINGS.bufferSeconds);
  });
});
