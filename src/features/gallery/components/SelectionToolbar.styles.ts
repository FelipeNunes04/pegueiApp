import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceDark,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingTop: 12,
  },
  // 22px icon + 11px padding on all sides = 44pt tap target (Apple HIG / Material minimum).
  action: { padding: 11 },
  disabled: { opacity: 0.35 },
});
