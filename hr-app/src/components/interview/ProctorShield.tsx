/**
 * The integrity shield.
 *
 * A filled, gradient-lit crest rather than a stroked outline icon: the body
 * carries a two-stop gradient, a gloss sweep lifts the top half, an inner rim
 * suggests a bevel, and the whole mark sits in its own coloured glow. Stock
 * icon sets only ship the outline, so this is drawn here.
 */

const TONES = {
  danger: {
    from: '#fb7185',
    to: '#be123c',
    glow: 'rgba(225,29,72,0.45)',
  },
  warn: {
    from: '#fbbf24',
    to: '#d97706',
    glow: 'rgba(217,119,6,0.42)',
  },
  ok: {
    from: '#34d399',
    to: '#059669',
    glow: 'rgba(5,150,105,0.42)',
  },
} as const

export type ShieldTone = keyof typeof TONES

/** Verdict glyphs, drawn on the crest. */
const GLYPHS: Record<ShieldTone, string> = {
  danger: 'M19.6 19.6 L28.4 28.4 M28.4 19.6 L19.6 28.4',
  warn: 'M24 16.5 V26 M24 31.2 V31.3',
  ok: 'M18.5 24.3 L22.4 28.2 L29.8 20.8',
}

const SHIELD =
  'M24 4.2 L40.4 10.3 C40.4 10.3 40.4 22.4 40.4 24.6 C40.4 33.9 33.6 40.9 24 44.2 C14.4 40.9 7.6 33.9 7.6 24.6 C7.6 22.4 7.6 10.3 7.6 10.3 Z'

let seq = 0

export default function ProctorShield({
  tone = 'ok',
  size = 44,
}: {
  tone?: ShieldTone
  size?: number
}) {
  const t = TONES[tone]
  // Gradient ids must be document-unique or the defs cross-wire between marks.
  const uid = `shield-${(seq += 1)}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="overflow-visible"
      style={{ filter: `drop-shadow(0 4px 10px ${t.glow})` }}
    >
      <defs>
        <linearGradient id={`${uid}-body`} x1="12" y1="4" x2="38" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={t.from} />
          <stop offset="100%" stopColor={t.to} />
        </linearGradient>

        {/* Gloss sweep across the upper half */}
        <linearGradient id={`${uid}-gloss`} x1="10" y1="4" x2="30" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Body */}
      <path d={SHIELD} fill={`url(#${uid}-body)`} />

      {/* Gloss, clipped to the crest */}
      <path d={SHIELD} fill={`url(#${uid}-gloss)`} />

      {/* Bevelled inner rim */}
      <path
        d={SHIELD}
        stroke="#fff"
        strokeOpacity="0.45"
        strokeWidth="1.1"
        fill="none"
      />

      {/* Verdict glyph */}
      <path
        d={GLYPHS[tone]}
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
