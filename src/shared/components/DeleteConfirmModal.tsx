import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { styles } from './DeleteConfirmModal.styles';

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
export function DeleteConfirmModal({
  visible,
  count,
  onCancel,
  onConfirm,
}: Props) {
  const title = count === 1 ? 'Excluir vídeo?' : `Excluir ${count} vídeos?`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="delete-confirm-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>Essa ação não pode ser desfeita.</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              testID="delete-confirm-cancel"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="delete-confirm-delete"
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                styles.destructiveButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.destructiveText}>Excluir</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
