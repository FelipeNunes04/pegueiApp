import {
  fetchAndActivate,
  getBoolean,
  getRemoteConfig,
  getString,
  getValue,
} from '@react-native-firebase/remote-config';
import type { SponsorPosicao } from '../analytics';

/**
 * Sponsorship settings from Firebase Remote Config. Every key has a local
 * default, so the app works the same offline or before the first fetch:
 * with the defaults below no watermark is applied. The SDK keeps the last
 * activated values on the phone, so a fetched config also survives offline
 * restarts.
 */
export const REMOTE_CONFIG_DEFAULTS = {
  watermark_enabled: false,
  watermark_asset_url: '',
  sponsor_id: '',
  sponsor_position: 'bottom_right',
  overlay_sponsor_logo_url: '',
  /** Tap on the sponsor note in the export screen opens this (https). Empty: not tappable. */
  sponsor_link_url: '',

  // Analytics (1.3.0). Defaults keep the app working offline and before the first fetch.
  /** Remote kill switch for every event (the local opt-out still wins). */
  analytics_enabled: true,
  /** Fishing session events and the 5-min device samples. */
  session_metrics_enabled: true,
  /** Minutes between buffer_health_sampled; never less than 5. */
  buffer_sample_interval_min: 5,

  // New features that change what users see: off until switched on.
  /** Warns on the camera screen when free space is low. */
  storage_warning_enabled: false,
  storage_warning_gb: 2,
  /** "Registrar no Pesca Certa" on the export screen (deep link to the diary). */
  pesca_certa_cta_enabled: false,
  pesca_certa_app_store_url: 'https://apps.apple.com/app/id6760917467',
  pesca_certa_play_url: 'https://play.google.com/store/apps/details?id=br.com.pescacerta.android',
} as const;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_DEFAULTS;

type KeysOfType<T> = { [K in RemoteConfigKey]: (typeof REMOTE_CONFIG_DEFAULTS)[K] extends T ? K : never }[RemoteConfigKey];
export type BooleanConfigKey = KeysOfType<boolean>;
export type NumberConfigKey = KeysOfType<number>;
export type StringConfigKey = KeysOfType<string>;

export interface SponsorConfig {
  watermarkEnabled: boolean;
  watermarkAssetUrl: string;
  sponsorId: string;
  sponsorPosition: SponsorPosicao;
  overlaySponsorLogoUrl: string;
}

const POSITIONS: readonly SponsorPosicao[] = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];

// 12 h in production (Firebase's recommended floor); every launch in development.
const MIN_FETCH_INTERVAL_MS = __DEV__ ? 0 : 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

let initialized = false;

function isPosition(value: string): value is SponsorPosicao {
  return (POSITIONS as readonly string[]).includes(value);
}

/** Only https URLs are used for remote images. */
export function safeHttpsUrl(value: string): string {
  return /^https:\/\/\S+$/i.test(value.trim()) ? value.trim() : '';
}

export function defaultSponsorConfig(): SponsorConfig {
  return {
    watermarkEnabled: REMOTE_CONFIG_DEFAULTS.watermark_enabled,
    watermarkAssetUrl: REMOTE_CONFIG_DEFAULTS.watermark_asset_url,
    sponsorId: REMOTE_CONFIG_DEFAULTS.sponsor_id,
    sponsorPosition: REMOTE_CONFIG_DEFAULTS.sponsor_position,
    overlaySponsorLogoUrl: REMOTE_CONFIG_DEFAULTS.overlay_sponsor_logo_url,
  };
}

/**
 * Sets the defaults and fetches in the background. Never throws and never
 * blocks startup; call once at launch. Resolves true when new values were
 * activated.
 */
export async function initRemoteConfig(): Promise<boolean> {
  try {
    const rc = getRemoteConfig();
    if (!initialized) {
      rc.defaultConfig = { ...REMOTE_CONFIG_DEFAULTS };
      rc.settings = { minimumFetchIntervalMillis: MIN_FETCH_INTERVAL_MS, fetchTimeoutMillis: FETCH_TIMEOUT_MS };
      initialized = true;
    }
    return await fetchAndActivate(rc);
  } catch {
    return false;
  }
}

/** The activated values, checked and normalised; the defaults if anything is off. */
export function getSponsorConfig(): SponsorConfig {
  try {
    const rc = getRemoteConfig();
    const position = getString(rc, 'sponsor_position');
    return {
      watermarkEnabled: getBoolean(rc, 'watermark_enabled'),
      watermarkAssetUrl: safeHttpsUrl(getString(rc, 'watermark_asset_url')),
      sponsorId: getString(rc, 'sponsor_id').trim().slice(0, 60),
      sponsorPosition: isPosition(position) ? position : REMOTE_CONFIG_DEFAULTS.sponsor_position,
      overlaySponsorLogoUrl: safeHttpsUrl(getString(rc, 'overlay_sponsor_logo_url')),
    };
  } catch {
    return defaultSponsorConfig();
  }
}

/**
 * The activated value of a key, or null while it has no value at all
 * (source `static`: before the native defaults are set on a cold start).
 * Null makes the getters below use the local default, so a flag never reads
 * as `false` just because Remote Config is not ready yet.
 */
function activeValue(key: RemoteConfigKey): ReturnType<typeof getValue> | null {
  try {
    const value = getValue(getRemoteConfig(), key);
    return value.getSource() === 'static' ? null : value;
  } catch {
    return null;
  }
}

/** A boolean flag; its local default when Remote Config is missing, not ready or fails. */
export function getFlag(key: BooleanConfigKey): boolean {
  const value = activeValue(key);
  return value ? value.asBoolean() : REMOTE_CONFIG_DEFAULTS[key];
}

export function getConfigNumber(key: NumberConfigKey): number {
  const value = activeValue(key);
  const n = value ? value.asNumber() : NaN;
  return Number.isFinite(n) ? n : REMOTE_CONFIG_DEFAULTS[key];
}

export function getConfigString(key: StringConfigKey): string {
  const value = activeValue(key);
  return value ? value.asString() : REMOTE_CONFIG_DEFAULTS[key];
}

/** Tests only. */
export function resetRemoteConfigForTests(): void {
  initialized = false;
}
