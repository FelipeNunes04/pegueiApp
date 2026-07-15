import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';

export const styles = StyleSheet.create({
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
