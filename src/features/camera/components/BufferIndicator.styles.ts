import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,20,20,0.55)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  label: { ...typography.caption, color: colors.textDark, lineHeight: 14 },
  subLabel: { ...typography.caption, color: 'rgba(242,245,245,0.7)', fontSize: 10, lineHeight: 12 },
});
