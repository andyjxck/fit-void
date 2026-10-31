import { Platform } from 'react-native';

/**
 * Fit Void design tokens.
 * Deep "Void" aesthetic: true OLED black canvas, elevated surfaces,
 * hairline borders, and a single high-contrast accent.
 */
export const Void = {
  canvas: '#000000',
  surface: '#0D0D0D',
  surfaceRaised: '#161616',
  surfacePressed: '#1E1E1E',
  border: '#222222',
  borderStrong: '#2E2E2E',

  accent: '#CCFF00', // Electric Lime
  accentDim: 'rgba(204, 255, 0, 0.12)',
  accentText: '#0A0A00', // text rendered on top of accent

  text: '#F2F2F2',
  textSecondary: '#8A8A8A',
  textTertiary: '#555555',
  ghost: '#4A4A4A', // ghost-set placeholder text

  success: '#4ADE80',
  danger: '#FF4D4D',
  warmup: '#FFB020',
  drop: '#C084FC',
  failure: '#FF6B6B',
} as const;

export const Radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    mono: 'Menlo',
  },
  default: {
    sans: 'System',
    mono: 'monospace',
  },
});

/** Tabular figure style for every numeric readout in the app. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

export const Type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.6 },
} as const;
