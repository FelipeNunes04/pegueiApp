import React from 'react';
import { Pressable, Text } from 'react-native';
import { typography } from '../../../shared/theme/typography';
import { styles } from './PermissionActionButton.styles';

interface Props {
  label: string;
  disabledLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/** Generic labeled action button for the permissions flow — deliberately not RecordButton, which is capture-specific icon-only UI. */
export function PermissionActionButton({
  label,
  disabledLabel,
  onPress,
  disabled,
  testID,
}: Props) {
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
      ]}
    >
      <Text
        style={[
          typography.bodyStrong,
          styles.label,
          disabled && styles.labelDisabled,
        ]}
      >
        {disabled ? disabledLabel : label}
      </Text>
    </Pressable>
  );
}
