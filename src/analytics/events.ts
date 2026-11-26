import type { PermissionKey, VideoFps, VideoQuality } from '../shared/types';

/**
 * Every analytics event the app may send, with its exact properties.
 * `track()` only accepts names from this map, and the props it takes are
 * the ones declared here -- an unknown event or a wrong property does not
 * compile. Names are snake_case, the same convention as Pesca Certa, so the
 * two apps' data can be crossed. See docs/analytics.md.
 */

/** Events with no properties. `Record<never, never>` (not `{}`) so `keyof` is `never`. */
export type NoProps = Record<never, never>;

/** Lens in use: below 1x zoom the ultra-wide (0.5x) lens is on. */
export type Lente = '0.5x' | '1x';

export type TipoPesca =
  | 'rio'
  | 'represa_acude'
  | 'mar'
  | 'pesqueiro'
  | 'varios'
  | 'nao_informado';

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type UF = (typeof UFS)[number];

/** State the user picked in onboarding, or `nao_informado` when skipped. */
export type Estado = UF | 'nao_informado';

/** Share destination, reduced to the apps that matter for the media kit. */
export type ShareDestino = 'whatsapp' | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'outro' | 'cancelado';

/** Corner of the exported video where the sponsor watermark is drawn. */
export type SponsorPosicao = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

export interface AnalyticsEventMap {
  app_opened: NoProps;
  onboarding_completed: { tipo_pesca: TipoPesca; estado: Estado };
  buffer_started: { buffer_s: number; lente: Lente };
  buffer_stopped: { duracao_min: number };
  capture_triggered: { buffer_s: number };
  capture_failed: { erro: string };
  video_saved: { duracao_s: number; resolucao: VideoQuality; fps: VideoFps; lente: Lente };
  overlay_added: { especie: string; tem_peso: boolean };
  video_exported: { marca_dagua: boolean; overlay: boolean; sponsor_id: string };
  /** `quantidade` > 1 when several clips are shared at once from the gallery. */
  video_shared: { destino: ShareDestino; quantidade: number };
  sponsor_impression: { sponsor_id: string; posicao: SponsorPosicao };
  review_prompt_shown: NoProps;

  // Kept from the first analytics version, so the existing history goes on.
  clip_deleted: { count: number };
  onboarding_skipped: NoProps;
  permission_denied: { permission: PermissionKey; status: 'denied' | 'blocked' };
  donation_pix_copied: NoProps;
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

/** The discriminated union of every event, `{ name, props }`. */
export type AnalyticsEvent = {
  [K in AnalyticsEventName]: { name: K; props: AnalyticsEventMap[K] };
}[AnalyticsEventName];

/** Events without props are called as `track('app_opened')`; the rest need their props. */
export type TrackArgs<E extends AnalyticsEventName> = keyof AnalyticsEventMap[E] extends never
  ? []
  : [props: AnalyticsEventMap[E]];

const EVENT_NAMES: Record<AnalyticsEventName, true> = {
  app_opened: true,
  onboarding_completed: true,
  buffer_started: true,
  buffer_stopped: true,
  capture_triggered: true,
  capture_failed: true,
  video_saved: true,
  overlay_added: true,
  video_exported: true,
  video_shared: true,
  sponsor_impression: true,
  review_prompt_shown: true,
  clip_deleted: true,
  onboarding_skipped: true,
  permission_denied: true,
  donation_pix_copied: true,
};

/** Runtime check for names that arrive untyped (from native code). */
export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(EVENT_NAMES, name);
}

/** User properties, shared in spirit with Pesca Certa. Values are always strings (Firebase rule). */
export interface UserProperties {
  uf: Estado;
  tipo_pesca: TipoPesca;
  buffer_s_preferido: string;
  lente_preferida: Lente;
}
