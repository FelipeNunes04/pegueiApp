import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  section: { ...typography.title, fontSize: 16, color: colors.textDark, marginTop: 20, marginBottom: 4 },
  sectionHint: { ...typography.caption, color: 'rgba(242,245,245,0.6)', marginBottom: 12 },
  label: { ...typography.body, color: 'rgba(242,245,245,0.8)', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
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
  pixBox: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
  },
  pixLabel: { ...typography.caption, color: 'rgba(242,245,245,0.6)', marginBottom: 4 },
  pixKey: { ...typography.bodyStrong, color: colors.textDark, letterSpacing: 0.5 },
  pixCopyHint: { ...typography.caption, color: colors.accent, marginTop: 8 },
  tipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  tipsRowLabel: { ...typography.body, color: colors.textDark },
  tipsRowChevron: { ...typography.title, color: 'rgba(242,245,245,0.4)' },
});
