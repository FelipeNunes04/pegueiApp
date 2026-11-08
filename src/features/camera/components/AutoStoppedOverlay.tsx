import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles } from './AutoStoppedOverlay.styles';

interface Props {
  minutes: number;
  onResume: () => void;
}

function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} minutos`;
}

/**
 * Shown after "Desligar buffer após inatividade" stopped the buffer. Covers
 * the (now frozen) preview and the record button on purpose: nothing is
 * being kept anymore, so a normal-looking camera UI would be lying -- the
 * only meaningful action left is "Retomar".
 */
export function AutoStoppedOverlay({ minutes, onResume }: Props) {
  return (
    <View style={styles.overlay} testID="auto-stopped-overlay">
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          Buffer desligado
        </Text>
        <Text style={styles.body}>
          O Peguei parou de gravar após {formatMinutes(minutes)} sem uso, para
          poupar bateria. Nada está sendo guardado agora.
        </Text>
        <Pressable
          onPress={onResume}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Retomar gravação contínua"
          testID="resume-buffer"
        >
          <Text style={styles.buttonLabel}>Retomar</Text>
        </Pressable>
      </View>
    </View>
  );
}
