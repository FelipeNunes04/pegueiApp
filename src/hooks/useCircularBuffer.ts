import { useCallback, useEffect, useRef } from 'react';
import RNFS from 'react-native-fs';
import { CircularBufferModule, circularBufferEvents, type CircularBufferErrorEvent } from '../native/CircularBufferModule';
import { useRecordingStore } from '../store/recordingStore';
import { useSettingsStore } from '../store/settingsStore';
import { encodeClipFilename } from '../utils/files';
import { VIDEO_QUALITY_PRESETS, type SavedClip } from '../types';

/**
 * Owns the lifecycle of the native circular buffer: start on mount (once
 * permissions are granted), stop on unmount, and exposes imperative
 * startRecording()/stopRecording() that the manual record button calls --
 * start begins a manual recording (its length is however long the user
 * keeps recording, not a fixed post-roll), stop finalizes it into a saved
 * clip that concatenates the pre-roll buffer with the manually recorded
 * segment. See DECISIONS.md.
 */
export function useCircularBuffer() {
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const videoQuality = useSettingsStore(s => s.videoQuality);
  const phase = useRecordingStore(s => s.phase);
  const setPhase = useRecordingStore(s => s.setPhase);
  const setError = useRecordingStore(s => s.setError);
  const addClip = useRecordingStore(s => s.addClip);

  const isMountedRef = useRef(true);
  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  // Errors that happen after startBuffering()'s promise already resolved
  // (camera becomes busy, session disconnected mid-buffer) have no pending
  // Promise to reject on the native side, so they arrive as a device event
  // instead. Without this, a mid-session camera failure would leave the UI
  // silently stuck on "buffering" forever with no error banner. See DECISIONS.md.
  useEffect(() => {
    if (!circularBufferEvents) {
      return undefined;
    }
    const subscription = circularBufferEvents.addListener(
      'CircularBufferError',
      (event: CircularBufferErrorEvent) => {
        if (isMountedRef.current) {
          setError(event.message);
        }
      },
    );
    return () => subscription.remove();
  }, [setError]);

  const start = useCallback(async () => {
    const preset = VIDEO_QUALITY_PRESETS[videoQuality];
    try {
      await CircularBufferModule.startBuffering({
        bufferSeconds,
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
      });
      if (isMountedRef.current) {
        setPhase('buffering');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Falha ao iniciar o buffer de vídeo.');
      }
    }
  }, [bufferSeconds, videoQuality, setPhase, setError]);

  const stop = useCallback(async () => {
    try {
      await CircularBufferModule.stopBuffering();
    } finally {
      if (isMountedRef.current) {
        setPhase('idle');
      }
    }
  }, [setPhase]);

  const startRecording = useCallback(async () => {
    try {
      await CircularBufferModule.startManualRecording();
      if (isMountedRef.current) {
        setPhase('recording');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Falha ao iniciar a gravação.');
      }
    }
  }, [setPhase, setError]);

  const stopRecording = useCallback(async (): Promise<SavedClip | null> => {
    setPhase('saving');
    try {
      const result = await CircularBufferModule.stopManualRecording();
      const createdAt = Date.now();

      // Rename to embed the real duration in the filename so a cold
      // directory listing (listSavedClips, used by GalleryScreen and after
      // app restarts) can recover it without decoding the video -- see the
      // comment on encodeClipFilename in utils/files.ts.
      const dir = result.path.slice(0, result.path.lastIndexOf('/'));
      const renamedPath = `${dir}/${encodeClipFilename(createdAt, result.durationSeconds * 1000)}`;
      let finalPath = result.path;
      try {
        await RNFS.moveFile(result.path, renamedPath);
        finalPath = renamedPath;
      } catch {
        // Non-fatal: keep the clip under its original path/name if the
        // rename fails -- it's still saved and playable, it just won't show
        // its real duration on a cold directory re-listing. Not worth
        // failing the whole save over a rename.
      }

      const clip: SavedClip = {
        id: `${createdAt}`,
        path: finalPath,
        createdAt,
        durationSeconds: result.durationSeconds,
        triggeredBy: 'manual',
      };
      if (isMountedRef.current) {
        addClip(clip);
        setPhase('buffering');
      }
      return clip;
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Falha ao salvar o clipe.');
      }
      return null;
    }
  }, [setPhase, setError, addClip]);

  return { phase, start, stop, startRecording, stopRecording };
}
