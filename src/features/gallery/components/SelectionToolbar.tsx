import React from 'react';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShareIcon, TrashIcon } from '../../../shared/components/icons';
import { colors } from '../../../shared/theme/colors';
import { styles } from './SelectionToolbar.styles';

interface Props {
  count: number;
  onShare: () => void;
  onDelete: () => void;
}

/**
 * Bottom action bar (icons only) shown while the gallery is in multi-select
 * mode -- the "X selecionados" counter itself lives in the screen's top
 * header (see GalleryScreen's navigation.setOptions), matching where native
 * gallery apps (Photos, Google Photos) put it.
 */
export function SelectionToolbar({ count, onShare, onDelete }: Props) {
  const disabled = count === 0;

  return (
    <SafeAreaView
      edges={['bottom']}
      style={styles.container}
      testID="selection-toolbar"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compartilhar selecionados"
        testID="selection-share"
        disabled={disabled}
        onPress={onShare}
        style={[styles.action, disabled && styles.disabled]}
      >
        <ShareIcon />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Excluir selecionados"
        testID="selection-delete"
        disabled={disabled}
        onPress={onDelete}
        style={[styles.action, disabled && styles.disabled]}
      >
        <TrashIcon color={colors.error} />
      </Pressable>
    </SafeAreaView>
  );
}
