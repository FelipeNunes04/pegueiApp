import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRecordingStore } from '../../shared/store/recordingStore';
import { colors } from '../../shared/theme/colors';
import type { RootStackParamList } from '../../shared/types';
import { getSponsorConfig } from '../../config/remoteConfig';
import { COMMON_SPECIES, exportClip, formatWeight, shareExported } from './exportClip';
import { isVideoExportAvailable } from './native/VideoExportModule';
import { styles } from './ExportScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'ExportClip'>;

const SWITCH_TRACK = { false: colors.surfaceDark, true: colors.accent };

/**
 * Export a saved clip for social media: vertical 9:16 and an optional
 * species/weight caption. When a sponsorship is active (Remote Config), its
 * watermark is added and the screen says so.
 */
export function ExportScreen({ route }: Props) {
  const clip = useRecordingStore(s => s.clips.find(c => c.id === route.params.clipId));
  const sponsor = useMemo(() => getSponsorConfig(), []);
  const [portrait, setPortrait] = useState(true);
  const [species, setSpecies] = useState('');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightInvalid = weight.trim() !== '' && formatWeight(weight) === '';
  const available = isVideoExportAvailable();

  const handleExport = async () => {
    if (!clip || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { result } = await exportClip({ clipPath: clip.path, portrait9x16: portrait, species, weight });
      await shareExported(result.path);
    } catch {
      setError('Não foi possível exportar o vídeo. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} testID="export-screen">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Gera uma cópia pronta para Reels, TikTok e Status. O vídeo original fica como está.
        </Text>

        <Text style={styles.section}>Formato</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Vertical 9:16</Text>
          <Switch
            testID="export-portrait-switch"
            value={portrait}
            onValueChange={setPortrait}
            trackColor={SWITCH_TRACK}
            accessibilityLabel="Vertical 9:16"
          />
        </View>

        <Text style={styles.section}>Legenda (opcional)</Text>
        <Text style={styles.hint}>Espécie e peso aparecem no canto do vídeo.</Text>
        <View style={styles.row}>
          {COMMON_SPECIES.map(name => (
            <Text
              key={name}
              testID={`export-species-${name}`}
              onPress={() => setSpecies(current => (current === name ? '' : name))}
              accessibilityRole="button"
              accessibilityState={{ selected: species === name }}
              style={[styles.pill, species === name && styles.pillActive]}
            >
              {name}
            </Text>
          ))}
        </View>
        <TextInput
          testID="export-species-input"
          style={styles.input}
          value={species}
          onChangeText={setSpecies}
          placeholder="Outra espécie"
          placeholderTextColor="rgba(242,245,245,0.4)"
          maxLength={40}
          autoCapitalize="words"
        />
        <TextInput
          testID="export-weight-input"
          style={styles.input}
          value={weight}
          onChangeText={setWeight}
          placeholder="Peso em kg (ex.: 2,4)"
          placeholderTextColor="rgba(242,245,245,0.4)"
          keyboardType="decimal-pad"
          maxLength={8}
        />
        {weightInvalid && <Text style={styles.error}>Peso inválido: use só números, como 2,4.</Text>}

        {sponsor.watermarkEnabled && sponsor.watermarkAssetUrl !== '' && (
          <Text style={styles.sponsorNote} testID="export-sponsor-note">
            Este vídeo sai com a marca do patrocinador do Peguei.
          </Text>
        )}
        {!available && <Text style={styles.error}>Atualize o app para exportar vídeos.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          testID="export-submit"
          accessibilityRole="button"
          disabled={!clip || busy || !available || weightInvalid}
          onPress={handleExport}
          style={[styles.button, (!clip || busy || !available || weightInvalid) && styles.buttonDisabled]}
        >
          {busy && <ActivityIndicator color={colors.textLight} />}
          <Text style={styles.buttonLabel}>{busy ? 'Exportando…' : 'Exportar e compartilhar'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
