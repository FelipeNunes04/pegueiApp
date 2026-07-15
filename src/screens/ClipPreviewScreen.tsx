import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import Video, { type VideoRef } from 'react-native-video';
import Share from 'react-native-share';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { BackArrowIcon, PauseIcon, PlayIcon, ShareIcon, TrashIcon } from '../components/icons';
import { ScrimIconButton } from '../components/ScrimIconButton';
import { formatDuration } from '../utils/duration';
import { deleteClip } from '../utils/files';
import { logClipDeleted, logClipShared } from '../utils/analytics';
import { useRecordingStore } from '../store/recordingStore';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ClipPreview'>;

function toFilePath(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Full-screen video player for a single saved clip: play/pause, draggable seek bar, and the share/delete actions. */
export function ClipPreviewScreen({ route, navigation }: Props) {
  const { clipId } = route.params;
  const clip = useRecordingStore(s => s.clips.find(c => c.id === clipId));
  const removeClip = useRecordingStore(s => s.removeClip);

  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  // The clip can disappear from the store mid-view (e.g. deleted from
  // another instance of the gallery) -- bail out to Gallery rather than
  // rendering a player with no source.
  useEffect(() => {
    if (!clip) {
      navigation.goBack();
    }
  }, [clip, navigation]);

  const togglePlayback = useCallback(() => setPaused(prev => !prev), []);

  const handleShare = useCallback(() => {
    if (!clip) return;
    Share.open({ url: toFilePath(clip.path), type: 'video/mp4' })
      .then(() => logClipShared(1))
      .catch(() => undefined);
  }, [clip]);

  const confirmDelete = useCallback(async () => {
    if (!clip) return;
    setPendingDelete(false);
    await deleteClip(clip.path);
    removeClip(clip.id);
    logClipDeleted(1);
    navigation.goBack();
  }, [clip, removeClip, navigation]);

  if (!clip) {
    return <View style={styles.container} testID="clip-preview-screen" />;
  }

  return (
    <View style={styles.container} testID="clip-preview-screen">
      <Pressable style={StyleSheet.absoluteFill} onPress={togglePlayback} accessibilityRole="button">
        <Video
          ref={videoRef}
          source={{ uri: toFilePath(clip.path) }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          paused={paused}
          onLoad={e => setDuration(e.duration)}
          onProgress={e => {
            if (!isSeeking) setCurrentTime(e.currentTime);
          }}
          onEnd={() => setPaused(true)}
        />
        {paused && (
          <View style={styles.centerPlayButton} pointerEvents="none">
            <PlayIcon size={48} />
          </View>
        )}
      </Pressable>

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <ScrimIconButton onPress={() => navigation.goBack()} accessibilityLabel="Voltar" testID="preview-back">
          <BackArrowIcon />
        </ScrimIconButton>
        <View style={styles.topActions}>
          <ScrimIconButton onPress={handleShare} accessibilityLabel="Compartilhar" testID="preview-share">
            <ShareIcon />
          </ScrimIconButton>
          <ScrimIconButton onPress={() => setPendingDelete(true)} accessibilityLabel="Excluir" testID="preview-delete">
            <TrashIcon color={colors.error} />
          </ScrimIconButton>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottomBar} pointerEvents="box-none">
        <Pressable onPress={togglePlayback} accessibilityRole="button" testID="preview-play-pause" style={styles.playPauseButton}>
          {paused ? <PlayIcon size={22} /> : <PauseIcon size={22} />}
        </Pressable>
        <Text style={styles.time}>{formatDuration(currentTime)}</Text>
        <Slider
          testID="preview-seek-slider"
          style={styles.slider}
          minimumValue={0}
          maximumValue={Math.max(duration, 0.1)}
          value={currentTime}
          onSlidingStart={() => setIsSeeking(true)}
          onSlidingComplete={value => {
            setIsSeeking(false);
            setCurrentTime(value);
            videoRef.current?.seek(value);
          }}
          minimumTrackTintColor={colors.accent}
        />
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </SafeAreaView>

      <DeleteConfirmModal
        visible={pendingDelete}
        count={1}
        onCancel={() => setPendingDelete(false)}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  centerPlayButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  topActions: { flexDirection: 'row', gap: 8 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  playPauseButton: { marginRight: 8 },
  slider: { flex: 1, marginHorizontal: 8 },
  time: { color: 'white', fontSize: 12, minWidth: 36, textAlign: 'center' },
});
