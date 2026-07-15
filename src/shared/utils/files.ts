import RNFS from 'react-native-fs';
import { clearClipThumbnailCache } from '../../features/gallery/utils/thumbnails';
import type { SavedClip } from '../types/index';

export const CLIPS_DIR = `${RNFS.DocumentDirectoryPath}/PegueiClips`;

// Native save (`CircularBufferModule.stopManualRecording`) only ever returns
// `SaveClipResult.durationSeconds` in memory, for the single JS session that
// just recorded it. `listSavedClips()` below rebuilds the clip list from a
// plain directory listing (on Gallery mount, and after every app restart),
// which has no way to recover that value from the file itself -- video
// duration isn't otherwise available without decoding the whole file, which
// the gallery's performance requirement explicitly rules out doing per
// render. So duration is encoded directly in the filename immediately after
// save (`encodeClipFilename`/`useCircularBuffer.stopRecording`), the same
// no-extra-persistence-layer trick previously used (and now stale, see
// DECISIONS.md) for `triggeredBy`.
const CLIP_FILENAME_PATTERN = /^clip_(\d+)(?:_d(\d+))?\.(mp4|mov)$/i;

export function encodeClipFilename(createdAtMs: number, durationMs: number): string {
  return `clip_${createdAtMs}_d${Math.round(durationMs)}.mp4`;
}

export async function ensureClipsDirExists(): Promise<void> {
  const exists = await RNFS.exists(CLIPS_DIR);
  if (!exists) {
    await RNFS.mkdir(CLIPS_DIR);
  }
}

export async function listSavedClips(): Promise<SavedClip[]> {
  await ensureClipsDirExists();
  const entries = await RNFS.readDir(CLIPS_DIR);
  return entries
    .filter(entry => entry.isFile() && /\.(mp4|mov)$/i.test(entry.name))
    .map(entry => {
      const match = entry.name.match(CLIP_FILENAME_PATTERN);
      const durationMs = match?.[2] ? Number(match[2]) : 0;
      return {
        id: entry.name,
        path: entry.path,
        createdAt: entry.mtime ? entry.mtime.getTime() : Date.now(),
        durationSeconds: durationMs / 1000,
        triggeredBy: 'manual' as const,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteClip(path: string): Promise<void> {
  const exists = await RNFS.exists(path);
  if (exists) {
    await RNFS.unlink(path);
  }
  clearClipThumbnailCache(path);
}
