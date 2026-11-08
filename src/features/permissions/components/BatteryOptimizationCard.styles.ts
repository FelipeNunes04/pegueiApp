import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

// Mirrors PermissionsScreen's permission cards so it reads as one more item
// in the same list there, and as a regular settings block in SettingsScreen.
export const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceDark, borderRadius: 12, padding: 16, marginBottom: 16 },
  title: { ...typography.title, fontSize: 16, color: colors.textDark, marginBottom: 4 },
  description: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 8 },
  status: { ...typography.caption, color: colors.success, marginBottom: 12 },
  statusWarning: { color: colors.accent },
});
