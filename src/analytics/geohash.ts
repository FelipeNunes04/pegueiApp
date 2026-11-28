/**
 * Geohash encoder, the same as Pesca Certa's (analytics/geohash.ts). Analytics only ever sees an area, never a point: with 5
 * characters a cell is about 4.9 km x 4.9 km, so a fishing spot cannot be
 * recovered from the data. Fishing spots are the angler's secret.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Precision used for every analytics param (`region_geohash5`). */
export const ANALYTICS_GEOHASH_PRECISION = 5;

export function encodeGeohash(lat: number, lng: number, precision: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const clampedLng = Math.max(-180, Math.min(180, lng));
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bits = 0;
  let value = 0;
  let evenBit = true; // geohash interleaves bits, longitude first
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (clampedLng >= mid) {
        value = value * 2 + 1;
        lngMin = mid;
      } else {
        value *= 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (clampedLat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value *= 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bits += 1;
    if (bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

/** The only way coordinates may enter analytics. */
export function regionGeohash5(lat: number, lng: number): string {
  return encodeGeohash(lat, lng, ANALYTICS_GEOHASH_PRECISION);
}

/** A geohash5 that came from outside (e.g. a Pesca Certa link): lower case, 5 valid chars, or ''. */
export function sanitizeGeohash5(value: string | null | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  return /^[0-9b-hjkmnp-z]{5}$/.test(v) ? v : '';
}
