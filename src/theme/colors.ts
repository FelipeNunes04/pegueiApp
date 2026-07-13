/** Brand palette. See BRAND.md for rationale/contrast notes — don't hardcode new hex values in screens, add a token here instead. */
export const colors = {
  primary: '#0B4F4F',
  primaryLight: '#3FA79A',
  secondary: '#1C7EA6',
  accent: '#F5A623',
  accentAlt: '#FFD166',
  success: '#2FBF71',
  error: '#E5484D',
  backgroundLight: '#F5F7F7',
  surfaceLight: '#FFFFFF',
  textLight: '#0B1F1F',
  backgroundDark: '#0A1414',
  surfaceDark: '#14201F',
  textDark: '#F2F5F5',
} as const;

export type ColorToken = keyof typeof colors;
