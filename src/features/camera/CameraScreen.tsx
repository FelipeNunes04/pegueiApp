import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CircularBufferPreview } from './native/CircularBufferModule';
import { useCircularBuffer } from './hooks/useCircularBuffer';
import { useZoom } from './hooks/useZoom';
import { usePinchToZoom } from './hooks/usePinchToZoom';
import { usePocketMode } from './hooks/usePocketMode';
import { useHardwareTrigger } from './hooks/useHardwareTrigger';
import { useIdleTimer } from './hooks/useIdleTimer';
import { useSettingsStore } from '../settings/store/settingsStore';
import { useRecordingStore } from '../../shared/store/recordingStore';
import { useCameraStore } from './store/cameraStore';
import { BufferIndicator } from './components/BufferIndicator';
import { RecordButton } from './components/RecordButton';
import { GalleryButton } from './components/GalleryButton';
import { ScrimIconButton } from '../../shared/components/ScrimIconButton';
import { ZoomControl } from './components/ZoomControl';
import { PocketModeOverlay } from './components/PocketModeOverlay';
import { AutoStoppedOverlay } from './components/AutoStoppedOverlay';
import { PocketModeIcon, SettingsGearIcon } from '../../shared/components/icons';
import { listSavedClips } from '../../shared/utils/files';
import type { RootStackParamList } from '../../shared/types';
import { styles } from './CameraScreen.styles';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export function CameraScreen({ navigation }: Props) {
  const { phase, start, stop, startRecording, stopRecording } =
    useCircularBuffer();
  const bufferSeconds = useSettingsStore(s => s.bufferSeconds);
  const hardwareTriggersEnabled = useSettingsStore(s => s.hardwareTriggersEnabled);
  const autoStopMinutes = useSettingsStore(s => s.autoStopMinutes);
  const bufferHealth = useRecordingStore(s => s.bufferHealth);
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

  // native-stack keeps this screen mounted underneath Gallery/Settings, so
  // "mounted" != "in front". Pocket mode, hardware triggers and the
  // inactivity auto-stop all only make sense while it's actually in front
  // (e.g. volume keys must control playback volume again in ClipPreview).
  const [isFocused, setIsFocused] = useState(true);
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => setIsFocused(true));
    const unsubscribeBlur = navigation.addListener('blur', () => setIsFocused(false));
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation]);

  const pocketMode = usePocketMode(phase, isFocused);

  // "Desligar buffer após inatividade": only counts down while plain
  // buffering (never during a manual recording/save) with this screen in
  // front; any touch or hardware trigger restarts it. Firing stops the
  // native buffer through the same stop() unmount uses, then shows
  // AutoStoppedOverlay until the user taps "Retomar". Note that
  // useCircularBuffer's AppState handler restarts a dead buffer on return
  // to the foreground -- coming back to the app counts as activity, and the
  // overlay clears itself as soon as phase is 'buffering' again.
  const [autoStopped, setAutoStopped] = useState(false);
  const handleAutoStop = useCallback(() => {
    setAutoStopped(true);
    stop();
  }, [stop]);
  const markAutoStopActivity = useIdleTimer(
    autoStopMinutes > 0 && phase === 'buffering' && isFocused,
    autoStopMinutes * 60_000,
    handleAutoStop,
  );
  useEffect(() => {
    if (phase === 'buffering' || phase === 'recording') {
      setAutoStopped(false);
    }
  }, [phase]);
  const showAutoStopped = autoStopped && phase === 'idle';

  const handleResume = useCallback(() => {
    setAutoStopped(false);
    markAutoStopActivity();
    start();
  }, [markAutoStopActivity, start]);

  // Same semantics as the record button: stop while recording, otherwise
  // start; nothing while a save is still being finalized.
  const toggleRecording = useCallback(() => {
    if (phase === 'saving') {
      return;
    }
    if (phase === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  }, [phase, startRecording, stopRecording]);

  // Works inside pocket mode too (that's most of its point -- recording
  // from a pocket without looking), and intentionally doesn't exit it.
  const handleHardwareTrigger = useCallback(() => {
    markAutoStopActivity();
    toggleRecording();
  }, [markAutoStopActivity, toggleRecording]);
  useHardwareTrigger(
    hardwareTriggersEnabled && isFocused && !showAutoStopped,
    handleHardwareTrigger,
  );

  // onTouchStart bubbles from every descendant (buttons, pinch overlay,
  // pocket overlay) without claiming the responder, so it's a cheap "the
  // user touched the screen" hook that doesn't interfere with any of them.
  const { markActivity: markPocketActivity } = pocketMode;
  const handleTouchStart = useCallback(() => {
    markPocketActivity();
    markAutoStopActivity();
  }, [markPocketActivity, markAutoStopActivity]);

  const canEnterPocketMode = phase === 'buffering' || phase === 'recording';
  // Hides the regular controls from TalkBack while an overlay covers them
  // (iOS gets the same via the overlay's accessibilityViewIsModal).
  const controlsA11y =
    pocketMode.isActive || showAutoStopped
      ? ({ importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const)
      : {};

  return (
    <View
      style={styles.container}
      testID="camera-screen"
      onTouchStart={handleTouchStart}
    >
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
        {...controlsA11y}
      >
        <BufferIndicator
          phase={phase}
          bufferSeconds={bufferSeconds}
          health={bufferHealth}
          paused={pocketMode.isActive}
        />
        <View style={styles.topBarActions} pointerEvents="box-none">
          {canEnterPocketMode && (
            <ScrimIconButton
              onPress={pocketMode.enter}
              accessibilityLabel="Ativar modo bolso (tela preta, continua gravando)"
              testID="enter-pocket-mode"
            >
              <PocketModeIcon />
            </ScrimIconButton>
          )}
          <ScrimIconButton
            onPress={() => navigation.navigate('Settings')}
            accessibilityLabel="Abrir configurações"
            testID="open-settings"
          >
            <SettingsGearIcon />
          </ScrimIconButton>
        </View>
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
        {...controlsA11y}
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
            onPress={toggleRecording}
            paused={pocketMode.isActive}
          />
          <View style={styles.bottomSpacer} />
        </View>
      </SafeAreaView>

      {showAutoStopped && (
        <AutoStoppedOverlay minutes={autoStopMinutes} onResume={handleResume} />
      )}

      {pocketMode.isActive && (
        <PocketModeOverlay
          phase={phase}
          health={bufferHealth}
          onExit={pocketMode.exit}
        />
      )}
    </View>
  );
}
