import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePermissions } from './hooks/usePermissions';
import type {
  PermissionKey,
  PermissionStatus,
  RootStackParamList,
} from '../../shared/types';
import { PermissionActionButton } from './components/PermissionActionButton';
import { styles } from './PermissionsScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Permissions'>;

const EXPLANATIONS: Record<
  PermissionKey,
  { title: string; description: string }
> = {
  camera: {
    title: 'Câmera',
    description:
      'Usada para gravar continuamente os últimos segundos e mostrar a imagem ao vivo.',
  },
  storage: {
    title: 'Armazenamento / Fotos',
    description:
      'Usado para salvar os clipes finais na galeria do seu dispositivo.',
  },
  microphone: {
    title: 'Microfone',
    description: 'Usado para gravar o áudio dos clipes.',
  },
};

// PermissionStatus values are internal state, not copy -- translate before
// showing them, or a Portuguese screen ends up displaying "Status: denied".
const STATUS_LABEL: Record<PermissionStatus, string> = {
  granted: 'Permitida',
  blocked: 'Bloqueada nas configurações do sistema',
  denied: 'Ainda não concedida',
  unknown: 'Verificando...',
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="permissions-screen"
    >
      <Text style={styles.title}>Antes de começar</Text>
      <Text style={styles.subtitle}>
        O Peguei precisa de três permissões. Explicamos cada uma antes de pedir.
      </Text>
      {ORDER.map(key => (
        <View key={key} style={styles.card} testID={`permission-card-${key}`}>
          <Text style={styles.cardTitle}>{EXPLANATIONS[key].title}</Text>
          <Text style={styles.cardDescription}>
            {EXPLANATIONS[key].description}
          </Text>
          <Text style={styles.status}>{STATUS_LABEL[statuses[key]]}</Text>
          <PermissionActionButton
            testID={`permission-action-${key}`}
            label="Continuar"
            disabledLabel="Concedido"
            onPress={() => requestPermission(key)}
            disabled={statuses[key] === 'granted'}
          />
        </View>
      ))}
      {!allGranted && (
        <Text style={styles.hint}>
          Se uma permissão foi bloqueada permanentemente, abra as configurações
          do sistema para este app.
        </Text>
      )}
    </ScrollView>
  );
}
