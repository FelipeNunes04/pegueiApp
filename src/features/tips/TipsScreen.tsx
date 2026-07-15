import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../shared/theme/colors';
import { typography } from '../../shared/theme/typography';

interface Tip {
  key: string;
  title: string;
  body: string;
}

const TIPS: Tip[] = [
  {
    key: 'app',
    title: 'Deixe o app rodando',
    body: 'O Peguei já grava em segundo plano assim que a câmera abre -- não precisa apertar nada antes de o momento acontecer.',
  },
  {
    key: 'battery',
    title: 'Leve uma bateria extra',
    body: 'Gravação contínua consome mais bateria que uma câmera parada. Em pescarias ou trilhas longas, uma power bank resolve.',
  },
  {
    key: 'storage',
    title: 'De olho no armazenamento',
    body: 'Clipes em 4K ocupam mais espaço. Se o celular estiver cheio, baixe a qualidade de vídeo nas configurações.',
  },
];

export function TipsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="tips-screen">
      <Text style={styles.intro}>
        Dicas rápidas pra aproveitar melhor o Peguei.
      </Text>
      {TIPS.map(tip => (
        <View key={tip.key} style={styles.card} testID={`tip-${tip.key}`}>
          <Text style={styles.title}>{tip.title}</Text>
          <Text style={styles.body}>{tip.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  intro: { ...typography.body, color: 'rgba(242,245,245,0.7)', marginBottom: 20, lineHeight: 20 },
  card: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { ...typography.bodyStrong, color: colors.textDark, marginBottom: 4 },
  body: { ...typography.body, color: 'rgba(242,245,245,0.75)', lineHeight: 20 },
});
