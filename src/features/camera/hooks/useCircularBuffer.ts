import { useCallback, useEffect, useRef } from 'react';
import RNFS from 'react-native-fs';
import { CircularBufferModule, circularBufferEvents, type CircularBufferErrorEvent } from '../native/CircularBufferModule';
import { useRecordingStore } from '../../../shared/store/recordingStore';
import { useSettingsStore } from '../../settings/store/settingsStore';
import { encodeClipFilename } from '../../../shared/utils/files';
import { logClipSaved } from '../../../shared/utils/analytics';
import { VIDEO_QUALITY_PRESETS, type SavedClip } from '../../../shared/types';

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
        setError(err instanceof Error ? err.message : 'Não foi possível iniciar o buffer de vídeo.');
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
      // Returning to this screen (e.g. from Gallery) detaches/reattaches
      // the native preview, which reopens the camera+mic asynchronously --
      // tapping record before that finishes surfaces E_NOT_BUFFERING even
      // though the buffer is about to be ready again. How long the reopen
      // takes varies (it now also sets up the mic), so poll isBuffering()
      // for a few seconds instead of guessing a single fixed delay, and
      // only retry the actual start once it reports ready.
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
      if (code === 'E_NOT_BUFFERING') {
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!isMountedRef.current) {
            return;
          }
          const isBuffering = await CircularBufferModule.isBuffering().catch(() => false);
          if (!isBuffering) {
            continue;
          }
          try {
            await CircularBufferModule.startManualRecording();
            if (isMountedRef.current) {
              setPhase('recording');
            }
          } catch (retryErr) {
            if (isMountedRef.current) {
              setError(retryErr instanceof Error ? retryErr.message : 'Não foi possível iniciar a gravação.');
            }
          }
          return;
        }
      }
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Não foi possível iniciar a gravação.');
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
      logClipSaved(result.durationSeconds);
      return clip;
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Não foi possível salvar o clipe.');
        // The native buffer keeps running regardless of whether this one
        // save failed -- leaving phase stuck at 'saving' would read as
        // "the buffer stopped working" even though it's still buffering.
        setPhase('buffering');
      }
      return null;
    }
  }, [setPhase, setError, addClip]);

  return { phase, start, stop, startRecording, stopRecording };
}
