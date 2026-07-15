import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { GalleryPlaceholderIcon } from '../../../shared/components/icons';
import { colors } from '../../../shared/theme/colors';
import { styles } from './GalleryEmptyState.styles';

interface Props {
  onBackToCamera: () => void;
}

export function GalleryEmptyState({ onBackToCamera }: Props) {
  return (
    <View style={styles.container} testID="gallery-empty">
      <View style={styles.iconWrapper}>
        <GalleryPlaceholderIcon size={48} color={colors.primaryLight} />
      </View>
      <Text style={styles.title}>Nenhum clipe salvo ainda</Text>
      <Text style={styles.subtitle}>
        Toque no botão da câmera para começar a gravar. O clipe salvo já vem com
        os segundos anteriores ao toque.
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="gallery-empty-cta"
        onPress={onBackToCamera}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
      >
        <Text style={styles.ctaText}>Voltar para a câmera</Text>
      </Pressable>
    </View>
  );
}
