import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import type { BufferHealth, RecordingPhase } from '../../../shared/types';
import { PHASE_LABEL, visibleHealthLabel } from '../utils/bufferStatus';
import { styles } from './BufferIndicator.styles';

interface Props {
  phase: RecordingPhase;
  bufferSeconds: number;
  /** Native pipeline health (CircularBufferHealth). Defaults to healthy. */
  health?: BufferHealth;
  /**
   * True while pocket mode covers the screen -- the pulse is a JS-driven
   * Animated.loop, and keeping it ticking behind a black overlay would spend
   * battery on frames nobody sees.
   */
  paused?: boolean;
}

/** Compact top-left status badge (scrim + pulsing dot) — communicates "the last N seconds are always being kept" at a glance without a solid top bar. */
export function BufferIndicator({ phase, bufferSeconds, health = 'healthy', paused = false }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;
  const healthLabel = visibleHealthLabel(phase, health);

  // Pulsing means "all good, frames are flowing" -- so it also stops while
  // the pipeline reports anything but healthy.
  const shouldPulse = phase === 'buffering' && !paused && healthLabel === null;

  useEffect(() => {
    if (!shouldPulse) {
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
  }, [shouldPulse, pulse]);

  const dotColor =
    phase === 'error' || (healthLabel !== null && health === 'interrupted')
      ? colors.error
      : healthLabel !== null
      ? colors.accent
      : colors.success;
  const subLabel = healthLabel ? `${bufferSeconds}s · ${healthLabel}` : `${bufferSeconds}s`;

  return (
    <View
      style={styles.container}
      testID="buffer-indicator"
      accessible
      accessibilityLabel={`${PHASE_LABEL[phase]}, últimos ${bufferSeconds} segundos${
        healthLabel ? `. ${healthLabel}` : ''
      }`}
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: dotColor, transform: [{ scale: pulse }] },
        ]}
        testID="buffer-indicator-ring"
      />
      <View>
        <Text style={styles.label}>{PHASE_LABEL[phase]}</Text>
        <Text style={styles.subLabel} testID="buffer-indicator-sublabel">
          {subLabel}
        </Text>
      </View>
    </View>
  );
}
