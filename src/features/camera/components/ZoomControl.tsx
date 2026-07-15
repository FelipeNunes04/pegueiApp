import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { nearestZoomLevelIndex } from '../utils/zoom';
import { styles } from './ZoomControl.styles';

interface Props {
  levels: number[];
  zoomFactor: number;
  onSelect: (level: number) => void;
}

function formatZoomLabel(level: number): string {
  const trimmed = level % 1 === 0 ? level.toString() : level.toFixed(1);
  return `${trimmed}x`;
}

/**
 * Fixed zoom-level pills, camera-app convention (bottom bar, above the
 * capture button). The nearest pill to the current `zoomFactor` is
 * highlighted, so it also reflects continuous pinch-to-zoom (see
 * usePinchToZoom.ts) snapping visually to the closest level as the user
 * pinches, not just direct pill taps.
 */
export function ZoomControl({ levels, zoomFactor, onSelect }: Props) {
  if (levels.length < 2) {
    return null;
  }
  const activeIndex = nearestZoomLevelIndex(levels, zoomFactor);

  return (
    <View style={styles.row} testID="zoom-control">
      {levels.map((level, index) => {
        const isActive = index === activeIndex;
        return (
          <Pressable
            key={level}
            accessibilityRole="button"
            accessibilityLabel={`Zoom ${formatZoomLabel(level)}`}
            accessibilityState={{ selected: isActive }}
            testID={`zoom-pill-${level}`}
            onPress={() => onSelect(level)}
            style={[styles.pill, isActive && styles.pillActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {formatZoomLabel(level)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
