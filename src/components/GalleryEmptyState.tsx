import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GalleryPlaceholderIcon } from './icons';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

interface Props {
  onBackToCamera: () => void;
}

/** Friendly empty state shown instead of a blank list when there are no saved clips yet. */
export function GalleryEmptyState({ onBackToCamera }: Props) {
  return (
    <View style={styles.container} testID="gallery-empty">
      <View style={styles.iconWrapper}>
        <GalleryPlaceholderIcon size={48} color={colors.primaryLight} />
      </View>
      <Text style={styles.title}>Nenhum vídeo salvo ainda</Text>
      <Text style={styles.subtitle}>Seus vídeos salvos aparecem aqui.</Text>
      <Pressable
        accessibilityRole="button"
        testID="gallery-empty-cta"
        onPress={onBackToCamera}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
        <Text style={styles.ctaText}>Voltar para a câmera</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { ...typography.title, color: colors.textDark, textAlign: 'center' },
  subtitle: { ...typography.body, color: 'rgba(242,245,245,0.6)', textAlign: 'center', marginTop: 6 },
  cta: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, backgroundColor: colors.accent },
  pressed: { opacity: 0.8 },
  ctaText: { ...typography.bodyStrong, color: colors.textLight },
});
