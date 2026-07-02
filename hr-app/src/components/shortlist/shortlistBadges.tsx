import type { HrDecision, ShortlistResultWithCandidate } from '@/types/api'

export function ScoreBadge({ score, compact = false }: { score: number; compact?: boolean }) {
  const className =
    score >= 70
      ? 'bg-emerald-100 text-emerald-700'
      : score >= 50
        ? 'bg-amber-100 text-amber-700'
        : 'bg-rose-100 text-rose-700'
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold ${className} ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {Math.round(score)}%
    </span>
  )
}

const REC_CONFIG = {
  shortlisted: { label: 'Pass', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Fail', className: 'bg-rose-100 text-rose-700' },
  review: { label: 'Review', className: 'bg-amber-100 text-amber-700' },
} as const

export function RecommendationBadge({
  rec,
  compact = false,
}: {
  rec: ShortlistResultWithCandidate['recommendation']
  compact?: boolean
}) {
  const cfg = REC_CONFIG[rec as keyof typeof REC_CONFIG]
  if (!cfg) return null
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${cfg.className} ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {cfg.label}
    </span>
  )
}

const HR_DECISION_LABEL: Record<Exclude<HrDecision, 'pending'>, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  overridden: 'Overridden',
}

export function HrDecisionBadge({ decision }: { decision: Exclude<HrDecision, 'pending'> }) {
  const className =
    decision === 'approved'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : decision === 'rejected'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {HR_DECISION_LABEL[decision]}
    </span>
  )
}
