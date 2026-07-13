import type { TextStyle } from 'react-native';

/**
 * Type scale for the "Inter" brand typeface. Renders on the OS system font
 * for now (no custom-font pipeline exists in this project yet) — see
 * BRAND.md "Typography" for what's needed to swap in real Inter `.ttf` files.
 */
export const typography: Record<string, TextStyle> = {
  display: { fontSize: 28, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '700' },
  caption: { fontSize: 12, fontWeight: '500' },
};
