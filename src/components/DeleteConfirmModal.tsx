import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

interface Props {
  visible: boolean;
  /** Number of clips this confirmation would delete -- singular vs. plural copy. */
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Blocking confirmation required before any delete (single clip from the
 * preview screen, or a batch from gallery multi-select) -- see the
 * Definition of Done requirement that a delete can never happen without
 * this. There is exactly one instance of this component; both delete
 * entry points render the same modal rather than each rolling their own.
 */
export function DeleteConfirmModal({ visible, count, onCancel, onConfirm }: Props) {
  const title = count === 1 ? 'Excluir vídeo?' : `Excluir ${count} vídeos?`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} testID="delete-confirm-modal">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>Essa ação não pode ser desfeita.</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              testID="delete-confirm-cancel"
              onPress={onCancel}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="delete-confirm-delete"
              onPress={onConfirm}
              style={({ pressed }) => [styles.button, styles.destructiveButton, pressed && styles.pressed]}>
              <Text style={styles.destructiveText}>Excluir</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
