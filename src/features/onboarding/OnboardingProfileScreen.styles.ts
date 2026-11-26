import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24 },
  skip: { position: 'absolute', top: 8, right: 16, zIndex: 1, padding: 12 },
  skipText: { ...typography.body, color: 'rgba(242,245,245,0.6)' },
  title: { ...typography.display, color: colors.textDark, marginBottom: 8 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', lineHeight: 22 },
  section: { ...typography.bodyStrong, color: colors.textDark, marginTop: 28, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: {
    ...typography.body,
    color: colors.textDark,
    backgroundColor: colors.surfaceDark,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginRight: 8,
    overflow: 'hidden',
  },
  pillActive: { backgroundColor: colors.accent, color: colors.textLight },
  ufPill: { minWidth: 52, textAlign: 'center', paddingHorizontal: 8 },
  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  nextButton: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  nextLabel: { ...typography.bodyStrong, color: colors.textLight },
});
