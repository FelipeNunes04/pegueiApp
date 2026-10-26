import type { BufferHealth, RecordingPhase } from '../../../shared/types';

/** Shared by BufferIndicator and PocketModeOverlay so both describe the buffer with the same words. */
export const PHASE_LABEL: Record<RecordingPhase, string> = {
  idle: 'Parado',
  buffering: 'Sempre gravando',
  recording: 'Gravando',
  saving: 'Salvando...',
  error: 'Erro',
};

/** null = healthy, nothing worth saying. */
export const HEALTH_LABEL: Record<BufferHealth, string | null> = {
  healthy: null,
  recovering: 'Recuperando…',
  interrupted: 'Interrompido',
  throttled: 'Reduzido (calor)',
};

/**
 * Health only means something while the native pipeline is supposed to be
 * running -- a stale 'interrupted' from before a stop() shouldn't decorate
 * the "Parado"/"Erro" states.
 */
export function visibleHealthLabel(phase: RecordingPhase, health: BufferHealth): string | null {
  if (phase !== 'buffering' && phase !== 'recording' && phase !== 'saving') {
    return null;
  }
  return HEALTH_LABEL[health];
}
