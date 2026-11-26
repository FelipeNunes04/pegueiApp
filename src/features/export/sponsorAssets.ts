import RNFS from 'react-native-fs';
import { getSponsorConfig } from '../../config/remoteConfig';

/**
 * Sponsor images (watermark, overlay logo) are downloaded once and kept in
 * the caches folder, so exporting works offline. A missing image never
 * blocks an export: the video just goes out without it.
 */
const DIR = `${RNFS.CachesDirectoryPath}/sponsor-assets`;
const MAX_BYTES = 2 * 1024 * 1024;

/** Stable file name for a URL (djb2), keeping a png/jpg/webp extension when there is one. */
export function assetFileName(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 33 + url.charCodeAt(i)) % 4294967296;
  }
  const ext = /\.(png|jpe?g|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'png';
  return `${hash.toString(16)}.${ext}`;
}

function pathFor(url: string): string {
  return `${DIR}/${assetFileName(url)}`;
}

/** Local path of an already downloaded image, or null. */
export async function getCachedAsset(url: string): Promise<string | null> {
  if (!url) return null;
  const path = pathFor(url);
  try {
    return (await RNFS.exists(path)) ? path : null;
  } catch {
    return null;
  }
}

/** Downloads the image if it isn't cached yet. Returns its local path, or null. */
export async function fetchAsset(url: string): Promise<string | null> {
  if (!url) return null;
  const cached = await getCachedAsset(url);
  if (cached) return cached;
  const path = pathFor(url);
  const tmp = `${path}.download`;
  try {
    await RNFS.mkdir(DIR);
    const { promise } = RNFS.downloadFile({ fromUrl: url, toFile: tmp, background: false, readTimeout: 15_000 });
    const result = await promise;
    const stat = await RNFS.stat(tmp);
    if (result.statusCode !== 200 || Number(stat.size) <= 0 || Number(stat.size) > MAX_BYTES) {
      await RNFS.unlink(tmp).catch(() => undefined);
      return null;
    }
    await RNFS.moveFile(tmp, path);
    return path;
  } catch {
    await RNFS.unlink(tmp).catch(() => undefined);
    return null;
  }
}

/** Fetches the images the current config points to (after a Remote Config refresh). */
export async function prefetchSponsorAssets(): Promise<void> {
  const config = getSponsorConfig();
  const urls = [config.watermarkEnabled ? config.watermarkAssetUrl : '', config.overlaySponsorLogoUrl].filter(Boolean);
  await Promise.all(urls.map(url => fetchAsset(url)));
}
