import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  title: { ...typography.display, fontSize: 24, color: colors.textDark, marginBottom: 8 },
  subtitle: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 20 },
  card: { backgroundColor: colors.surfaceDark, borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { ...typography.title, fontSize: 16, color: colors.textDark, marginBottom: 4 },
  cardDescription: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 8 },
  status: { ...typography.caption, color: colors.success, marginBottom: 12 },
  hint: { ...typography.caption, color: 'rgba(242,245,245,0.5)', marginTop: 8 },
});
