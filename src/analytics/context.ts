import { sanitizeGeohash5 } from './geohash';
import type { Connection, Estado } from './events';

/**
 * Context that goes into every event as a common param, the same as Pesca
 * Certa: `uf`, `region_geohash5` and `connection` at the time of the event.
 *
 * Peguei does not ask for location. `uf` is the state picked in onboarding;
 * `region_geohash5` is only known when Pesca Certa passes one in its link
 * (never an exact coordinate, see geohash.ts). Empty values are left out of
 * the event instead of being sent as "".
 */

export interface AnalyticsContext {
  region_geohash5: string;
  uf: string;
  connection: Connection;
}

const context: AnalyticsContext = { region_geohash5: '', uf: '', connection: 'unknown' };

const CONNECTIONS: readonly Connection[] = ['wifi', 'cell', 'offline', 'unknown'];

export function toConnection(value: unknown): Connection {
  return typeof value === 'string' && (CONNECTIONS as readonly string[]).includes(value) ? (value as Connection) : 'unknown';
}

export function getAnalyticsContext(): AnalyticsContext {
  return { ...context };
}

export function setAnalyticsUf(uf: Estado | null | undefined): void {
  context.uf = uf && uf !== 'nao_informado' ? uf : '';
}

/** Only a valid geohash5 is kept; anything else clears the region. */
export function setAnalyticsRegion(geohash5: string | null | undefined): void {
  context.region_geohash5 = sanitizeGeohash5(geohash5);
}

export function setAnalyticsConnection(connection: Connection): void {
  context.connection = connection;
}

/** Tests only. */
export function resetAnalyticsContextForTests(): void {
  context.region_geohash5 = '';
  context.uf = '';
  context.connection = 'unknown';
}
