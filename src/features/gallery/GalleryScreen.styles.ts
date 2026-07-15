import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  sectionHeader: { ...typography.bodyStrong, color: colors.textDark, paddingHorizontal: 8, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: 'row' },
  headerAction: { ...typography.bodyStrong, color: colors.accent, paddingHorizontal: 8 },
});
