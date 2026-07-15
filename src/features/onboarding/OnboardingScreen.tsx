import React, { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useOnboardingStore } from './store/onboardingStore';
import {
  BufferIllustration,
  TapIllustration,
  VersatilityIllustration,
  WelcomeIllustration,
} from './OnboardingIllustrations';
import {
  logOnboardingCompleted,
  logOnboardingSkipped,
} from '../../shared/utils/analytics';
import type { RootStackParamList } from '../../shared/types';
import { styles } from './OnboardingScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

interface Slide {
  key: string;
  title: string;
  body: string;
  Illustration: React.ComponentType;
}

const SLIDES: Slide[] = [
  {
    key: 'buffer',
    title: 'Nunca mais perca o momento',
    body: 'Assim que você abre a câmera, o Peguei já está gravando em segundo plano, guardando só os últimos segundos. Quando rolar aquele momento, o que já tinha acontecido também vai pro clipe salvo.',
    Illustration: BufferIllustration,
  },
  {
    key: 'tap',
    title: 'Toque para gravar, toque para parar',
    body: 'Sem gravar do zero e sem correr contra o tempo: um toque começa a gravar e já traz junto o que tinha acontecido antes. Toque de novo quando quiser parar — o clipe salvo sempre começa antes do primeiro toque.',
    Illustration: TapIllustration,
  },
  {
    key: 'versatility',
    title: 'Pesca ou qualquer esporte ao ar livre',
    body: 'Pensado pra pescaria, mas funciona pra qualquer momento rápido que você queira guardar — trilha, surf, skate, o que for.',
    Illustration: VersatilityIllustration,
  },
  {
    key: 'welcome',
    title: 'Tudo pronto',
    body: 'Só faltam três permissões rápidas pra começar. Boa pescaria — ou o que você for capturar por aí.',
    Illustration: WelcomeIllustration,
  },
];

export function OnboardingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const completeOnboarding = useOnboardingStore(s => s.completeOnboarding);

  const isLast = index === SLIDES.length - 1;

  const finish = (source: 'completed' | 'skipped') => {
    completeOnboarding();
    if (source === 'skipped') {
      logOnboardingSkipped();
    } else {
      logOnboardingCompleted();
    }
    navigation.replace('Permissions');
  };

  const goNext = () => {
    if (isLast) {
      finish('completed');
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setIndex(next);
  };

  return (
    <View style={styles.container} testID="onboarding-screen">
      <SafeAreaView style={styles.safeArea}>
        {!isLast && (
          <Pressable
            onPress={() => finish('skipped')}
            style={styles.skip}
            testID="onboarding-skip"
          >
            <Text style={styles.skipText}>Pular</Text>
          </Pressable>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          testID="onboarding-scroll"
        >
          {SLIDES.map(slide => (
            <View
              key={slide.key}
              style={[styles.slide, { width }]}
              testID={`onboarding-slide-${slide.key}`}
            >
              <slide.Illustration />
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((slide, i) => (
              <View
                key={slide.key}
                style={[styles.dot, i === index && styles.dotActive]}
              />
            ))}
          </View>
          <Pressable
            onPress={goNext}
            style={styles.nextButton}
            testID="onboarding-next"
          >
            <Text style={styles.nextLabel}>
              {isLast ? 'Continuar' : 'Próximo'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
