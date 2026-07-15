import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceDark, margin: 1, overflow: 'hidden' },
  placeholder: { backgroundColor: colors.surfaceDark },
  originBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(10,20,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(10,20,20,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: { ...typography.caption, color: '#fff', fontSize: 11 },
  checkboxWrapper: { position: 'absolute', top: 6, right: 6 },
});
