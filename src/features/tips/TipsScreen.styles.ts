import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  intro: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 20, lineHeight: 20 },
  card: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { ...typography.bodyStrong, color: colors.textDark, marginBottom: 4 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', lineHeight: 20 },
});
