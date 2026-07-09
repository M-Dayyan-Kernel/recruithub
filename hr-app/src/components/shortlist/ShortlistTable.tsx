import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ShortlistResultWithCandidate } from '@/types/api'
import {
  HrDecisionBadge,
  RecommendationBadge,
  ScoreBadge,
} from '@/components/shortlist/shortlistBadges'
import { DECISION_CONFIG } from '@/components/shortlist/shortlistDecisionConfig'
import { ShortlistReportModal } from '@/components/shortlist/ShortlistReportModal'
import { useShortlistDecision } from '@/hooks/useShortlistDecision'
import { useDeleteCandidate } from '@/hooks/useDeleteCandidate'
import { WORKFLOW_CARD_CLASS, WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

interface Props {
  results: ShortlistResultWithCandidate[]
  jobId: string
  requiredSkills?: string[]
  jobTitle?: string
}

const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500'

function ShortlistTableRow({
  result,
  jobId,
  selected,
  onToggleSelect,
  onOpenReport,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
  selected: boolean
  onToggleSelect: () => void
  onOpenReport: (result: ShortlistResultWithCandidate) => void
}) {
  const decisionMutation = useShortlistDecision(jobId, result.id)
  const displayName = result.candidate_name ?? 'Candidate'

  return (
    <tr className={`hover:bg-slate-50/60 ${selected ? 'bg-indigo-50/40' : ''}`}>
      <td className="w-10 px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${displayName}`}
          checked={selected}
          onChange={onToggleSelect}
          className={CHECKBOX_CLASS}
        />
      </td>
      <td className="px-6 py-3 text-sm font-medium text-slate-800">{displayName}</td>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const deleteMutation = useDeleteCandidate(jobId)

  const sortedResults = useMemo(
    () => [...results].sort((a, b) => b.match_score - a.match_score),
    [results],
  )

  const visibleIds = useMemo(
    () => new Set(sortedResults.map((r) => r.candidate_id)),
    [sortedResults],
  )

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleIds])

  const selectedResults = sortedResults.filter((r) => selectedIds.has(r.candidate_id))
  const selectedCount = selectedResults.length
  const allSelected = sortedResults.length > 0 && selectedCount === sortedResults.length
  const someSelected = selectedCount > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedResults.map((r) => r.candidate_id)))
    }
  }

  const toggleOne = (candidateId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleDeleteSelected = async () => {
    if (selectedCount === 0) return

    const names = selectedResults.map((r) => r.candidate_name ?? 'Candidate')
    const message =
      selectedCount === 1
        ? `Remove ${names[0]}? This deletes the resume and all related shortlist data.`
        : `Remove ${selectedCount} candidates? This deletes their resumes and all related shortlist data.`

    if (!window.confirm(message)) return

    setDeleting(true)
    const ids = [...selectedIds]
    let failed = 0

    try {
      await Promise.all(
        ids.map((id) =>
          deleteMutation.mutateAsync(id).catch(() => {
            failed += 1
          }),
        ),
      )

      if (failed === 0) {
        toast.success(
          selectedCount === 1
            ? 'Resume removed'
            : `Removed ${selectedCount} candidates`,
        )
        if (reportResult && selectedIds.has(reportResult.candidate_id)) {
          setReportResult(null)
        }
        clearSelection()
      } else if (failed < ids.length) {
        toast.error(`Removed ${ids.length - failed}, but ${failed} failed`)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        })
      } else {
        toast.error('Failed to remove selected candidates')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
        <div
          className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 transition-colors ${
            selectedCount > 0 ? 'border-indigo-100 bg-indigo-50/60' : 'border-slate-100 bg-slate-50/50'
          }`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {selectedCount > 0 ? (
              <p className="text-sm font-medium text-indigo-900">
                {selectedCount} selected
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                Select candidates to remove
              </p>
            )}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
              >
                <X size={12} />
                Clear
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleDeleteSelected()}
            disabled={selectedCount === 0 || deleting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deleting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Removing…
              </>
            ) : (
              <>
                <Trash2 size={14} />
                {selectedCount === 0
                  ? 'Delete'
                  : selectedCount === 1
                    ? 'Delete selected'
                    : `Delete ${selectedCount}`}
              </>
            )}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all candidates"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleAll}
                    disabled={sortedResults.length === 0 || deleting}
                    className={CHECKBOX_CLASS}
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Name
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
                  selected={selectedIds.has(result.candidate_id)}
                  onToggleSelect={() => toggleOne(result.candidate_id)}
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
