import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePermissions } from '../hooks/usePermissions';
import type { PermissionKey, RootStackParamList } from '../types';
import { PermissionActionButton } from '../components/PermissionActionButton';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'Permissions'>;

const EXPLANATIONS: Record<PermissionKey, { title: string; description: string }> = {
  camera: {
    title: 'Câmera',
    description: 'Usada para gravar continuamente o buffer de vídeo e exibir o preview ao vivo.',
  },
  storage: {
    title: 'Armazenamento / Fotos',
    description: 'Usado para salvar os clipes finais na galeria do seu dispositivo.',
  },
  microphone: {
    title: 'Microfone',
    description: 'Usado para gravar o áudio dos clipes.',
  },
};

const ORDER: PermissionKey[] = ['camera', 'storage', 'microphone'];

export function PermissionsScreen({ navigation }: Props) {
  const { statuses, requestPermission, allGranted } = usePermissions();

  React.useEffect(() => {
    if (allGranted) {
      navigation.replace('Camera');
    }
  }, [allGranted, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="permissions-screen">
      <Text style={styles.title}>Antes de começar</Text>
      <Text style={styles.subtitle}>
        O Peguei precisa de três permissões. Explicamos cada uma antes de pedir.
      </Text>
      {ORDER.map(key => (
        <View key={key} style={styles.card} testID={`permission-card-${key}`}>
          <Text style={styles.cardTitle}>{EXPLANATIONS[key].title}</Text>
          <Text style={styles.cardDescription}>{EXPLANATIONS[key].description}</Text>
          <Text style={styles.status}>Status: {statuses[key]}</Text>
          <PermissionActionButton
            testID={`permission-action-${key}`}
            label="Permitir acesso"
            disabledLabel="Concedido"
            onPress={() => requestPermission(key)}
            disabled={statuses[key] === 'granted'}
          />
        </View>
      ))}
      {!allGranted && (
        <Text style={styles.hint}>
          Se uma permissão foi bloqueada permanentemente, abra as configurações do sistema para este app.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  title: { ...typography.display, fontSize: 24, color: colors.textDark, marginBottom: 8 },
  subtitle: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 20 },
  card: { backgroundColor: colors.surfaceDark, borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { ...typography.title, fontSize: 16, color: colors.textDark, marginBottom: 4 },
  cardDescription: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 8 },
  status: { ...typography.caption, color: colors.success, marginBottom: 12 },
  hint: { ...typography.caption, color: 'rgba(242,245,245,0.5)', marginTop: 8 },
});
