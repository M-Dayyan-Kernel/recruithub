import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ShortlistResultWithCandidate } from '@/types/api'
import { SkillMatchMatrix } from '@/components/shortlist/SkillMatchMatrix'

const REASON_TRUNCATE_LENGTH = 160

interface Props {
  result: ShortlistResultWithCandidate
  requiredSkills: string[]
}

export function ShortlistReportContent({ result, requiredSkills }: Props) {
  const [reasonExpanded, setReasonExpanded] = useState(false)

  const strengths = result.strengths ?? []
  const gaps = result.gaps ?? []

  const isLongReason = result.reason.length > REASON_TRUNCATE_LENGTH
  const reasonText =
    reasonExpanded || !isLongReason
      ? result.reason
      : result.reason.slice(0, REASON_TRUNCATE_LENGTH) + '…'

  return (
    <div className="space-y-5">
      <SkillMatchMatrix
        requiredSkills={requiredSkills}
        strengths={strengths}
        gaps={gaps}
      />

      {(strengths.length > 0 || gaps.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">Strengths</p>
              <div className="flex flex-wrap gap-1.5">
                {strengths.map((item, index) => (
                  <span
                    key={index}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">Gaps</p>
              <div className="flex flex-wrap gap-1.5">
                {gaps.map((item, index) => (
                  <span
                    key={index}
                    className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result.reason && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-slate-500">AI Assessment</p>
          <p className="text-sm leading-relaxed text-slate-600">{reasonText}</p>
          {isLongReason && (
            <button
              type="button"
              onClick={() => setReasonExpanded((value) => !value)}
              className="mt-1 flex items-center gap-0.5 text-xs text-indigo-600 transition-colors hover:text-indigo-800"
            >
              {reasonExpanded ? (
                <>
                  Show less <ChevronUp size={11} />
                </>
              ) : (
                <>
                  Show more <ChevronDown size={11} />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
