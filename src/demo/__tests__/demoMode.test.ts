import { act, renderHook } from '@testing-library/react-native';
import { DEMO_MODE, DEMO_SCENE, parseDemoScene } from '../demoMode';
import { useDemoCircularBuffer, useDemoZoom } from '../useDemoCircularBuffer';
import { useRecordingStore } from '../../shared/store/recordingStore';
import { useCameraStore } from '../../features/camera/store/cameraStore';

describe('demo mode', () => {
  it('is off without the -pegueiDemo launch argument', () => {
    expect(DEMO_MODE).toBe(false);
    expect(DEMO_SCENE).toBeNull();
  });

  it('falls back to the buffering scene for unknown values', () => {
    expect(parseDemoScene('settings')).toBe('settings');
    expect(parseDemoScene('nope')).toBe('buffering');
    expect(parseDemoScene(undefined)).toBe('buffering');
  });

  it('drives the recording store without the native buffer', async () => {
    jest.useFakeTimers();
    useRecordingStore.setState({ phase: 'idle', noticeMessage: null });
    const { result } = await renderHook(() => useDemoCircularBuffer());
    await act(async () => result.current.start());
    expect(useRecordingStore.getState().phase).toBe('buffering');
    await act(async () => result.current.startRecording());
    expect(useRecordingStore.getState().phase).toBe('recording');
    await act(async () => result.current.stopRecording());
    expect(useRecordingStore.getState().phase).toBe('saving');
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(useRecordingStore.getState().phase).toBe('buffering');
    expect(useRecordingStore.getState().noticeMessage).toMatch(/salvo/);
    jest.useRealTimers();
  });

  it('offers the 0,5x / 1x / 2x pills and keeps zoom in the store', async () => {
    const { result } = await renderHook(() => useDemoZoom());
    expect(result.current.pillLevels).toEqual([0.5, 1, 2]);
    await act(async () => result.current.setZoom(0.5));
    expect(useCameraStore.getState().zoomFactor).toBe(0.5);
  });
});
