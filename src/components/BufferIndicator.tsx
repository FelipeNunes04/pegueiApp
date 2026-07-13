import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import type { RecordingPhase } from '../types';

interface Props {
  phase: RecordingPhase;
  bufferSeconds: number;
}

const PHASE_LABEL: Record<RecordingPhase, string> = {
  idle: 'Parado',
  buffering: 'Ativo',
  recording: 'Gravando',
  saving: 'Salvando...',
  error: 'Erro',
};

/** Compact top-left status badge (scrim + pulsing dot) — communicates "buffer is always on" at a glance without a solid top bar. */
export function BufferIndicator({ phase, bufferSeconds }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== 'buffering') {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const dotColor = phase === 'error' ? colors.error : colors.success;

  return (
    <View style={styles.container} testID="buffer-indicator">
      <Animated.View
        style={[styles.dot, { backgroundColor: dotColor, transform: [{ scale: pulse }] }]}
        testID="buffer-indicator-ring"
      />
      <View>
        <Text style={styles.label}>{PHASE_LABEL[phase]}</Text>
        <Text style={styles.subLabel}>{bufferSeconds}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,20,20,0.55)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  label: { ...typography.caption, color: colors.textDark, lineHeight: 14 },
  subLabel: { ...typography.caption, color: 'rgba(242,245,245,0.7)', fontSize: 10, lineHeight: 12 },
});
