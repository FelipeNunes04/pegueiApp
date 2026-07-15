import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Clipboard from '@react-native-clipboard/clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN, type RootStackParamList, type VideoQuality } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { logDonationPixCopied } from '../utils/analytics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const QUALITY_OPTIONS: VideoQuality[] = ['720p', '1080p', '4k'];

// Pix key (e-mail) for optional donations -- e-mail keys don't expose a
// government ID, unlike a CPF key (see conversation 2026-07-15).
const PIX_KEY = 'felipennunes04@icloud.com';

function DonationSection() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
        O app é gratuito e vai continuar sendo. Se ele te ajudou a pegar aquele momento, uma doação via Pix ajuda a
        pagar as contas -- ou, sejamos sinceros, uma isca nova. 🎣
      </Text>
      <Pressable
        onPress={handleCopy}
        style={styles.pixBox}
        accessibilityRole="button"
        testID="settings-copy-pix">
        <Text style={styles.pixLabel}>Chave Pix (e-mail)</Text>
        <Text style={styles.pixKey}>{PIX_KEY}</Text>
        <Text style={styles.pixCopyHint}>{copied ? 'Copiado!' : 'Toque para copiar'}</Text>
      </Pressable>
    </>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const videoQuality = useSettingsStore(s => s.videoQuality);
  const setBufferSeconds = useSettingsStore(s => s.setBufferSeconds);
  const setVideoQuality = useSettingsStore(s => s.setVideoQuality);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="settings-screen">
      <Text style={styles.section}>Gravação contínua</Text>
      <Text style={styles.sectionHint}>
        Quantos segundos antes de você tocar em gravar ficam guardados no clipe salvo.
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
        {QUALITY_OPTIONS.map(option => (
          <Text
            key={option}
            testID={`quality-${option}`}
            onPress={() => setVideoQuality(option)}
            style={[styles.pill, videoQuality === option && styles.pillActive]}>
            {option}
          </Text>
        ))}
      </View>

      <DonationSection />

      <Pressable
        onPress={() => navigation.navigate('Tips')}
        style={styles.tipsRow}
        accessibilityRole="button"
        testID="settings-open-tips">
        <Text style={styles.tipsRowLabel}>Dicas de uso</Text>
        <Text style={styles.tipsRowChevron}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDark },
  content: { padding: 20, paddingBottom: 60 },
  section: { ...typography.title, fontSize: 16, color: colors.textDark, marginTop: 20, marginBottom: 4 },
  sectionHint: { ...typography.caption, color: 'rgba(242,245,245,0.6)', marginBottom: 12 },
  label: { ...typography.body, color: 'rgba(242,245,245,0.8)', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pill: {
    ...typography.body,
    color: colors.textDark,
    backgroundColor: colors.surfaceDark,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginRight: 8,
    overflow: 'hidden',
  },
  pillActive: { backgroundColor: colors.accent, color: colors.textLight },
  pixBox: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
  },
  pixLabel: { ...typography.caption, color: 'rgba(242,245,245,0.6)', marginBottom: 4 },
  pixKey: { ...typography.bodyStrong, color: colors.textDark, letterSpacing: 0.5 },
  pixCopyHint: { ...typography.caption, color: colors.accent, marginTop: 8 },
  tipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  tipsRowLabel: { ...typography.body, color: colors.textDark },
  tipsRowChevron: { ...typography.title, color: 'rgba(242,245,245,0.4)' },
});
