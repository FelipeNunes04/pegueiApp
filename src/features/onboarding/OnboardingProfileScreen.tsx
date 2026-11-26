import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { UFS, track, type Estado, type TipoPesca } from '../../analytics';
import { useProfileStore } from './store/profileStore';
import type { RootStackParamList } from '../../shared/types';
import { styles } from './OnboardingProfileScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'OnboardingProfile'>;

const TIPO_OPTIONS: Array<{ value: Exclude<TipoPesca, 'nao_informado'>; label: string }> = [
  { value: 'rio', label: 'Rio' },
  { value: 'represa_acude', label: 'Represa ou açude' },
  { value: 'mar', label: 'Mar' },
  { value: 'pesqueiro', label: 'Pesqueiro' },
  { value: 'varios', label: 'Um pouco de tudo' },
];

/** Optional last onboarding step: kind of fishing and state. "Pular" skips it. */
export function OnboardingProfileScreen({ navigation }: Props) {
  const saveProfile = useProfileStore(s => s.saveProfile);
  const [tipo, setTipo] = useState<TipoPesca>('nao_informado');
  const [estado, setEstado] = useState<Estado>('nao_informado');

  const finish = (answered: boolean) => {
    const profile = answered ? { tipoPesca: tipo, estado } : { tipoPesca: 'nao_informado' as const, estado: 'nao_informado' as const };
    saveProfile(profile);
    track('onboarding_completed', { tipo_pesca: profile.tipoPesca, estado: profile.estado });
    navigation.replace('Permissions');
  };

  return (
    <View style={styles.container} testID="onboarding-profile-screen">
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Pressable
          style={styles.skip}
          onPress={() => finish(false)}
          accessibilityRole="button"
          testID="onboarding-profile-skip"
          hitSlop={8}
        >
          <Text style={styles.skipText}>Pular</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Como você pesca?</Text>
          <Text style={styles.body}>
            Opcional. Ajuda a gente a entender quem usa o Peguei. Não pedimos sua
            localização.
          </Text>

          <Text style={styles.section}>Onde você mais pesca</Text>
          <View style={styles.row}>
            {TIPO_OPTIONS.map(option => (
              <Text
                key={option.value}
                testID={`profile-tipo-${option.value}`}
                onPress={() => setTipo(current => (current === option.value ? 'nao_informado' : option.value))}
                accessibilityRole="button"
                accessibilityState={{ selected: tipo === option.value }}
                style={[styles.pill, tipo === option.value && styles.pillActive]}
              >
                {option.label}
              </Text>
            ))}
          </View>

          <Text style={styles.section}>Seu estado</Text>
          <View style={styles.row}>
            {UFS.map(uf => (
              <Text
                key={uf}
                testID={`profile-uf-${uf}`}
                onPress={() => setEstado(current => (current === uf ? 'nao_informado' : uf))}
                accessibilityRole="button"
                accessibilityState={{ selected: estado === uf }}
                style={[styles.pill, styles.ufPill, estado === uf && styles.pillActive]}
              >
                {uf}
              </Text>
            ))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={styles.nextButton}
            onPress={() => finish(true)}
            accessibilityRole="button"
            testID="onboarding-profile-done"
          >
            <Text style={styles.nextLabel}>Continuar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
