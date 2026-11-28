import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { recordError, startTrace, track, type Formato } from '../../analytics';
import { captureErrorLabel } from '../camera/utils/captureAnalytics';
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
  formato: Formato;
  sponsorId: string;
}

/** Short error text for export_failed: the native code or the message start, never a path. */
export function exportErrorLabel(err: unknown): string {
  return captureErrorLabel('native', err).replace(/^native:/, '');
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
  if (config.watermarkEnabled && config.watermarkAssetUrl && !watermarkPath) {
    // Offline with nothing cached: the video goes out without the mark.
    track('export_failed', { erro: 'marca_indisponivel', etapa: 'marca' });
  }
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
  // Only the vertical copy is timed: that is the export_9_16 trace.
  const exportTrace = request.portrait9x16 ? startTrace('export_9_16') : null;
  exportTrace?.putAttribute('marca_dagua', watermark ? '1' : '0');
  exportTrace?.putAttribute('overlay', caption ? '1' : '0');
  let result: ExportResult;
  try {
    result = await exportVideo({
      inputPath: toFsPath(request.clipPath),
      outputPath,
      portrait9x16: request.portrait9x16,
      watermark,
      caption,
    });
  } catch (err) {
    // A failed export is not timed: the trace is dropped, not sent.
    track('export_failed', { erro: exportErrorLabel(err), etapa: 'export' });
    recordError(err, 'export');
    throw err;
  }
  exportTrace?.stop();

  track('video_exported', {
    marca_dagua: watermark !== null,
    overlay: caption !== null,
    sponsor_id: watermark ? config.sponsorId : '',
  });
  if (caption) {
    track('overlay_added', { especie: speciesForAnalytics(species) || 'nao_informada', tem_peso: weight !== '' });
    track('share_card_template_used', { template: caption.logoPath ? 'cartao_especie_patrocinado' : 'cartao_especie' });
  }
  return {
    result,
    withWatermark: watermark !== null,
    withCaption: caption !== null,
    formato: request.portrait9x16 ? '9_16' : 'original',
    sponsorId: watermark ? config.sponsorId : '',
  };
}

export interface ShareInfo {
  formato: Formato;
  marcaDagua: boolean;
  overlay: boolean;
  sponsorId: string;
}

const DEFAULT_SHARE_INFO: ShareInfo = { formato: '9_16', marcaDagua: false, overlay: false, sponsorId: '' };

/** Opens the share sheet for an exported file and logs where it went. */
export async function shareExported(path: string, info: ShareInfo = DEFAULT_SHARE_INFO): Promise<void> {
  const url = path.startsWith('file://') ? path : `file://${path}`;
  track('share_sheet_opened', { formato: info.formato, marca_dagua: info.marcaDagua, overlay: info.overlay });
  try {
    const result = await Share.open({ url, type: 'video/mp4', failOnCancel: false });
    track('video_shared', {
      destino: shareDestination(result),
      quantidade: 1,
      formato: info.formato,
      marca_dagua: info.marcaDagua,
      sponsor_id: info.sponsorId,
    });
  } catch (err) {
    // Share sheet failed (a cancel resolves instead, with failOnCancel: false).
    track('export_failed', { erro: exportErrorLabel(err), etapa: 'compartilhar' });
  }
}
