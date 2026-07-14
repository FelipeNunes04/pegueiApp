import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { BUFFER_SECONDS_MAX, BUFFER_SECONDS_MIN, type VideoQuality } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

const QUALITY_OPTIONS: VideoQuality[] = ['720p', '1080p', '4k'];

export function SettingsScreen() {
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
});
