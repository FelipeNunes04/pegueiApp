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
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useOnboardingStore } from './store/onboardingStore';
import {
  logOnboardingCompleted,
  logOnboardingSkipped,
} from '../../shared/utils/analytics';
import { colors } from '../../shared/theme/colors';
import type { RootStackParamList } from '../../shared/types';
import { styles } from './OnboardingScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

function BufferIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle
        cx={80}
        cy={80}
        r={64}
        stroke={colors.primaryLight}
        strokeWidth={3}
        fill="none"
        opacity={0.4}
      />
      <Path
        d="M80 16 A64 64 0 0 1 144 80"
        stroke={colors.accent}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <Rect
        x={30}
        y={104}
        width={100}
        height={10}
        rx={5}
        fill="rgba(255,255,255,0.15)"
      />
      <Rect x={78} y={104} width={40} height={10} rx={5} fill={colors.accent} />
    </Svg>
  );
}

function TapIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle
        cx={80}
        cy={80}
        r={62}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={3}
        fill="none"
      />
      <Circle
        cx={80}
        cy={80}
        r={44}
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={4}
        fill="none"
      />
      <Circle cx={80} cy={80} r={32} fill={colors.error} />
    </Svg>
  );
}

function VersatilityIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Path
        d="M20 120 L60 70 L90 100 L112 76 L140 120 Z"
        fill={colors.primaryLight}
        opacity={0.5}
      />
      <Path
        d="M80 40 C80 40 68 55 68 66 C68 74 73 80 80 80 C87 80 92 74 92 66 C92 55 80 40 80 40 Z"
        fill={colors.accent}
      />
      <Path d="M80 80 L80 118" stroke={colors.accent} strokeWidth={3} />
      <Path
        d="M80 108 L94 100"
        stroke={colors.accent}
        strokeWidth={3}
        fill="none"
      />
    </Svg>
  );
}

function WelcomeIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle cx={80} cy={80} r={64} fill={colors.primary} opacity={0.25} />
      <Circle
        cx={80}
        cy={80}
        r={40}
        stroke={colors.accent}
        strokeWidth={5}
        fill="none"
      />
      <Path
        d="M80 48 C70 48 63 58 63 68 C63 82 80 100 80 100"
        stroke={colors.primaryLight}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

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
