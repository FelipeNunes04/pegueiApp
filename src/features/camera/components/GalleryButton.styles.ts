import { StyleSheet } from 'react-native';

const SIZE = 44;

export const styles = StyleSheet.create({
  wrapper: {
    width: SIZE,
    height: SIZE,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: 'rgba(10,20,20,0.55)', alignItems: 'center', justifyContent: 'center' },
});
