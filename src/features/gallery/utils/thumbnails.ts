import { Platform } from 'react-native';
import { createThumbnail } from 'react-native-create-thumbnail';

/**
 * Best-effort video frame thumbnail for a saved clip. Returns null on any
 * failure so callers fall back to a placeholder icon instead of crashing.
 *
 * react-native-create-thumbnail's two native implementations disagree on
 * what a plain absolute path should look like: Android's requires a
 * `file://` prefix (it explicitly checks `URLUtil.isFileUrl` and strips the
 * prefix before calling `MediaMetadataRetriever.setDataSource`), while iOS's
 * calls `NSURL(fileURLWithPath:)` directly on whatever isn't `http(s)://` --
 * passing it an already-prefixed `file://...` string there makes it treat
 * the literal string "file://..." as a relative path component, which
 * fails to resolve and surfaces as a generic "no permission to view it"
 * error. Clip paths from the native buffer modules are always plain
 * filesystem paths (no scheme), so the prefix only needs to be added on
 * Android.
 */
// Clip files are immutable and uniquely named (the timestamp is baked into
// the filename, see utils/files.ts), so caching by path for the lifetime of
// the app is safe -- it's what keeps the gallery grid from re-decoding a
// frame out of the same video file on every mount/scroll-back-into-view.
const thumbnailCache = new Map<string, Promise<string | null>>();

export async function getClipThumbnail(clipPath: string): Promise<string | null> {
  const cached = thumbnailCache.get(clipPath);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    try {
      const bare = clipPath.replace(/^file:\/\//, '');
      const url = Platform.OS === 'android' ? `file://${bare}` : bare;
      const { path } = await createThumbnail({ url, timeStamp: 0 });
      return path.startsWith('file://') ? path : `file://${path}`;
    } catch {
      return null;
    }
  })();

  thumbnailCache.set(clipPath, promise);
  const result = await promise;
  if (result === null) {
    // Don't pin a failure in the cache -- a transient error (e.g. the file
    // wasn't fully flushed yet) shouldn't permanently deny a retry.
    thumbnailCache.delete(clipPath);
  }
  return result;
}

/** Evicts a clip's cached thumbnail -- call after deleting the underlying file. */
export function clearClipThumbnailCache(clipPath: string): void {
  thumbnailCache.delete(clipPath);
}
