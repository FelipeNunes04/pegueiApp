import { StyleSheet } from 'react-native';
import { typography } from '../../../shared/theme/typography';

export const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'black',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 48,
  },
  // Deliberately barely visible: readable when looked at directly in a dark
  // pocket/at arm's length, but not a light source.
  status: { ...typography.caption, color: 'rgba(255,255,255,0.22)' },
  hint: { ...typography.caption, fontSize: 10, color: 'rgba(255,255,255,0.14)', marginTop: 4 },
});
