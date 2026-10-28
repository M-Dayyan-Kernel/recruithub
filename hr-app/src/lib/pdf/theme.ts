/**
 * The product's colours, spacing and type scale for PDF reports.
 *
 * react-pdf cannot read the CSS variables, so the light-theme tokens from src/styles/tokens.css
 * are copied here as hex. Keep the two in step (tests/pdfTheme.test.ts compares them). docs/UI.md
 * applies: green, amber and red mean a status (a verdict, a flag severity) and nothing else; a
 * zero count is neutral; the accent is for emphasis, not decoration.
 */

export const COLORS = {
  accent: '#4F46E5',
  accentSoft: '#EEF2FF',
  accentBorder: '#E0E7FF',
  ink: '#0F172A',
  ink700: '#334155',
  inkMuted: '#64748B',
  inkSubtle: '#94A3B8',
  surface: '#FFFFFF',
  surface2: '#FAFAFA',
  surface3: '#EEF0F4',
  line: '#E9ECF1',
  lineStrong: '#DFE3EA',
  pos: '#059669',
  posSoft: '#ECFDF5',
  warn: '#D97706',
  warnSoft: '#FFFBEB',
  neg: '#E11D48',
  negSoft: '#FFF1F2',
} as const

/** What a badge, tile or callout can mean. Only pos, warn and neg are statuses. */
export type Tone = 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'

export interface ToneColors {
  fg: string
  bg: string
  border: string
}

export const TONES: Record<Tone, ToneColors> = {
  neutral: { fg: COLORS.inkMuted, bg: COLORS.surface3, border: COLORS.line },
  accent: { fg: COLORS.accent, bg: COLORS.accentSoft, border: COLORS.accentBorder },
  pos: { fg: COLORS.pos, bg: COLORS.posSoft, border: '#A7F3D0' },
  warn: { fg: COLORS.warn, bg: COLORS.warnSoft, border: '#FDE68A' },
  neg: { fg: COLORS.neg, bg: COLORS.negSoft, border: '#FECDD3' },
}

/** Points (1pt = 1/72in). A4 is 595 x 842. The margin is 14mm, as the old reports used. */
export const PAGE = {
  margin: 40,
  /** Room kept free at the foot of every page for the fixed footer. */
  footerReserve: 36,
  width: 595,
} as const

export const FONT_FAMILY = {
  sans: 'Inter',
  deva: 'NotoSansDevanagari',
  mono: 'JetBrainsMono',
} as const

export const TYPE = {
  title: 20,
  subtitle: 11,
  section: 11,
  body: 10,
  small: 9,
  micro: 8,
} as const
