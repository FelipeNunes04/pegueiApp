import type { PermissionKey, VideoFps, VideoQuality } from '../shared/types';

export type { VideoFps, VideoQuality };

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

/** Same 4 values as Pesca Certa. */
export type Connection = 'wifi' | 'cell' | 'offline' | 'unknown';

/** Thermal pressure, on iOS's 4-step scale (Android's 7 steps are mapped onto it natively). */
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

/** Why a fishing session ended. `crash` and `background` are found on the next launch. */
export type MotivoFim = 'usuario' | 'bateria' | 'termico' | 'armazenamento' | 'crash' | 'background';

/** Free storage, in GB buckets: `<1`, `1-2`, `2-5`, `5-10`, `10-30`, `30+`. `nao_enviado` on iOS (see docs/privacidade.md). */
export type StorageBucket = '<1' | '1-2' | '2-5' | '5-10' | '10-30' | '30+' | 'nao_enviado' | 'desconhecido';

/** Export format: the clip as recorded or the vertical 9:16 copy. */
export type Formato = 'original' | '9_16';

/** Permissions the app asks for (`fotos` is asked by the share sheet, not by the app). */
export type PermissionName = 'camera' | 'mic' | 'fotos';

/** Pesca Certa's species keys (the deep link and `catch_sent_to_pesca_certa` use them). */
export type EspeciePescaCerta =
  | 'tucunare'
  | 'traira'
  | 'tilapia'
  | 'tambaqui'
  | 'dourado'
  | 'curimata'
  | 'piau'
  | 'pescada_piaui'
  | 'pacu'
  | 'mandi'
  | 'piranha'
  | 'outra';

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
  /**
   * `quantidade` > 1 when several clips are shared at once from the gallery.
   * `formato`, `marca_dagua` and `sponsor_id` came in 1.3.0.
   */
  video_shared: {
    destino: ShareDestino;
    quantidade: number;
    formato: Formato;
    marca_dagua: boolean;
    sponsor_id: string;
  };
  sponsor_impression: { sponsor_id: string; posicao: SponsorPosicao };
  review_prompt_shown: NoProps;

  // Fishing session: from the first buffer start to the buffer staying off
  // for 10 min (see src/analytics/fishingSession.ts).
  fishing_session_started: {
    buffer_s: number;
    lente: Lente;
    resolucao: VideoQuality;
    fps: VideoFps;
    /** 0-100, -1 when unknown. */
    battery_pct: number;
    thermal_state: ThermalState;
    storage_free_gb_bucket: StorageBucket;
  };
  fishing_session_ended: {
    duracao_min: number;
    capturas: number;
    /** Battery at start minus battery at the end, -1 when unknown. Negative values are clamped to 0 (charging). */
    battery_drop_pct: number;
    max_thermal_state: ThermalState;
    motivo_fim: MotivoFim;
  };
  /** Every 5 min at most, while the buffer runs. */
  buffer_health_sampled: { dropped_frames_pct: number; memoria_mb: number; thermal_state: ThermalState };
  app_backgrounded_during_buffer: { duracao_s: number };

  // Capture
  capture_latency_measured: { toque_ate_salvo_ms: number; buffer_s: number; resolucao: VideoQuality };
  capture_discarded: { motivo: 'erro_salvar' | 'encerrada_sem_salvar' | 'excluido_na_previa' };
  /** Declared for the trim screen; the app has no trim yet, so it is not sent today. */
  video_trimmed: { duracao_original_s: number; duracao_final_s: number };
  video_deleted: { idade_dias: number };
  gallery_opened: { total_videos: number };
  video_played: { duracao_s: number; completou: boolean };

  // Share and reach (media kit)
  share_sheet_opened: { formato: Formato; marca_dagua: boolean; overlay: boolean };
  share_card_template_used: { template: 'cartao_especie' | 'cartao_especie_patrocinado' };

  // Problems that make users leave
  permission_result: { permission: PermissionName; granted: boolean; prompt_count: number };
  /** Android only: on iOS the free space may not leave the phone (Apple's disk space API rule). */
  storage_low_warning_shown: { storage_free_gb: number };
  camera_init_failed: { erro: string; lente: Lente };
  export_failed: { erro: string; etapa: 'marca' | 'export' | 'compartilhar' };

  // Ecosystem
  pesca_certa_cta_viewed: { contexto: string };
  pesca_certa_cta_clicked: { contexto: string };
  opened_from_pesca_certa: { contexto: string };
  catch_sent_to_pesca_certa: { especie: EspeciePescaCerta };

  // Monetization
  sponsor_clicked: { sponsor_id: string; posicao: SponsorPosicao };
  /** Declared for the future "equipamento do vídeo" screen; not sent today. */
  affiliate_link_clicked: { produto_id: string; contexto: string };

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
  fishing_session_started: true,
  fishing_session_ended: true,
  buffer_health_sampled: true,
  app_backgrounded_during_buffer: true,
  capture_latency_measured: true,
  capture_discarded: true,
  video_trimmed: true,
  video_deleted: true,
  gallery_opened: true,
  video_played: true,
  share_sheet_opened: true,
  share_card_template_used: true,
  permission_result: true,
  storage_low_warning_shown: true,
  camera_init_failed: true,
  export_failed: true,
  pesca_certa_cta_viewed: true,
  pesca_certa_cta_clicked: true,
  opened_from_pesca_certa: true,
  catch_sent_to_pesca_certa: true,
  sponsor_clicked: true,
  affiliate_link_clicked: true,
  clip_deleted: true,
  onboarding_skipped: true,
  permission_denied: true,
  donation_pix_copied: true,
};

/** Runtime check for names that arrive untyped (from native code). */
export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(EVENT_NAMES, name);
}

/** Saved videos, in buckets: `0`, `1`, `2-5`, `6-20`, `21-50`, `51+`. */
export type VideosBucket = '0' | '1' | '2-5' | '6-20' | '21-50' | '51+';

/** User properties, the same convention as Pesca Certa. Values are always strings (Firebase rule). */
export interface UserProperties {
  uf: Estado;
  tipo_pesca: TipoPesca;
  buffer_s_preferido: string;
  lente_preferida: Lente;
  /** `sim` once Pesca Certa opened Peguei or Peguei opened Pesca Certa. Never set to `nao` from a guess. */
  has_pesca_certa: 'sim';
  /** `organico`, `pesca_certa`, a utm_source, or `deeplink`. Set on the first open only. */
  install_source: string;
  /** ISO week of the first open, e.g. `2026-W48`. */
  cohort_week: string;
  videos_saved_bucket: VideosBucket;
  storage_free_bucket: StorageBucket;
}
