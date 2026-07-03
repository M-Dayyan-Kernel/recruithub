import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { HrDecision, ShortlistResultWithCandidate } from '@/types/api'
import { SkillMatchMatrix } from '@/components/shortlist/SkillMatchMatrix'
import {
  HrDecisionBadge,
  RecommendationBadge,
  ScoreBadge,
} from '@/components/shortlist/shortlistBadges'

const REASON_TRUNCATE_LENGTH = 160

const DECISION_CONFIG: Record<
  Exclude<HrDecision, 'pending'>,
  { label: string; active: string; inactive: string }
> = {
  approved: {
    label: 'Approve',
    active: 'bg-emerald-600 text-white border-emerald-600',
    inactive:
      'border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600',
  },
  rejected: {
    label: 'Reject',
    active: 'bg-rose-600 text-white border-rose-600',
    inactive: 'border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600',
  },
  overridden: {
    label: 'Override',
    active: 'bg-amber-500 text-white border-amber-500',
    inactive:
      'border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600',
  },
}

interface Props {
  result: ShortlistResultWithCandidate
  jobId: string
  requiredSkills: string[]
}

export function ShortlistCandidateDetail({ result, jobId, requiredSkills }: Props) {
  const queryClient = useQueryClient()
  const [reasonExpanded, setReasonExpanded] = useState(false)

  const displayName = result.candidate_name ?? 'Candidate'
  const displayEmail = result.candidate_email
  const strengths = result.strengths ?? []
  const gaps = result.gaps ?? []

  const isLongReason = result.reason.length > REASON_TRUNCATE_LENGTH
  const reasonText =
    reasonExpanded || !isLongReason
      ? result.reason
      : result.reason.slice(0, REASON_TRUNCATE_LENGTH) + '…'

  const decisionMutation = useMutation<unknown, Error, Exclude<HrDecision, 'pending'>>({
    mutationFn: (hr_decision) =>
      api.patch(`/api/shortlist/${result.id}/decision`, { hr_decision }),
    onMutate: async (hr_decision) => {
      await queryClient.cancelQueries({ queryKey: ['shortlist', jobId] })
      const previous = queryClient.getQueryData<ShortlistResultWithCandidate[]>([
        'shortlist',
        jobId,
      ])
      queryClient.setQueryData<ShortlistResultWithCandidate[]>(
        ['shortlist', jobId],
        (old) => (old ? old.map((r) => (r.id === result.id ? { ...r, hr_decision } : r)) : old),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: ShortlistResultWithCandidate[] } | undefined
      if (ctx?.previous) {
        queryClient.setQueryData(['shortlist', jobId], ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/candidates/${result.candidate_id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      toast.success('Resume removed')
    },
    onError: () => toast.error('Failed to remove resume'),
  })

  const handleDelete = () => {
    if (window.confirm(`Remove ${displayName}?`)) {
      deleteMutation.mutate()
    }
  }

  const visibleDecisions: Exclude<HrDecision, 'pending'>[] = ['approved', 'rejected']

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold uppercase text-indigo-600">
            {displayName[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-slate-900">{displayName}</p>
            {displayEmail && (
              <p className="truncate text-sm text-slate-500">{displayEmail}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result.hr_decision !== 'pending' && (
            <HrDecisionBadge decision={result.hr_decision} />
          )}
          <ScoreBadge score={result.match_score} />
          <RecommendationBadge rec={result.recommendation} />
        </div>
      </div>

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

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {visibleDecisions.map((decision) => {
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteMutation.isPending || decisionMutation.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleteMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} />
          )}
          Delete
        </button>
      </div>

      {decisionMutation.isError && (
        <p className="flex items-center gap-1 text-xs text-rose-600">
          <AlertCircle size={11} />
          Failed to update decision. Please try again.
        </p>
      )}
    </div>
  )
}
