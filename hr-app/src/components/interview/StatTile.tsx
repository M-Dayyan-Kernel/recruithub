import type { ReactNode } from 'react'

/**
 * A single headline figure.
 *
 * The icon chip is the saturated element and the card only carries a hint of
 * the same hue, so a row of tiles reads as one set rather than five competing
 * blocks. `muted` exists for a zero count: colouring "0 hard flags" would draw
 * the eye to the one tile with nothing to say.
 */

const TONES = {
  indigo: {
    chip: 'from-indigo-500 to-violet-600 shadow-indigo-500/35',
    wash: 'from-indigo-50/90 via-white to-white border-indigo-100/80',
    glow: 'bg-indigo-400/20',
  },
  violet: {
    chip: 'from-violet-500 to-fuchsia-600 shadow-violet-500/35',
    wash: 'from-violet-50/90 via-white to-white border-violet-100/80',
    glow: 'bg-violet-400/20',
  },
  sky: {
    chip: 'from-sky-500 to-indigo-500 shadow-sky-500/35',
    wash: 'from-sky-50/90 via-white to-white border-sky-100/80',
    glow: 'bg-sky-400/20',
  },
  teal: {
    chip: 'from-teal-500 to-emerald-600 shadow-teal-500/35',
    wash: 'from-teal-50/90 via-white to-white border-teal-100/80',
    glow: 'bg-teal-400/20',
  },
  amber: {
    chip: 'from-amber-400 to-orange-500 shadow-amber-500/35',
    wash: 'from-amber-50/90 via-white to-white border-amber-100/80',
    glow: 'bg-amber-400/25',
  },
  rose: {
    chip: 'from-rose-500 to-pink-600 shadow-rose-500/35',
    wash: 'from-rose-50/90 via-white to-white border-rose-100/80',
    glow: 'bg-rose-400/20',
  },
  muted: {
    chip: 'from-slate-300 to-slate-400 shadow-slate-400/25',
    wash: 'from-slate-50 via-white to-white border-slate-100',
    glow: 'bg-slate-300/20',
  },
} as const

export type StatTone = keyof typeof TONES

export default function StatTile({
  icon,
  label,
  value,
  tone = 'indigo',
  mono,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  tone?: StatTone
  /** For clock values, so digits do not jitter. */
  mono?: boolean
}) {
  const t = TONES[tone]

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-10px_rgba(15,23,42,0.22)] ${t.wash}`}
    >
      {/* Corner bloom, brightening on hover */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${t.glow} opacity-60`}
      />

      <div className="relative flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${t.chip}`}
        >
          {icon}
        </span>

        <span className="min-w-0">
          <span
            className={`block text-[19px] font-extrabold leading-tight tracking-tight text-slate-900 ${
              mono ? 'font-mono text-[17px]' : ''
            }`}
          >
            {value}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </span>
        </span>
      </div>
    </div>
  )
}
