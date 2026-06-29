import { cn } from '@/lib/utils'

interface ScoreBarProps {
  label: string
  score: number
  max?: number
  className?: string
}

export function ScoreBar({ label, score, max = 10, className }: ScoreBarProps) {
  const pct = (score / max) * 100
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="w-36 text-sm text-slate-600 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-sm font-semibold text-slate-700">{score}/{max}</span>
    </div>
  )
}

interface OverallScoreProps {
  score: number
  recommendation?: string
}

export function OverallScore({ score, recommendation }: OverallScoreProps) {
  const color =
    score >= 80
      ? 'text-emerald-600 border-emerald-300 bg-emerald-50'
      : score >= 60
      ? 'text-amber-600 border-amber-300 bg-amber-50'
      : 'text-rose-600 border-rose-300 bg-rose-50'

  const recColor =
    recommendation === 'Strong Hire'
      ? 'bg-emerald-100 text-emerald-800'
      : recommendation === 'Consider'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-rose-100 text-rose-800'

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          'w-28 h-28 rounded-full border-4 flex items-center justify-center',
          color,
        )}
      >
        <div className="text-center">
          <div className="text-3xl font-bold leading-none">{score}</div>
          <div className="text-xs mt-1 opacity-70">/ 100</div>
        </div>
      </div>
      {recommendation && (
        <span className={cn('px-3 py-1 rounded-full text-sm font-semibold', recColor)}>
          {recommendation}
        </span>
      )}
    </div>
  )
}
