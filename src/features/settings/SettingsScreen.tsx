import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Clipboard from '@react-native-clipboard/clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BUFFER_SECONDS_MAX,
  BUFFER_SECONDS_MIN,
  VIDEO_FPS_OPTIONS,
  type RootStackParamList,
  type VideoQuality,
} from '../../shared/types';
import { useSettingsStore } from './store/settingsStore';
import { useCameraStore } from '../camera/store/cameraStore';
import { isFpsSupported, isQualitySupported } from '../../shared/utils/captureCapabilities';
import { logDonationPixCopied } from '../../shared/utils/analytics';
import { styles } from './SettingsScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const QUALITY_OPTIONS: VideoQuality[] = ['720p', '1080p', '4k'];

// Defined outside SettingsScreen (rather than inline in the headerLeft
// factory) so react-navigation's header doesn't see a new component type on
// every render -- mirrors GalleryScreen's SelectionCancelButton. Native-stack
// has no testID hook for its own default back button, so this exists purely
// to give e2e (Detox) a stable way to navigate back from Settings.
function SettingsBackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" testID="settings-back" onPress={onPress} hitSlop={8}>
      <Text style={styles.headerBack}>‹</Text>
    </Pressable>
  );
}

// Pix key (e-mail) for optional donations -- e-mail keys don't expose a
// government ID, unlike a CPF key (see conversation 2026-07-15).
const PIX_KEY = 'felipennunes04@icloud.com';

function DonationSection() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = () => {
    Clipboard.setString(PIX_KEY);
    logDonationPixCopied();
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Text style={styles.section}>Apoie o Peguei</Text>
      <Text style={styles.sectionHint}>
        O app é gratuito e vai continuar sendo. Se ele te ajudou a pegar aquele
        momento, uma doação via Pix ajuda a pagar as contas -- ou, sejamos
        sinceros, uma isca nova. 🎣
      </Text>
      <Pressable
        onPress={handleCopy}
        style={styles.pixBox}
        accessibilityRole="button"
        testID="settings-copy-pix"
      >
        <Text style={styles.pixLabel}>Chave Pix (e-mail)</Text>
        <Text style={styles.pixKey}>{PIX_KEY}</Text>
        <Text style={styles.pixCopyHint}>
          {copied ? 'Copiado!' : 'Toque para copiar'}
        </Text>
      </Pressable>
    </>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const videoQuality = useSettingsStore(s => s.videoQuality);
  const fps = useSettingsStore(s => s.fps);
  const setBufferSeconds = useSettingsStore(s => s.setBufferSeconds);
  const setVideoQuality = useSettingsStore(s => s.setVideoQuality);
  const setFps = useSettingsStore(s => s.setFps);

  const captureCapabilities = useCameraStore(s => s.captureCapabilities);
  const loadCaptureCapabilities = useCameraStore(s => s.loadCaptureCapabilities);

  useEffect(() => {
    loadCaptureCapabilities();
  }, [loadCaptureCapabilities]);

  const unsupportedQualities = QUALITY_OPTIONS.filter(
    option => !isQualitySupported(captureCapabilities, option),
  );
  const unsupportedFps = VIDEO_FPS_OPTIONS.filter(
    option => !isFpsSupported(captureCapabilities, videoQuality, option),
  );

  const renderBackButton = useCallback(
    () => <SettingsBackButton onPress={() => navigation.goBack()} />,
    [navigation],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerLeft: renderBackButton });
  }, [navigation, renderBackButton]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="settings-screen"
    >
      <Text style={styles.section}>Gravação contínua</Text>
      <Text style={styles.sectionHint}>
        Quantos segundos antes de você tocar em gravar ficam guardados no clipe
        salvo.
      </Text>
      <Text style={styles.label}>Tempo guardado: {bufferSeconds}s</Text>
      <Slider
        testID="buffer-seconds-slider"
        minimumValue={BUFFER_SECONDS_MIN}
        maximumValue={BUFFER_SECONDS_MAX}
        step={1}
        value={bufferSeconds}
        onSlidingComplete={setBufferSeconds}
      />

      <Text style={styles.section}>Qualidade de vídeo</Text>
      <View style={styles.row}>
        {QUALITY_OPTIONS.map(option => {
          const supported = isQualitySupported(captureCapabilities, option);
          return (
            <Text
              key={option}
              testID={`quality-${option}`}
              onPress={supported ? () => setVideoQuality(option) : undefined}
              accessibilityState={{ disabled: !supported, selected: videoQuality === option }}
              style={[
                styles.pill,
                videoQuality === option && styles.pillActive,
                !supported && styles.pillDisabled,
              ]}
            >
              {option}
            </Text>
          );
        })}
      </View>
      {unsupportedQualities.length > 0 && (
        <Text style={styles.sectionHint} testID="quality-unsupported-hint">
          Indisponível neste aparelho: {unsupportedQualities.join(', ')}.
        </Text>
      )}

      <Text style={styles.section}>Taxa de quadros (FPS)</Text>
      <View style={styles.row}>
        {VIDEO_FPS_OPTIONS.map(option => {
          const supported = isFpsSupported(captureCapabilities, videoQuality, option);
          return (
            <Text
              key={option}
              testID={`fps-${option}`}
              onPress={supported ? () => setFps(option) : undefined}
              accessibilityState={{ disabled: !supported, selected: fps === option }}
              style={[
                styles.pill,
                fps === option && styles.pillActive,
                !supported && styles.pillDisabled,
              ]}
            >
              {option}
            </Text>
          );
        })}
      </View>
      {unsupportedFps.length > 0 && (
        <Text style={styles.sectionHint} testID="fps-unsupported-hint">
          Indisponível em {videoQuality} neste aparelho: {unsupportedFps.join(', ')}.
        </Text>
      )}

      {/* Apple rejected the App Store submission (guideline 3.1.1) over this
          box: any in-app monetary transaction, even an optional donation,
          must go through In-App Purchase. Google Play has no equivalent
          restriction, so this stays visible on Android -- see DECISIONS.md
          "Monetization" for the full rejection/decision. */}
      {Platform.OS !== 'ios' && <DonationSection />}

      <Pressable
        onPress={() => navigation.navigate('Tips')}
        style={styles.tipsRow}
        accessibilityRole="button"
        testID="settings-open-tips"
      >
        <Text style={styles.tipsRowLabel}>Dicas de uso</Text>
        <Text style={styles.tipsRowChevron}>›</Text>
      </Pressable>
    </ScrollView>
  );
}
