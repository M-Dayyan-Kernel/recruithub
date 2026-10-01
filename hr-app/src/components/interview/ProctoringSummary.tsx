import { AlertTriangle, Clock, Eye, Film, Loader2, ShieldAlert } from 'lucide-react'
import ProctorShield, { type ShieldTone } from '@/components/interview/ProctorShield'
import type { VideoProctoringSummary } from '@/types/api'

/**
 * The integrity verdict for a recording.
 *
 * `score` is an integrity score, so low is bad - the inverse of the interview
 * score right next to it on the page. The wording is chosen to keep those two
 * from being read the same way.
 */

const BREAKDOWN_LABELS: Record<string, string> = {
  face: 'Face',
  gaze: 'Gaze',
  objects: 'Objects',
  audio: 'Audio',
}

/** One tint per detector family, so the chips are scannable. */
const BREAKDOWN_TINTS: Record<string, string> = {
  face: 'bg-gradient-to-r from-rose-50 to-white text-rose-700 ring-rose-100',
  gaze: 'bg-gradient-to-r from-amber-50 to-white text-amber-700 ring-amber-100',
  objects: 'bg-gradient-to-r from-violet-50 to-white text-violet-700 ring-violet-100',
  audio: 'bg-gradient-to-r from-sky-50 to-white text-sky-700 ring-sky-100',
}

function tone(
  score: number | null | undefined,
  hardCount: number,
): { shield: ShieldTone; ring: string; chip: string; bar: string } {
  if (hardCount > 0 || (score != null && score < 40)) {
    return {
      shield: 'danger',
      ring: 'bg-gradient-to-br from-rose-50 to-white ring-1 ring-rose-100',
      chip: 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/30 border-transparent',
      bar: 'bg-gradient-to-r from-rose-400 to-rose-500',
    }
  }
  if (score != null && score < 75) {
    return {
      shield: 'warn',
      ring: 'bg-gradient-to-br from-amber-50 to-white ring-1 ring-amber-100',
      chip: 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30 border-transparent',
      bar: 'bg-gradient-to-r from-amber-400 to-amber-500',
    }
  }
  return {
    shield: 'ok',
    ring: 'bg-gradient-to-br from-emerald-50 to-white ring-1 ring-emerald-100',
    chip: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30 border-transparent',
    bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
  }
}

export default function ProctoringSummary({
  proctoring,
  hardCount,
  softCount,
}: {
  proctoring: VideoProctoringSummary
  hardCount: number
  softCount: number
}) {
  if (proctoring.status !== 'succeeded') {
    const failed = proctoring.status === 'failed'
    return (
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_10px_30px_-12px_rgba(15,23,42,0.12)] p-5">
        <div className="flex items-center gap-3">
          {failed ? (
            <AlertTriangle size={18} className="shrink-0 text-amber-500" />
          ) : (
            <Loader2 size={18} className="shrink-0 animate-spin text-slate-400" />
          )}
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {failed ? 'Video analysis failed' : 'Video analysis in progress'}
            </p>
            <p className="text-xs text-slate-500">
              {proctoring.error ??
                (failed
                  ? 'The recording could not be analysed.'
                  : 'Detections will appear on the timeline once this finishes.')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const r = proctoring.result ?? {}
  const score = r.score ?? null
  const { shield, ring, chip, bar } = tone(score, hardCount)
  const breakdown = Object.entries(
    (r.breakdown ?? {}) as Record<string, number>,
  ).filter(([, v]) => v > 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_10px_30px_-12px_rgba(15,23,42,0.12)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${ring}`}
          >
            <ProctorShield tone={shield} size={34} />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Interview integrity
            </p>
            <p className="text-lg font-semibold text-slate-900">
              {r.verdict ?? 'No verdict'}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ring-white/25 ${chip}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
          {r.flag_count ?? hardCount + softCount} detection
          {(r.flag_count ?? hardCount + softCount) === 1 ? '' : 's'}
        </span>
      </div>

      {score != null && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-slate-500">Integrity score</span>
            <span className="text-sm font-semibold text-slate-800">{score}/100</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full transition-all ${bar}`}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Lower means more integrity concerns were detected.
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<ShieldAlert size={15} />}
          tone={hardCount > 0 ? 'rose' : 'slate'}
          label="Hard flags"
          value={hardCount}
        />
        <Stat
          icon={<Eye size={15} />}
          tone={softCount > 0 ? 'amber' : 'slate'}
          label="Soft flags"
          value={softCount}
        />
        {r.duration && (
          <Stat icon={<Clock size={15} />} tone="sky" label="Duration" value={r.duration} mono />
        )}
        {r.frame_count != null && (
          <Stat
            icon={<Film size={15} />}
            tone="violet"
            label="Frames"
            value={r.frame_count.toLocaleString()}
          />
        )}
      </div>

      {breakdown.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {breakdown.map(([k, v]) => (
            <span
              key={k}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                BREAKDOWN_TINTS[k] ??
                'bg-gradient-to-r from-slate-50 to-white text-slate-600 ring-slate-100'
              }`}
            >
              {BREAKDOWN_LABELS[k] ?? k}
              <span className="rounded-full bg-white/80 px-1.5 text-[11px] font-bold">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const STAT_TONES = {
  rose: {
    wash: 'from-rose-50 via-rose-50/40 to-white border-rose-100',
    chip: 'from-rose-400 to-pink-500 shadow-rose-500/25',
    value: 'text-rose-700',
  },
  amber: {
    wash: 'from-amber-50 via-amber-50/40 to-white border-amber-100',
    chip: 'from-amber-400 to-orange-500 shadow-amber-500/25',
    value: 'text-amber-700',
  },
  sky: {
    wash: 'from-sky-50 via-sky-50/40 to-white border-sky-100',
    chip: 'from-sky-400 to-indigo-500 shadow-sky-500/25',
    value: 'text-slate-800',
  },
  violet: {
    wash: 'from-violet-50 via-violet-50/40 to-white border-violet-100',
    chip: 'from-violet-400 to-fuchsia-500 shadow-violet-500/25',
    value: 'text-slate-800',
  },
  /** Used when a count is zero - nothing to draw attention to. */
  slate: {
    wash: 'from-slate-50 via-slate-50/40 to-white border-slate-100',
    chip: 'from-slate-300 to-slate-400 shadow-slate-400/20',
    value: 'text-slate-500',
  },
} as const

function Stat({
  icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  tone: keyof typeof STAT_TONES
  mono?: boolean
}) {
  const t = STAT_TONES[tone]
  return (
    <div
      className={`rounded-xl border bg-gradient-to-br px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${t.wash}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-md ${t.chip}`}
        >
          {icon}
        </span>
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
      </div>
      <p
        className={`mt-1.5 text-lg font-bold ${t.value} ${mono ? 'font-mono text-base' : ''}`}
      >
        {value}
      </p>
    </div>
  )
}
