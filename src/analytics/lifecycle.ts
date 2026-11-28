import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { setAnalyticsRegion } from './context';
import { setUserProperties, track } from './track';

/**
 * First-open attribution (`install_source`, `cohort_week`) and links from
 * Pesca Certa, with the same rules as Pesca Certa's analytics/lifecycle.ts.
 *
 * Pesca Certa opens Peguei with
 * `peguei://camera?from=pesca_certa&contexto=<viagem|checkin>`. The link
 * still opens the camera as before (same host as the Android App Action);
 * this only reads it.
 */

const KEY_FIRST_OPEN = 'peguei:analyticsFirstOpen';
const KEY_INSTALL_SOURCE = 'peguei:analyticsInstallSource';

export interface LinkInfo {
  /** Who sent the link (`from`, `source` or `utm_source`), cleaned; '' when none. */
  source: string;
  contexto: string;
  utmCampaign: string;
  geohash5: string;
}

/** Query params of a URL, keys in lower case. Pure; exported for tests. */
export function queryParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.indexOf('?');
  if (q < 0) return out;
  const query = url.slice(q + 1).split('#')[0];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    try {
      out[decodeURIComponent(rawKey).toLowerCase()] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // malformed escape: skip this pair
    }
  }
  return out;
}

export function clean(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 60);
}

/** Reads a Peguei link. Pure; exported for tests. */
export function parseLink(url: string | null | undefined): LinkInfo | null {
  if (!url || !/^peguei:\/\//i.test(url)) return null;
  const params = queryParams(url);
  return {
    source: clean(params.from ?? params.source ?? params.utm_source),
    contexto: clean(params.contexto),
    utmCampaign: clean(params.utm_campaign),
    geohash5: params.geohash5 ?? '',
  };
}

/** ISO week of a date, e.g. "2026-W48". Pure; exported for tests. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** `install_source` for a first open. Pure; exported for tests. */
export function installSourceFor(link: LinkInfo | null): string {
  if (!link) return 'organico';
  return link.source || 'deeplink';
}

async function firstOpen(link: LinkInfo | null): Promise<void> {
  const seen = await AsyncStorage.getItem(KEY_FIRST_OPEN);
  if (seen) {
    const source = (await AsyncStorage.getItem(KEY_INSTALL_SOURCE)) ?? 'organico';
    setUserProperties({ cohort_week: seen, install_source: source });
    return;
  }
  const week = isoWeek(new Date());
  const source = installSourceFor(link);
  await AsyncStorage.setItem(KEY_FIRST_OPEN, week);
  await AsyncStorage.setItem(KEY_INSTALL_SOURCE, source);
  setUserProperties({ cohort_week: week, install_source: source });
}

function handleLink(link: LinkInfo | null): void {
  if (!link || link.source !== 'pesca_certa') return;
  if (link.geohash5) setAnalyticsRegion(link.geohash5);
  setUserProperties({ has_pesca_certa: 'sim' });
  track('opened_from_pesca_certa', { contexto: link.contexto || 'abrir' });
}

let started = false;

/** Call once at startup, after initAnalytics(). Never throws. */
export function startLifecycleAnalytics(): void {
  if (started) return;
  started = true;
  (async () => {
    try {
      const url = await Linking.getInitialURL().catch((): null => null);
      const link = parseLink(url);
      await firstOpen(link).catch(() => undefined);
      handleLink(link);
    } catch {
      // ignore
    }
  })();
  try {
    Linking.addEventListener('url', ({ url }) => handleLink(parseLink(url)));
  } catch {
    // ignore
  }
}

/** Tests only. */
export function resetLifecycleForTests(): void {
  started = false;
}
