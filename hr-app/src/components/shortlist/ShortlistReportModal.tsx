import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { ShortlistResultWithCandidate } from '@/types/api'
import { ShortlistReportContent } from '@/components/shortlist/ShortlistReportContent'
import { ShortlistReportActions } from '@/components/shortlist/ShortlistReportActions'
import {
  HrDecisionBadge,
  RecommendationBadge,
  ScoreBadge,
} from '@/components/shortlist/shortlistBadges'

interface Props {
  result: ShortlistResultWithCandidate
  requiredSkills: string[]
  jobTitle?: string
  onClose: () => void
}

export function ShortlistReportModal({
  result,
  requiredSkills,
  jobTitle,
  onClose,
}: Props) {
  const displayName = result.candidate_name ?? 'Candidate'
  const displayEmail = result.candidate_email

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortlist-report-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="shortlist-report-title" className="truncate text-lg font-semibold text-slate-900">
              {displayName}
            </h2>
            {displayEmail && <p className="truncate text-sm text-slate-500">{displayEmail}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {result.hr_decision !== 'pending' && (
                <HrDecisionBadge decision={result.hr_decision} />
              )}
              <ScoreBadge score={result.match_score} />
              <RecommendationBadge rec={result.recommendation} />
            </div>
            <div className="mt-3">
              <ShortlistReportActions
                result={result}
                requiredSkills={requiredSkills}
                jobTitle={jobTitle}
                layout="compact"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close report"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ShortlistReportContent result={result} requiredSkills={requiredSkills} />
        </div>
      </div>
    </div>
  )
}
