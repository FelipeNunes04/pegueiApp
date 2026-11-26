import {
  fetchAndActivate,
  getBoolean,
  getRemoteConfig,
  getString,
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
} as const;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_DEFAULTS;

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

/** Tests only. */
export function resetRemoteConfigForTests(): void {
  initialized = false;
}
