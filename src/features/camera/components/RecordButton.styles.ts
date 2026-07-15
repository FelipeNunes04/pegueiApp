import { StyleSheet } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { typography } from '../../../shared/theme/typography';

const SIZE = 84;

export const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  iconWrapper: { alignItems: 'center', justifyContent: 'center' },
  recordIcon: { width: 56, height: 56, borderRadius: 28 },
  recordingIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.error },
  timer: { ...typography.caption, color: 'white', marginTop: 8 },
});
