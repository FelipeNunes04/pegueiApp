import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { ...typography.title, color: colors.textDark, textAlign: 'center' },
  subtitle: { ...typography.body, color: 'rgba(242,245,245,0.6)', textAlign: 'center', marginTop: 6 },
  cta: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, backgroundColor: colors.accent },
  pressed: { opacity: 0.8 },
  ctaText: { ...typography.bodyStrong, color: colors.textLight },
});
