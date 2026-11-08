import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,20,20,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  title: { ...typography.title, color: colors.textDark, marginBottom: 8 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', marginBottom: 20 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.8 },
  buttonLabel: { ...typography.bodyStrong, color: colors.textLight },
});
