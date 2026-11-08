import React from 'react';
import { Pressable, Text } from 'react-native';
import type { BufferHealth, RecordingPhase } from '../../../shared/types';
import { PHASE_LABEL, visibleHealthLabel } from '../utils/bufferStatus';
import { styles } from './PocketModeOverlay.styles';

interface Props {
  phase: RecordingPhase;
  health: BufferHealth;
  onExit: () => void;
}

/**
 * Full-screen pure-black cover for pocket mode (see usePocketMode). Pure
 * black so OLED panels switch those pixels off entirely; the only content
 * is one very dim, static status line -- no animation, no ticking timer --
 * so the user glancing at the pocket can still tell the buffer is alive
 * without the overlay itself costing re-renders. A single tap anywhere
 * exits.
 */
export function PocketModeOverlay({ phase, health, onExit }: Props) {
  const healthLabel = visibleHealthLabel(phase, health);
  const status = healthLabel ? `${PHASE_LABEL[phase]} · ${healthLabel}` : PHASE_LABEL[phase];

  return (
    <Pressable
      style={styles.overlay}
      onPress={onExit}
      accessibilityRole="button"
      accessibilityLabel={`Modo bolso ativo, ${status}. Toque para sair.`}
      accessibilityViewIsModal
      testID="pocket-mode-overlay"
    >
      <Text style={styles.status} testID="pocket-mode-status">
        {status}
      </Text>
      <Text style={styles.hint}>Toque para sair</Text>
    </Pressable>
  );
}
