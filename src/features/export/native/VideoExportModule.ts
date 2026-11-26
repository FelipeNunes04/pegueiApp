import { NativeModules } from 'react-native';
import type { SponsorPosicao } from '../../../analytics';

/**
 * Native export (AVFoundation on iOS, Media3 Transformer on Android):
 * re-encodes a saved clip, optionally cropped to 9:16, with the sponsor
 * watermark and the species/weight caption burned in. The original clip is
 * never touched. When a watermark is applied, native fires
 * sponsor_impression itself (PegueiAnalytics), after the file is written.
 */
export interface ExportCaption {
  species: string;
  /** Already formatted for display, e.g. "2,4 kg". Empty when not given. */
  weight: string;
  /** Local image for the sponsor slot in the caption; empty to leave the slot out. */
  logoPath: string;
}

export interface ExportWatermark {
  imagePath: string;
  position: SponsorPosicao;
  sponsorId: string;
}

export interface ExportOptions {
  inputPath: string;
  outputPath: string;
  portrait9x16: boolean;
  watermark: ExportWatermark | null;
  caption: ExportCaption | null;
}

export interface ExportResult {
  path: string;
  width: number;
  height: number;
  durationSeconds: number;
}

interface VideoExportNative {
  exportVideo(options: ExportOptions): Promise<ExportResult>;
}

const native = NativeModules.PegueiVideoExport as VideoExportNative | undefined;

export function isVideoExportAvailable(): boolean {
  return Boolean(native && typeof native.exportVideo === 'function');
}

export function exportVideo(options: ExportOptions): Promise<ExportResult> {
  if (!native) {
    return Promise.reject(Object.assign(new Error('Exportação indisponível nesta versão.'), { code: 'E_EXPORT_UNAVAILABLE' }));
  }
  return native.exportVideo(options);
}
