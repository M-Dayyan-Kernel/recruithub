import { useMemo } from 'react'

/**
 * A donut gauge for a 0-100 value.
 *
 * Colour is derived from the value rather than passed in, so every gauge on the
 * page grades on the same scale and a reviewer can read them at a glance.
 */
/** Gradient stops per band, so the ring reads as light rather than paint. */
const BANDS = {
  good: ['#34d399', '#10b981'],
  mid: ['#fbbf24', '#f59e0b'],
  low: ['#fb7185', '#e11d48'],
} as const

let gradientSeq = 0

export default function RadialScore({
  value,
  max = 100,
  label,
  size = 84,
  stroke = 7,
}: {
  value: number | null | undefined
  max?: number
  label: string
  size?: number
  stroke?: number
}) {
  const pct = value == null || max <= 0 ? null : Math.min(100, Math.max(0, (value / max) * 100))

  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const dash = pct == null ? 0 : (pct / 100) * circumference

  const band = pct == null ? null : pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'low'
  // Gradients need a document-unique id; the counter survives re-renders.
  const gid = useMemo(() => `radial-${(gradientSeq += 1)}`, [])
  const stops = band ? BANDS[band] : null

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 overflow-visible">
          {stops && (
            <defs>
              <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={stops[0]} />
                <stop offset="100%" stopColor={stops[1]} />
              </linearGradient>
            </defs>
          )}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-slate-100"
          />
          {pct != null && pct > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              stroke={`url(#${gid})`}
              strokeDasharray={`${dash} ${circumference - dash}`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
              style={{ filter: `drop-shadow(0 0 5px ${stops?.[1]}55)` }}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-slate-800">
          {pct == null ? '—' : `${Math.round(pct)}%`}
        </span>
      </div>
      <p className="max-w-[9rem] text-[11px] font-medium leading-tight text-slate-500">{label}</p>
    </div>
  )
}
