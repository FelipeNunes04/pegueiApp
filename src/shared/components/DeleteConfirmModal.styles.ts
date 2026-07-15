import { StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

export const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surfaceDark, borderRadius: 16, padding: 20 },
  title: { ...typography.title, color: colors.textDark, marginBottom: 8 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', marginBottom: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  button: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  pressed: { opacity: 0.75 },
  cancelText: { ...typography.bodyStrong, color: colors.textDark },
  destructiveButton: { backgroundColor: colors.error, marginLeft: 8 },
  destructiveText: { ...typography.bodyStrong, color: '#fff' },
});
