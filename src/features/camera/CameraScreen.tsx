import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CircularBufferPreview } from './native/CircularBufferModule';
import { useCircularBuffer } from './hooks/useCircularBuffer';
import { useZoom } from './hooks/useZoom';
import { usePinchToZoom } from './hooks/usePinchToZoom';
import { useSettingsStore } from '../settings/store/settingsStore';
import { useRecordingStore } from '../../shared/store/recordingStore';
import { useCameraStore } from './store/cameraStore';
import { BufferIndicator } from './components/BufferIndicator';
import { RecordButton } from './components/RecordButton';
import { GalleryButton } from './components/GalleryButton';
import { ScrimIconButton } from '../../shared/components/ScrimIconButton';
import { ZoomControl } from './components/ZoomControl';
import { SettingsGearIcon } from '../../shared/components/icons';
import { listSavedClips } from '../../shared/utils/files';
import type { RootStackParamList } from '../../shared/types';
import { styles } from './CameraScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export function CameraScreen({ navigation }: Props) {
  const { phase, start, stop, startRecording, stopRecording } =
    useCircularBuffer();
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const errorMessage = useRecordingStore(s => s.errorMessage);
  const clearError = useRecordingStore(s => s.clearError);
  const clips = useRecordingStore(s => s.clips);
  const setClips = useRecordingStore(s => s.setClips);
  const { zoomFactor, pillLevels, setZoom } = useZoom(phase);
  const pinchHandlers = usePinchToZoom(zoomFactor, setZoom);

  // start/stop's identity changes whenever bufferSeconds/videoQuality/fps
  // changes (see useCircularBuffer's doc comment), so this intentionally
  // re-runs -- tearing down and reopening the native buffer with the new
  // config -- any time a setting changes while this screen stays mounted in
  // the background (e.g. the user tweaks a slider on SettingsScreen and taps
  // back). Previously this effect had an empty dependency array, so it only
  // ever applied whatever settings were current at the very first mount --
  // React Navigation's native-stack keeps CameraScreen mounted underneath
  // Settings rather than unmounting it, so settings changes silently never
  // reached the running buffer.
  useEffect(() => {
    start();
    return () => {
      stop();
    };
  }, [start, stop]);

  // Refreshes the shared clip list so the gallery button's thumbnail reflects
  // the most recent save, including clips saved in a previous app session.
  const refreshClips = useCallback(() => {
    listSavedClips()
      .then(setClips)
      .catch(() => undefined);
  }, [setClips]);

  useEffect(() => {
    refreshClips();
  }, [refreshClips]);

  useEffect(() => {
    if (phase === 'buffering') {
      refreshClips();
    }
  }, [phase, refreshClips]);

  // Navigating away (e.g. to Gallery) and back detaches/reattaches the
  // native preview, which silently reopens the camera at its
  // hardware-default zoom -- useZoom's own correction only runs while its
  // cached zoom range is unset, so it needs to be invalidated on every
  // refocus, not just the first mount, or the pills keep showing the old
  // level while the lens has actually reset. See DECISIONS.md "Camera zoom".
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      useCameraStore.getState().invalidateZoomRange();
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.container} testID="camera-screen">
      <CircularBufferPreview style={StyleSheet.absoluteFill} isActive />
      <View
        style={StyleSheet.absoluteFill}
        {...pinchHandlers}
        testID="pinch-zoom-overlay"
      />

      <SafeAreaView
        edges={['top']}
        style={styles.topBar}
        pointerEvents="box-none"
      >
        <BufferIndicator phase={phase} bufferSeconds={bufferSeconds} />
        <ScrimIconButton
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Abrir configurações"
          testID="open-settings"
        >
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

      <SafeAreaView
        edges={['bottom']}
        style={styles.bottomArea}
        pointerEvents="box-none"
      >
        <ZoomControl
          levels={pillLevels}
          zoomFactor={zoomFactor}
          onSelect={setZoom}
        />
        <View style={styles.bottomBar}>
          <GalleryButton
            lastClip={clips[0] ?? null}
            onPress={() => navigation.navigate('Gallery')}
          />
          <RecordButton
            phase={phase}
            onPress={() =>
              phase === 'recording' ? stopRecording() : startRecording()
            }
          />
          <View style={styles.bottomSpacer} />
        </View>
      </SafeAreaView>
    </View>
  );
}
