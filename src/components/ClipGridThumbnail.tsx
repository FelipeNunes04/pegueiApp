import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '../utils/duration';
import { getClipThumbnail } from '../utils/thumbnails';
import { ManualClipIcon, SelectionCheckIcon } from './icons';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import type { SavedClip } from '../types';

interface Props {
  clip: SavedClip;
  size: number;
  selectionMode: boolean;
  selected: boolean;
  onPress: (clip: SavedClip) => void;
  onLongPress: (clip: SavedClip) => void;
}

/** A single grid cell: video-frame thumbnail, duration badge, origin indicator, and a selection checkbox overlay in selection mode. */
export function ClipGridThumbnail({ clip, size, selectionMode, selected, onPress, onLongPress }: Props) {
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getClipThumbnail(clip.path).then(uri => {
      if (mounted) setThumbUri(uri);
    });
    return () => {
      mounted = false;
    };
  }, [clip.path]);

  return (
    <Pressable
      testID={`clip-${clip.id}`}
      accessibilityRole="button"
      accessibilityLabel={selectionMode ? (selected ? 'Selecionado' : 'Não selecionado') : 'Abrir vídeo'}
      onPress={() => onPress(clip)}
      onLongPress={() => onLongPress(clip)}
      style={[styles.container, { width: size, height: size }]}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} testID={`clip-${clip.id}-image`} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}

      <View style={styles.originBadge} testID={`clip-${clip.id}-origin-${clip.triggeredBy}`}>
        <ManualClipIcon size={12} />
      </View>

      <View style={styles.durationBadge}>
        <Text style={styles.durationText}>{formatDuration(clip.durationSeconds)}</Text>
      </View>

      {selectionMode && (
        <View style={styles.checkboxWrapper} testID={`clip-${clip.id}-checkbox`}>
          <SelectionCheckIcon selected={selected} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceDark, margin: 1, overflow: 'hidden' },
  placeholder: { backgroundColor: colors.surfaceDark },
  originBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(10,20,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(10,20,20,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: { ...typography.caption, color: '#fff', fontSize: 11 },
  checkboxWrapper: { position: 'absolute', top: 6, right: 6 },
});
