import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import type { RecordingPhase } from '../../../shared/types';
import { styles } from './BufferIndicator.styles';

interface Props {
  phase: RecordingPhase;
  bufferSeconds: number;
}

const PHASE_LABEL: Record<RecordingPhase, string> = {
  idle: 'Parado',
  buffering: 'Sempre gravando',
  recording: 'Gravando',
  saving: 'Salvando...',
  error: 'Erro',
};

/** Compact top-left status badge (scrim + pulsing dot) — communicates "the last N seconds are always being kept" at a glance without a solid top bar. */
export function BufferIndicator({ phase, bufferSeconds }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== 'buffering') {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.25,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const dotColor = phase === 'error' ? colors.error : colors.success;

  return (
    <View style={styles.container} testID="buffer-indicator">
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: dotColor, transform: [{ scale: pulse }] },
        ]}
        testID="buffer-indicator-ring"
      />
      <View>
        <Text style={styles.label}>{PHASE_LABEL[phase]}</Text>
        <Text style={styles.subLabel}>{bufferSeconds}s</Text>
      </View>
    </View>
  );
}
