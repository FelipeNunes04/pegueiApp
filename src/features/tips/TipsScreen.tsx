import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { styles } from './TipsScreen.styles';

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="tips-screen"
    >
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
