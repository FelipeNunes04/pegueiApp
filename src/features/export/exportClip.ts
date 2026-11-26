import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { track } from '../../analytics';
import { getSponsorConfig } from '../../config/remoteConfig';
import { shareDestination } from '../gallery/utils/shareDestination';
import { fetchAsset } from './sponsorAssets';
import { exportVideo, type ExportCaption, type ExportResult, type ExportWatermark } from './native/VideoExportModule';

/** Species offered as one-tap chips; anything else can be typed. */
export const COMMON_SPECIES = ['Tucunaré', 'Tilápia', 'Traíra', 'Tambaqui', 'Pacu', 'Dourado', 'Robalo', 'Pintado'] as const;

const EXPORT_DIR = `${RNFS.CachesDirectoryPath}/exports`;
const MAX_WEIGHT_KG = 500;

/** "2.4", "2,4" or "2,40 kg" -> "2,4 kg". Empty or nonsense -> "". */
export function formatWeight(input: string): string {
  const match = /^\s*(\d{1,3})(?:[.,](\d{1,3}))?\s*(kg)?\s*$/i.exec(input);
  if (!match) return '';
  const value = Number(`${match[1]}.${match[2] ?? '0'}`);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_WEIGHT_KG) return '';
  const text = (Math.round(value * 100) / 100).toString().replace('.', ',');
  return `${text} kg`;
}

/** Species text as sent to analytics: trimmed, lower case, short. */
export function speciesForAnalytics(species: string): string {
  return species.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').slice(0, 40);
}

export interface ExportRequest {
  clipPath: string;
  portrait9x16: boolean;
  species: string;
  weight: string;
}

export interface ExportOutcome {
  result: ExportResult;
  withWatermark: boolean;
  withCaption: boolean;
}

function toFsPath(path: string): string {
  return path.startsWith('file://') ? path.slice(7) : path;
}

async function clearOldExports(): Promise<void> {
  try {
    if (await RNFS.exists(EXPORT_DIR)) await RNFS.unlink(EXPORT_DIR);
    await RNFS.mkdir(EXPORT_DIR);
  } catch {
    // A leftover file in the caches folder is harmless.
  }
}

/**
 * Builds the export from the Remote Config sponsorship settings and the
 * user's caption, runs the native export and logs video_exported /
 * overlay_added. A sponsor image that can't be fetched (offline) is simply
 * left out.
 */
export async function exportClip(request: ExportRequest): Promise<ExportOutcome> {
  const config = getSponsorConfig();
  const species = request.species.trim().slice(0, 40);
  const weight = formatWeight(request.weight);

  const watermarkPath = config.watermarkEnabled ? await fetchAsset(config.watermarkAssetUrl) : null;
  const watermark: ExportWatermark | null = watermarkPath
    ? { imagePath: watermarkPath, position: config.sponsorPosition, sponsorId: config.sponsorId }
    : null;

  let caption: ExportCaption | null = null;
  if (species || weight) {
    const logoPath = (await fetchAsset(config.overlaySponsorLogoUrl)) ?? '';
    caption = { species, weight, logoPath };
  }

  await clearOldExports();
  const outputPath = `${EXPORT_DIR}/peguei_${Date.now()}.mp4`;
  const result = await exportVideo({
    inputPath: toFsPath(request.clipPath),
    outputPath,
    portrait9x16: request.portrait9x16,
    watermark,
    caption,
  });

  track('video_exported', {
    marca_dagua: watermark !== null,
    overlay: caption !== null,
    sponsor_id: watermark ? config.sponsorId : '',
  });
  if (caption) {
    track('overlay_added', { especie: speciesForAnalytics(species) || 'nao_informada', tem_peso: weight !== '' });
  }
  return { result, withWatermark: watermark !== null, withCaption: caption !== null };
}

/** Opens the share sheet for an exported file and logs where it went. */
export async function shareExported(path: string): Promise<void> {
  const url = path.startsWith('file://') ? path : `file://${path}`;
  try {
    const result = await Share.open({ url, type: 'video/mp4' });
    track('video_shared', { destino: shareDestination(result), quantidade: 1 });
  } catch {
    // Share sheet closed or failed: nothing to log beyond the export.
  }
}
