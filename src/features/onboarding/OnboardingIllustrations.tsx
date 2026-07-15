import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../shared/theme/colors';

export function BufferIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle
        cx={80}
        cy={80}
        r={64}
        stroke={colors.primaryLight}
        strokeWidth={3}
        fill="none"
        opacity={0.4}
      />
      <Path
        d="M80 16 A64 64 0 0 1 144 80"
        stroke={colors.accent}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <Rect
        x={30}
        y={104}
        width={100}
        height={10}
        rx={5}
        fill="rgba(255,255,255,0.15)"
      />
      <Rect x={78} y={104} width={40} height={10} rx={5} fill={colors.accent} />
    </Svg>
  );
}

export function TapIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle
        cx={80}
        cy={80}
        r={62}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={3}
        fill="none"
      />
      <Circle
        cx={80}
        cy={80}
        r={44}
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={4}
        fill="none"
      />
      <Circle cx={80} cy={80} r={32} fill={colors.error} />
    </Svg>
  );
}

export function VersatilityIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Path
        d="M20 120 L60 70 L90 100 L112 76 L140 120 Z"
        fill={colors.primaryLight}
        opacity={0.5}
      />
      <Path
        d="M80 40 C80 40 68 55 68 66 C68 74 73 80 80 80 C87 80 92 74 92 66 C92 55 80 40 80 40 Z"
        fill={colors.accent}
      />
      <Path d="M80 80 L80 118" stroke={colors.accent} strokeWidth={3} />
      <Path
        d="M80 108 L94 100"
        stroke={colors.accent}
        strokeWidth={3}
        fill="none"
      />
    </Svg>
  );
}

export function WelcomeIllustration() {
  return (
    <Svg width={160} height={160} viewBox="0 0 160 160">
      <Circle cx={80} cy={80} r={64} fill={colors.primary} opacity={0.25} />
      <Circle
        cx={80}
        cy={80}
        r={40}
        stroke={colors.accent}
        strokeWidth={5}
        fill="none"
      />
      <Path
        d="M80 48 C70 48 63 58 63 68 C63 82 80 100 80 100"
        stroke={colors.primaryLight}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
