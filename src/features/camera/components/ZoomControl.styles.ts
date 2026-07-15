import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(10,20,20,0.55)',
    borderRadius: 20,
    padding: 4,
    marginBottom: 16,
  },
  pill: {
    minWidth: 36,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pillActive: { backgroundColor: colors.accent },
  label: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  labelActive: { color: colors.textLight, fontWeight: '700' },
});
