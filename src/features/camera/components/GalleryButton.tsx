import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { GalleryPlaceholderIcon } from '../../../shared/components/icons';
import { getClipThumbnail } from '../../gallery/utils/thumbnails';
import type { SavedClip } from '../../../shared/types';
import { styles } from './GalleryButton.styles';

interface Props {
  lastClip: SavedClip | null;
  onPress: () => void;
}

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
      style={({ pressed }) => [styles.wrapper, pressed && styles.pressed]}
    >
      {thumbUri ? (
        <Image
          source={{ uri: thumbUri }}
          style={styles.thumb}
          testID="gallery-thumbnail-image"
        />
      ) : (
        <View
          style={[styles.thumb, styles.placeholder]}
          testID="gallery-thumbnail-placeholder"
        >
          <GalleryPlaceholderIcon />
        </View>
      )}
    </Pressable>
  );
}
