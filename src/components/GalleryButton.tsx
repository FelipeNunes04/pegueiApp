import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { GalleryPlaceholderIcon } from './icons';
import { getClipThumbnail } from '../utils/thumbnails';
import type { SavedClip } from '../types';

interface Props {
  lastClip: SavedClip | null;
  onPress: () => void;
}

const SIZE = 44;

/** Bottom-left gallery entry point showing a real thumbnail of the last saved clip, matching the camera-app convention (iOS Camera, Instagram, Snapchat). */
export function GalleryButton({ lastClip, onPress }: Props) {
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!lastClip) {
      setThumbUri(null);
      return undefined;
    }
    getClipThumbnail(lastClip.path).then(uri => {
      if (mounted) setThumbUri(uri);
    });
    return () => {
      mounted = false;
    };
  }, [lastClip]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir galeria"
      testID="open-gallery"
      onPress={onPress}
      style={({ pressed }) => [styles.wrapper, pressed && styles.pressed]}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} testID="gallery-thumbnail-image" />
      ) : (
        <View style={[styles.thumb, styles.placeholder]} testID="gallery-thumbnail-placeholder">
          <GalleryPlaceholderIcon />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: SIZE,
    height: SIZE,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  thumb: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: 'rgba(10,20,20,0.55)', alignItems: 'center', justifyContent: 'center' },
});
