import { useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ShortlistResultWithCandidate } from '@/types/api'
import {
  HrDecisionBadge,
  RecommendationBadge,
  ScoreBadge,
} from '@/components/shortlist/shortlistBadges'
import { DECISION_CONFIG } from '@/components/shortlist/shortlistDecisionConfig'
import { ShortlistReportModal } from '@/components/shortlist/ShortlistReportModal'
import { useShortlistDecision } from '@/hooks/useShortlistDecision'
import { WORKFLOW_CARD_CLASS, WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

interface Props {
  results: ShortlistResultWithCandidate[]
  jobId: string
  requiredSkills?: string[]
  jobTitle?: string
}

function ShortlistTableRow({
  result,
  jobId,
  onOpenReport,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
  onOpenReport: (result: ShortlistResultWithCandidate) => void
}) {
  const decisionMutation = useShortlistDecision(jobId, result.id)
  const displayName = result.candidate_name ?? 'Candidate'
  const displayEmail = result.candidate_email ?? '—'

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-6 py-3 text-sm font-medium text-slate-800">{displayName}</td>
      <td className="px-6 py-3 text-sm text-slate-600">{displayEmail}</td>
      <td className="px-6 py-3">
        <ScoreBadge score={result.match_score} />
      </td>
      <td className="px-6 py-3">
        <RecommendationBadge rec={result.recommendation} />
      </td>
      <td className="px-6 py-3">
        {result.hr_decision === 'pending' ? (
          <span className="text-xs text-slate-400">Pending</span>
        ) : (
          <HrDecisionBadge decision={result.hr_decision} />
        )}
      </td>
      <td className="px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenReport(result)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600"
          >
            Report
          </button>
          {(['approved', 'rejected'] as const).map((decision) => {
            const cfg = DECISION_CONFIG[decision]
            const isActive = result.hr_decision === decision
            return (
              <button
                key={decision}
                type="button"
                onClick={() => decisionMutation.mutate(decision)}
                disabled={decisionMutation.isPending}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive ? cfg.active : cfg.inactive
                }`}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>
        {decisionMutation.isError && (
          <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
            <AlertCircle size={11} />
            Failed to update
          </p>
        )}
      </td>
    </tr>
  )
}

export function ShortlistTable({ results, jobId, requiredSkills = [], jobTitle }: Props) {
  const [reportResult, setReportResult] = useState<ShortlistResultWithCandidate | null>(null)

  const sortedResults = useMemo(
    () => [...results].sort((a, b) => b.match_score - a.match_score),
    [results],
  )

  return (
    <>
      <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
        <div className="overflow-x-auto">
          <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Match Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  AI Recommendation
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  HR Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {sortedResults.map((result) => (
                <ShortlistTableRow
                  key={result.id}
                  result={result}
                  jobId={jobId}
                  onOpenReport={setReportResult}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {reportResult && (
        <ShortlistReportModal
          result={reportResult}
          requiredSkills={requiredSkills}
          jobTitle={jobTitle}
          onClose={() => setReportResult(null)}
        />
      )}
    </>
  )
}
