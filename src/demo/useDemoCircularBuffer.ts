import { useCallback, useEffect, useRef } from 'react';
import { useRecordingStore } from '../shared/store/recordingStore';
import { useCameraStore } from '../features/camera/store/cameraStore';
import { useSettingsStore } from '../features/settings/store/settingsStore';
import type { RecordingPhase } from '../shared/types';
import { DEMO_SCENE } from './demoMode';

/** Timeline of the `story` scene (App Preview): wait, tap, record, save. */
export const STORY_TIMELINE_MS = { tap: 6000, stop: 10000, saved: 11200 } as const;

/**
 * Demo stand-in for useCircularBuffer (same return shape). Pure JS: drives
 * the shared recording store so BufferIndicator, RecordButton and the
 * notice banner render exactly as they do for real, without starting the
 * native camera or buffer. Only CameraScreen picks it, and only when
 * DEMO_MODE is true (debug builds launched with -pegueiDemo).
 */
export function useDemoCircularBuffer() {
  const phase = useRecordingStore(s => s.phase);
  const setPhase = useRecordingStore(s => s.setPhase);
  const setNotice = useRecordingStore(s => s.setNotice);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const stopRecording = useCallback(() => {
    setPhase('saving');
    later(1200, () => {
      setPhase('buffering');
      setNotice('O vídeo foi salvo com os segundos de antes do toque.');
    });
  }, [later, setPhase, setNotice]);

  const startRecording = useCallback(() => setPhase('recording'), [setPhase]);

  const start = useCallback(() => {
    // Store assets show the maximum window ("Até 60 segundos de buffer").
    // Only the simulator's demo install is affected.
    // No pocket mode or auto-stop taking over mid-capture.
    const settings = useSettingsStore.getState();
    settings.setBufferSeconds(60);
    settings.setPocketModeAutoEnabled(false);
    settings.setAutoStopMinutes(0);
    setPhase('buffering');
    if (DEMO_SCENE === 'wide') useCameraStore.getState().setZoomFactor(0.5);
    if (DEMO_SCENE === 'recording') later(400, () => setPhase('recording'));
    if (DEMO_SCENE === 'story') {
      later(STORY_TIMELINE_MS.tap, () => setPhase('recording'));
      later(STORY_TIMELINE_MS.stop, stopRecording);
    }
  }, [later, setPhase, stopRecording]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => stop, [stop]);

  return { phase, start, stop, startRecording, stopRecording };
}

/** Demo stand-in for useZoom: a triple-camera phone's pills (0,5x / 1x / 2x). */
export function useDemoZoom(_phase?: RecordingPhase) {
  const zoomFactor = useCameraStore(s => s.zoomFactor);
  const setZoomFactor = useCameraStore(s => s.setZoomFactor);
  const setZoom = useCallback(async (factor: number) => setZoomFactor(factor), [setZoomFactor]);
  return { zoomFactor, minZoom: 0.5, maxZoom: 10, hasUltraWide: true, pillLevels: [0.5, 1, 2], setZoom };
}
