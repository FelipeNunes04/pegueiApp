import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CircularBufferPreview } from '../native/CircularBufferModule';
import { useCircularBuffer } from '../hooks/useCircularBuffer';
import { useZoom } from '../hooks/useZoom';
import { usePinchToZoom } from '../hooks/usePinchToZoom';
import { useSettingsStore } from '../store/settingsStore';
import { useRecordingStore } from '../store/recordingStore';
import { BufferIndicator } from '../components/BufferIndicator';
import { RecordButton } from '../components/RecordButton';
import { GalleryButton } from '../components/GalleryButton';
import { ScrimIconButton } from '../components/ScrimIconButton';
import { ZoomControl } from '../components/ZoomControl';
import { SettingsGearIcon } from '../components/icons';
import { listSavedClips } from '../utils/files';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export function CameraScreen({ navigation }: Props) {
  const { phase, start, stop, startRecording, stopRecording } = useCircularBuffer();
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const errorMessage = useRecordingStore(s => s.errorMessage);
  const clearError = useRecordingStore(s => s.clearError);
  const clips = useRecordingStore(s => s.clips);
  const setClips = useRecordingStore(s => s.setClips);
  const { zoomFactor, pillLevels, setZoom } = useZoom(phase);
  const pinchHandlers = usePinchToZoom(zoomFactor, setZoom);

  useEffect(() => {
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refreshes the shared clip list so the gallery button's thumbnail reflects
  // the most recent save, including clips saved in a previous app session.
  const refreshClips = useCallback(() => {
    listSavedClips().then(setClips).catch(() => undefined);
  }, [setClips]);

  useEffect(() => {
    refreshClips();
  }, [refreshClips]);

  useEffect(() => {
    if (phase === 'buffering') {
      refreshClips();
    }
  }, [phase, refreshClips]);

  return (
    <View style={styles.container} testID="camera-screen">
      <CircularBufferPreview style={StyleSheet.absoluteFill} isActive />
      <View style={StyleSheet.absoluteFill} {...pinchHandlers} testID="pinch-zoom-overlay" />

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <BufferIndicator phase={phase} bufferSeconds={bufferSeconds} />
        <ScrimIconButton
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Abrir configurações"
          testID="open-settings">
          <SettingsGearIcon />
        </ScrimIconButton>
      </SafeAreaView>

      {errorMessage && (
        <View style={styles.errorBanner} testID="error-banner">
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable onPress={clearError}>
            <Text style={styles.errorDismiss}>Fechar</Text>
          </Pressable>
        </View>
      )}

      <SafeAreaView edges={['bottom']} style={styles.bottomArea} pointerEvents="box-none">
        <ZoomControl levels={pillLevels} zoomFactor={zoomFactor} onSelect={setZoom} />
        <View style={styles.bottomBar}>
          <GalleryButton lastClip={clips[0] ?? null} onPress={() => navigation.navigate('Gallery')} />
          <RecordButton
            phase={phase}
            onPress={() => (phase === 'recording' ? stopRecording() : startRecording())}
          />
          <View style={styles.bottomSpacer} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  bottomSpacer: { width: 44 },
  errorBanner: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: colors.error,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorText: { ...typography.body, color: 'white', flex: 1 },
  errorDismiss: { ...typography.bodyStrong, color: 'white', marginLeft: 12 },
});
