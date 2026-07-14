import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShareIcon, TrashIcon } from './icons';
import { colors } from '../theme/colors';

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
    <SafeAreaView edges={['bottom']} style={styles.container} testID="selection-toolbar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compartilhar selecionados"
        testID="selection-share"
        disabled={disabled}
        onPress={onShare}
        style={[styles.action, disabled && styles.disabled]}>
        <ShareIcon />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Excluir selecionados"
        testID="selection-delete"
        disabled={disabled}
        onPress={onDelete}
        style={[styles.action, disabled && styles.disabled]}>
        <TrashIcon color={colors.error} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
