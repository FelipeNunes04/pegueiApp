import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import RNFS from 'react-native-fs';
import { useCameraStore } from '../features/camera/store/cameraStore';
import { colors } from '../shared/theme/colors';

/**
 * Where scripts/store-assets.sh copies a real fishing frame
 * (marketing/footage/frame.jpg) into the simulator app's Documents. Without
 * it the preview is a placeholder that says so.
 */
export const DEMO_FRAME_PATH = `${RNFS.DocumentDirectoryPath}/demo/frame.jpg`;

interface Props {
  style?: StyleProp<ViewStyle>;
  isActive?: boolean;
}

/** Demo-mode replacement for CircularBufferPreview. Never used in Release builds. */
export function DemoCameraPreview({ style }: Props) {
  const zoomFactor = useCameraStore(s => s.zoomFactor);
  const [frameUri, setFrameUri] = useState<string | null>(null);

  useEffect(() => {
    RNFS.exists(DEMO_FRAME_PATH)
      .then(exists => setFrameUri(exists ? `file://${DEMO_FRAME_PATH}` : null))
      .catch(() => setFrameUri(null));
  }, []);

  // The frame stands for the 0,5x lens; higher zoom crops into it a little
  // (illustrative, not the real field-of-view ratio).
  const scale = 1 + Math.max(0, zoomFactor - 0.5) * 0.6;

  return (
    <View style={[style, styles.root]} testID="demo-camera-preview">
      {frameUri ? (
        <Image source={{ uri: frameUri }} resizeMode="cover" style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <View style={styles.sky} />
          <View style={styles.water} />
          <View style={styles.box}>
            <Text style={styles.tag}>DEMO</Text>
            <Text style={styles.title}>VÍDEO REAL DE PESCARIA AQUI</Text>
            <Text style={styles.note}>Zoom {zoomFactor.toString().replace('.', ',')}x</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: colors.backgroundDark },
  placeholder: { justifyContent: 'center', alignItems: 'center' },
  sky: { position: 'absolute', left: 0, right: 0, top: 0, bottom: '45%', backgroundColor: colors.secondary, opacity: 0.55 },
  water: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '55%', backgroundColor: colors.primary },
  box: {
    marginHorizontal: 32,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: 'rgba(10,20,20,0.7)',
    alignItems: 'center',
  },
  tag: { color: colors.accent, fontWeight: '800', fontSize: 14, letterSpacing: 2 },
  title: { color: colors.textDark, fontWeight: '800', fontSize: 22, textAlign: 'center', marginTop: 8 },
  note: { color: colors.textDark, opacity: 0.7, fontSize: 13, marginTop: 8 },
});
