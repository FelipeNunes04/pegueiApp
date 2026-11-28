import { Linking, Platform } from 'react-native';
import { setUserProperties, track, type EspeciePescaCerta } from '../../analytics';
import { getAnalyticsContext } from '../../analytics/context';
import { sanitizeGeohash5 } from '../../analytics/geohash';
import { getConfigString, getFlag } from '../../config/remoteConfig';

/**
 * Peguei → Pesca Certa. The link contract, the same on both apps:
 * `pescacerta://diario?from=peguei&contexto=captura&especie=<key>&data=<YYYY-MM-DD>&geohash5=<5 chars>`.
 * Pesca Certa reads `from=peguei` and `contexto` for `opened_from_peguei`.
 * Never an exact coordinate: only a geohash5, and only when one is known
 * (Peguei has no location permission, so usually it is left out).
 */

const KEYS: readonly EspeciePescaCerta[] = [
  'tucunare', 'traira', 'tilapia', 'tambaqui', 'dourado', 'curimata',
  'piau', 'pescada_piaui', 'pacu', 'mandi', 'piranha', 'outra',
];

const ALIASES: Record<string, EspeciePescaCerta> = {
  pescada: 'pescada_piaui',
  pescada_do_piaui: 'pescada_piaui',
  curimbata: 'curimata',
};

/** Species text from the export screen → Pesca Certa key; `outra` when unknown. Pure; exported for tests. */
export function toPescaCertaSpecies(text: string): EspeciePescaCerta {
  const key = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if ((KEYS as readonly string[]).includes(key)) return key as EspeciePescaCerta;
  return ALIASES[key] ?? 'outra';
}

/** Local date as YYYY-MM-DD. Pure; exported for tests. */
export function localDate(timestamp: number): string {
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Builds the diary link. Pure; exported for tests. */
export function buildDiaryLink(especie: EspeciePescaCerta, capturedAt: number, geohash5: string): string {
  const params = [
    'from=peguei',
    'contexto=captura',
    `especie=${encodeURIComponent(especie)}`,
    `data=${localDate(capturedAt)}`,
  ];
  const area = sanitizeGeohash5(geohash5);
  if (area) params.push(`geohash5=${area}`);
  return `pescacerta://diario?${params.join('&')}`;
}

export function isPescaCertaCtaEnabled(): boolean {
  return getFlag('pesca_certa_cta_enabled');
}

export function pescaCertaStoreUrl(os: string = Platform.OS): string {
  const url = getConfigString(os === 'android' ? 'pesca_certa_play_url' : 'pesca_certa_app_store_url').trim();
  return /^https:\/\/\S+$/i.test(url) ? url : '';
}

/**
 * Opens Pesca Certa's diary with the catch. When Pesca Certa is not
 * installed, opens its store page instead. Resolves what happened.
 */
export async function sendCatchToPescaCerta(species: string, capturedAt: number): Promise<'enviado' | 'loja' | 'falhou'> {
  const especie = toPescaCertaSpecies(species);
  const link = buildDiaryLink(especie, capturedAt, getAnalyticsContext().region_geohash5);
  try {
    await Linking.openURL(link);
    setUserProperties({ has_pesca_certa: 'sim' });
    track('catch_sent_to_pesca_certa', { especie });
    return 'enviado';
  } catch {
    const store = pescaCertaStoreUrl();
    if (!store) return 'falhou';
    try {
      await Linking.openURL(store);
      return 'loja';
    } catch {
      return 'falhou';
    }
  }
}
