import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

interface Props {
  label: string;
  disabledLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/** Generic labeled action button for the permissions flow — deliberately not RecordButton, which is capture-specific icon-only UI. */
export function PermissionActionButton({ label, disabledLabel, onPress, disabled, testID }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? disabledLabel : label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={[typography.bodyStrong, styles.label, disabled && styles.labelDisabled]}>
        {disabled ? disabledLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  buttonDisabled: { backgroundColor: 'rgba(255,255,255,0.12)' },
  pressed: { opacity: 0.8 },
  label: { color: colors.textLight },
  labelDisabled: { color: 'rgba(255,255,255,0.5)' },
});
