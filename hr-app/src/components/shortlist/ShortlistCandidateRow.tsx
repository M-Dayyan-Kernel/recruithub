import type { HrDecision, ShortlistResultWithCandidate } from '@/types/api'
import { ScoreBadge, RecommendationBadge } from '@/components/shortlist/shortlistBadges'

interface Props {
  result: ShortlistResultWithCandidate
  rank: number
  isSelected: boolean
  onSelect: () => void
}

const HR_DECISION_LABEL: Record<Exclude<HrDecision, 'pending'>, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  overridden: 'Overridden',
}

const HR_DECISION_CLASS: Record<Exclude<HrDecision, 'pending'>, string> = {
  approved: 'text-emerald-700',
  rejected: 'text-rose-700',
  overridden: 'text-amber-700',
}

function HrDecisionLabel({ decision }: { decision: Exclude<HrDecision, 'pending'> }) {
  return (
    <span className={`text-[10px] font-medium ${HR_DECISION_CLASS[decision]}`}>
      {HR_DECISION_LABEL[decision]}
    </span>
  )
}

export function ShortlistCandidateRow({ result, rank, isSelected, onSelect }: Props) {
  const displayName = result.candidate_name ?? 'Candidate'

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`w-full border-b border-slate-200 px-3 py-2 text-left transition-colors ${
        isSelected
          ? 'border-l-2 border-l-indigo-600 bg-indigo-50/70'
          : 'border-l-2 border-l-transparent hover:bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-[10px] font-semibold text-slate-400">#{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-slate-800">{displayName}</p>
            <ScoreBadge score={result.match_score} compact />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <RecommendationBadge rec={result.recommendation} compact />
            {result.hr_decision !== 'pending' && (
              <HrDecisionLabel decision={result.hr_decision} />
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
