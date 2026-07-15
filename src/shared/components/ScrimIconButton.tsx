import React from 'react';
import { Pressable, View } from 'react-native';
import { styles } from './ScrimIconButton.styles';

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  size?: number;
  children: React.ReactNode;
}

/**
 * Circular semi-transparent "scrim" background behind a single icon, used to
 * keep top-bar controls legible over a live camera preview regardless of
 * what's behind them — the scrim (not a blur, see BRAND.md/DECISIONS.md) is
 * the actual WCAG AA contrast mechanism here.
 */
export function ScrimIconButton({
  onPress,
  accessibilityLabel,
  testID,
  size = 40,
  children,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scrim,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconWrapper}>{children}</View>
    </Pressable>
  );
}
