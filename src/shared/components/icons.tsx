import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/colors';

interface IconProps {
  size?: number;
  color?: string;
}

/** Simple ring-with-teeth gear glyph — no text label, universally read as "settings". */
export function SettingsGearIcon({ size = 20, color = '#fff' }: IconProps) {
  const cx = 12;
  const cy = 12;
  const outerR = 10;
  const innerR = 6.6;
  const toothLength = 3;
  const toothWidth = 2.6;
  const teeth = 8;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {Array.from({ length: teeth }).map((_, i) => {
        const angle = (360 / teeth) * i;
        return (
          <Rect
            key={i}
            x={cx - toothWidth / 2}
            y={cy - outerR - toothLength / 2 + 1}
            width={toothWidth}
            height={toothLength}
            rx={1}
            fill={color}
            transform={`rotate(${angle} ${cx} ${cy})`}
          />
        );
      })}
      <Circle cx={cx} cy={cy} r={innerR} stroke={color} strokeWidth={2.4} fill="none" />
    </Svg>
  );
}

/** Neutral "empty gallery" placeholder — a photo-frame glyph, shown at reduced opacity until a real clip thumbnail exists. */
export function GalleryPlaceholderIcon({ size = 22, color = 'rgba(255,255,255,0.6)' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={4} width={18} height={16} rx={2} stroke={color} strokeWidth={1.6} fill="none" />
      <Circle cx={8} cy={9.5} r={1.6} fill={color} />
      <Path d="M4 17 L9 12 L13 15.5 L16 12.5 L20 17 Z" fill={color} />
    </Svg>
  );
}

/** Back-chevron for the full-screen clip preview's top bar. */
export function BackArrowIcon({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5 L8 12 L15 19" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Trash-can glyph for the destructive delete action (gallery toolbar + preview). */
export function TrashIcon({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 7 H19 M9 7 V5 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 v2" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Rect x={6.5} y={7} width={11} height={13} rx={1.5} stroke={color} strokeWidth={1.8} fill="none" />
      <Path d="M10 11 V17 M14 11 V17" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Share glyph (box with an upward arrow) — matches the native share-sheet convention on both platforms. */
export function ShareIcon({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 15 V4 M8 8 L12 4 L16 8" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M5 12 v6 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2 -2 v-6" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Play triangle for the paused preview-player state. */
export function PlayIcon({ size = 28, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 5 L19 12 L7 19 Z" fill={color} />
    </Svg>
  );
}

/** Two-bar pause glyph for the playing preview-player state. */
export function PauseIcon({ size = 28, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6} y={5} width={4} height={14} rx={1} fill={color} />
      <Rect x={14} y={5} width={4} height={14} rx={1} fill={color} />
    </Svg>
  );
}

/** Selection-mode checkbox overlay on a grid thumbnail — hollow ring when unselected, filled check when selected. */
export function SelectionCheckIcon({ size = 20, color = '#fff', selected = false }: IconProps & { selected?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9.5} fill={selected ? colors.accent : 'rgba(10,20,20,0.45)'} stroke={color} strokeWidth={1.6} />
      {selected && (
        <Path d="M7.5 12.5 L10.5 15.5 L16.5 8.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      )}
    </Svg>
  );
}

/**
 * Small per-clip "how was this saved" indicator. Only 'manual' exists right
 * now (wake word was removed, see DECISIONS.md) -- a plain tap glyph reads
 * clearly as "manually captured" and the type is structured so a second
 * icon can be added here without touching any calling code if a second
 * trigger source is ever reintroduced.
 */
export function ManualClipIcon({ size = 14, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={9} r={4} stroke={color} strokeWidth={1.8} fill="none" />
      <Path d="M12 13 L12 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8.5 16.5 L12 20 L15.5 16.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
