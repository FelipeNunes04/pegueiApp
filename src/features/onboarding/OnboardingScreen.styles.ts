import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  safeArea: { flex: 1 },
  skip: { position: 'absolute', top: 8, right: 16, zIndex: 1, padding: 12 },
  skipText: { ...typography.body, color: 'rgba(242,245,245,0.6)' },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { ...typography.display, color: colors.textDark, textAlign: 'center', marginTop: 32, marginBottom: 12 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', textAlign: 'center', lineHeight: 22 },
  footer: { paddingHorizontal: 24, paddingBottom: 16, alignItems: 'center' },
  dots: { flexDirection: 'row', marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 4 },
  dotActive: { backgroundColor: colors.accent, width: 20 },
  nextButton: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  nextLabel: { ...typography.bodyStrong, color: colors.textLight },
});
