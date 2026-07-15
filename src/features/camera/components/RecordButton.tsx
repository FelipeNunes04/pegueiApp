import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../../shared/theme/colors';
import type { RecordingPhase } from '../../../shared/types';
import { styles } from './RecordButton.styles';

interface Props {
  phase: RecordingPhase;
  onPress: () => void;
  disabled?: boolean;
}

const CONFIRM_FLASH_MS = 700;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The buffer is always recording in the background (see
 * useCircularBuffer/CameraScreen) -- this button controls an explicit
 * manual recording on top of that: tap once to start (open-ended, no fixed
 * duration), tap again to stop and save. The saved clip concatenates the
 * pre-roll buffer with whatever was recorded between the two taps. Icon
 * states follow the universal record (idle) -> recording (pulsing square)
 * -> brief checkmark (saved) convention from native camera apps, with no
 * text label beyond a live elapsed-time readout while recording.
 */
export function RecordButton({ phase, onPress, disabled }: Props) {
  const isRecording = phase === 'recording';
  const isSaving = phase === 'saving';
  const isDisabled = Boolean(disabled) || isSaving;

  const pulse = useRef(new Animated.Value(1)).current;
  const [showConfirm, setShowConfirm] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const prevPhaseRef = useRef(phase);
  const recordingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRecording) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.12,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulse]);

  useEffect(() => {
    if (!isRecording) {
      recordingStartRef.current = null;
      setElapsedMs(0);
      return undefined;
    }
    recordingStartRef.current = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - (recordingStartRef.current ?? Date.now()));
    }, 250);
    return () => clearInterval(interval);
  }, [isRecording]);

  useEffect(() => {
    const wasSaving = prevPhaseRef.current === 'saving';
    prevPhaseRef.current = phase;
    if (wasSaving && phase !== 'saving') {
      setShowConfirm(true);
      const timeout = setTimeout(() => setShowConfirm(false), CONFIRM_FLASH_MS);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [phase]);

  const accessibilityLabel = showConfirm
    ? 'Clipe salvo'
    : isSaving
    ? 'Salvando clipe'
    : isRecording
    ? 'Parar gravação'
    : 'Iniciar gravação';
  const recordIconColor =
    disabled && !isRecording && !isSaving
      ? 'rgba(255,255,255,0.4)'
      : colors.error;

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID="record-button"
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.button,
          pressed && !isDisabled && styles.pressed,
        ]}
      >
        <View style={styles.ring} />
        <View style={styles.iconWrapper}>
          {showConfirm ? (
            <Svg width={32} height={32} viewBox="0 0 24 24">
              <Path
                d="M4 12.5 L9.5 18 L20 6"
                stroke={colors.success}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          ) : isSaving ? (
            <ActivityIndicator color="white" />
          ) : isRecording ? (
            <Animated.View
              style={[styles.recordingIcon, { transform: [{ scale: pulse }] }]}
            />
          ) : (
            <View
              style={[styles.recordIcon, { backgroundColor: recordIconColor }]}
            />
          )}
        </View>
      </Pressable>
      {isRecording && (
        <Text style={styles.timer}>{formatElapsed(elapsedMs)}</Text>
      )}
    </View>
  );
}
