import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Loader2,
  Users,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ShortlistResultWithCandidate, HrDecision } from '@/types/api'
import { BackendError } from '@/components/BackendError'

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const className =
    score >= 70
      ? 'bg-emerald-100 text-emerald-700'
      : score >= 50
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700'
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${className}`}>
      {Math.round(score)}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// Recommendation badge
// ---------------------------------------------------------------------------

const REC_CONFIG = {
  shortlisted: { label: 'Shortlisted', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', className: 'bg-rose-100 text-rose-700' },
  review: { label: 'Needs Review', className: 'bg-amber-100 text-amber-700' },
} as const

function RecommendationBadge({ rec }: { rec: ShortlistResultWithCandidate['recommendation'] }) {
  const cfg = REC_CONFIG[rec]
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

const HR_DECISION_LABEL: Record<Exclude<HrDecision, 'pending'>, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  overridden: 'Overridden',
}

function HrDecisionBadge({ decision }: { decision: Exclude<HrDecision, 'pending'> }) {
  const className =
    decision === 'approved'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : decision === 'rejected'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {HR_DECISION_LABEL[decision]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function ShortlistCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3.5 bg-slate-200 rounded w-32" />
            <div className="h-2.5 bg-slate-100 rounded w-24" />
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="h-6 w-12 bg-slate-200 rounded-full" />
          <div className="h-6 w-20 bg-slate-100 rounded-full" />
        </div>
      </div>
      <div className="mb-2.5 space-y-1.5">
        <div className="h-2.5 bg-slate-100 rounded w-16 mb-1" />
        <div className="flex gap-1.5">
          <div className="h-5 w-20 bg-slate-100 rounded-full" />
          <div className="h-5 w-24 bg-slate-100 rounded-full" />
        </div>
      </div>
      <div className="mb-3 space-y-1.5">
        <div className="h-2.5 bg-slate-100 rounded w-3/4" />
        <div className="h-2.5 bg-slate-100 rounded w-1/2" />
      </div>
      <div className="flex gap-2">
        <div className="h-7 w-20 bg-slate-100 rounded-lg" />
        <div className="h-7 w-16 bg-slate-100 rounded-lg" />
        <div className="h-7 w-20 bg-slate-100 rounded-lg" />
        <div className="h-7 w-28 bg-slate-100 rounded-lg ml-auto" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shortlist card
// ---------------------------------------------------------------------------

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

const FEEDBACK_TYPES = [
  { value: 'correctly_shortlisted', label: 'Correctly shortlisted' },
  { value: 'incorrectly_shortlisted', label: 'Incorrectly shortlisted' },
  { value: 'correctly_rejected', label: 'Correctly rejected' },
  { value: 'incorrectly_rejected', label: 'Incorrectly rejected' },
] as const

const REASON_TRUNCATE_LENGTH = 160
const SHORTLIST_EMPTY_STATE_CLASS = 'flex min-h-[360px] flex-col items-center justify-center px-6 text-center'
const SHORTLIST_SEARCH_CLASS =
  'h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'

type DecisionActionsMode = 'none' | 'approveReject' | 'full'

function ShortlistCard({
  result,
  jobId,
  readOnly = false,
  decisionActions,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
  readOnly?: boolean
  decisionActions?: DecisionActionsMode
}) {
  const actionsMode: DecisionActionsMode =
    decisionActions ?? (readOnly ? 'none' : 'full')
  const visibleDecisions: Exclude<HrDecision, 'pending'>[] =
    actionsMode === 'approveReject'
      ? ['approved', 'rejected']
      : actionsMode === 'full'
        ? ['approved', 'rejected', 'overridden']
        : []
  const showDecisionButtons = visibleDecisions.length > 0
  const showFeedback = actionsMode === 'full'
  const queryClient = useQueryClient()
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false)
  const [feedbackType, setFeedbackType] = useState<string>('correctly_shortlisted')
  const [feedbackComments, setFeedbackComments] = useState('')
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [reasonExpanded, setReasonExpanded] = useState(false)
  const [showAllStrengths, setShowAllStrengths] = useState(false)
  const [showAllGaps, setShowAllGaps] = useState(false)

  const isLongReason = result.reason.length > REASON_TRUNCATE_LENGTH
  const reasonText =
    reasonExpanded || !isLongReason
      ? result.reason
      : result.reason.slice(0, REASON_TRUNCATE_LENGTH) + '…'

  const strengths = result.strengths ?? []
  const gaps = result.gaps ?? []
  const displayStrengths = showAllStrengths ? strengths : strengths.slice(0, 3)
  const hasMoreStrengths = strengths.length > 3
  const displayGaps = showAllGaps ? gaps : gaps.slice(0, 3)
  const hasMoreGaps = gaps.length > 3

  // Decision mutation (optimistic update)
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

  // Feedback mutation
  const feedbackMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/shortlist/${result.id}/feedback`, {
        hr_feedback_type: feedbackType,
        hr_comments: feedbackComments.trim() || null,
      }),
    onSuccess: () => {
      setFeedbackDone(true)
      setTimeout(() => {
        setShowFeedbackPanel(false)
        setFeedbackDone(false)
        setFeedbackComments('')
      }, 2000)
    },
  })

  const displayName = result.candidate_name ?? 'Candidate'
  const displayEmail = result.candidate_email

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0 uppercase">
            {displayName[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{displayName}</p>
            {displayEmail && (
              <p className="text-xs text-slate-400 truncate mt-0.5">{displayEmail}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {result.hr_decision !== 'pending' && (
            <HrDecisionBadge decision={result.hr_decision} />
          )}
          <ScoreBadge score={result.match_score} />
          <RecommendationBadge rec={result.recommendation} />
        </div>
      </div>

      {/* Strengths */}
      {displayStrengths.length > 0 && (
        <div className="mb-2.5">
          <p className="mb-1 text-xs font-medium text-slate-500">Strengths</p>
          <div className="flex flex-wrap gap-1.5">
            {displayStrengths.map((s, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs"
              >
                {s}
              </span>
            ))}
          </div>
          {hasMoreStrengths && (
            <button
              onClick={() => setShowAllStrengths(v => !v)}
              className="text-xs text-slate-500 hover:text-slate-700 mt-1"
            >
              {showAllStrengths ? '− Show less' : `+ ${result.strengths.length - 3} more`}
            </button>
          )}
        </div>
      )}

      {/* Gaps */}
      {displayGaps.length > 0 && (
        <div className="mb-2.5">
          <p className="mb-1 text-xs font-medium text-slate-500">Gaps</p>
          <div className="flex flex-wrap gap-1.5">
            {displayGaps.map((g, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs"
              >
                {g}
              </span>
            ))}
          </div>
          {hasMoreGaps && (
            <button
              onClick={() => setShowAllGaps(v => !v)}
              className="text-xs text-slate-500 hover:text-slate-700 mt-1"
            >
              {showAllGaps ? '− Show less' : `+ ${result.gaps.length - 3} more`}
            </button>
          )}
        </div>
      )}

      {/* Reason */}
      {result.reason && (
        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-slate-500">AI Assessment</p>
          <p className="text-sm leading-relaxed text-slate-600">{reasonText}</p>
          {isLongReason && (
            <button
              onClick={() => setReasonExpanded((v) => !v)}
              className="mt-1 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 transition-colors"
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

      {showDecisionButtons && (
        <>
          {/* HR Decision buttons + optional feedback trigger */}
          <div className="flex items-center gap-2 flex-wrap">
            {visibleDecisions.map((decision) => {
              const cfg = DECISION_CONFIG[decision]
              const isActive = result.hr_decision === decision
              return (
                <button
                  key={decision}
                  onClick={() => decisionMutation.mutate(decision)}
                  disabled={decisionMutation.isPending}
                  className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isActive ? cfg.active : cfg.inactive
                  }`}
                >
                  {cfg.label}
                </button>
              )
            })}
            {showFeedback && (
              <button
                onClick={() => {
                  setShowFeedbackPanel((v) => !v)
                  setFeedbackDone(false)
                }}
                className="ml-auto px-3 py-1.5 border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 rounded-lg text-xs font-medium transition-colors"
              >
                Give Feedback
              </button>
            )}
          </div>

          {/* Decision error */}
          {decisionMutation.isError && (
            <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
              <AlertCircle size={11} />
              Failed to update decision. Please try again.
            </p>
          )}

          {/* Inline feedback form */}
          {showFeedback && showFeedbackPanel && (
            <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Feedback Type
                </label>
                <select
                  value={feedbackType}
                  onChange={(e) => setFeedbackType(e.target.value)}
                  disabled={feedbackMutation.isPending || feedbackDone}
                  aria-label="Feedback Type"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                >
                  {FEEDBACK_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Comments <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={feedbackComments}
                  onChange={(e) => setFeedbackComments(e.target.value)}
                  rows={2}
                  placeholder="Any additional context…"
                  disabled={feedbackMutation.isPending || feedbackDone}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none disabled:opacity-50"
                />
              </div>

              {feedbackDone ? (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle size={12} />
                  Feedback submitted!
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => feedbackMutation.mutate()}
                    disabled={feedbackMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {feedbackMutation.isPending && (
                      <Loader2 size={10} className="animate-spin" />
                    )}
                    Submit Feedback
                  </button>
                  <button
                    onClick={() => setShowFeedbackPanel(false)}
                    className="px-3 py-1.5 border border-slate-200 text-slate-500 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {feedbackMutation.isError && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle size={11} />
                  Failed to submit feedback. Please try again.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ShortlistTab
// ---------------------------------------------------------------------------

interface Props {
  jobId: string
  /** True while the Celery shortlisting task is known to be running */
  shortlistTriggered: boolean
  /** Called when results arrive — lets parent clear shortlistTriggered */
  onShortlistComplete: () => void
  /** Called when the user clicks "Go to Candidates tab" in the empty state */
  onSwitchToCandidates: () => void
  mode?: 'default' | 'aiShortlisted'
}

export function ShortlistTab({
  jobId,
  shortlistTriggered,
  onShortlistComplete,
  onSwitchToCandidates,
  mode = 'default',
}: Props) {
  const isAiShortlistedMode = mode === 'aiShortlisted'
  const [search, setSearch] = useState('')

  const { data: results, isLoading, isFetching, isError, refetch } = useQuery<
    ShortlistResultWithCandidate[]
  >({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<
        ShortlistResultWithCandidate[]
      >,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data
      // Poll every 3 s while the Celery task is running but results haven't arrived yet
      if (shortlistTriggered && (!data || data.length === 0)) return 3000
      return false
    },
  })

  // When results finally arrive, notify parent so it can reset shortlistTriggered (default mode only)
  useEffect(() => {
    if (!isAiShortlistedMode && shortlistTriggered && results && results.length > 0) {
      onShortlistComplete()
    }
  }, [isAiShortlistedMode, shortlistTriggered, results, onShortlistComplete])

  const hasResults = results && results.length > 0
  const isInProgress = shortlistTriggered && !hasResults
  const scoredResults = results ?? []
  const normalizedSearch = search.trim().toLowerCase()
  const filteredScored = scoredResults.filter((r) => {
    if (!normalizedSearch) return true
    const name = (r.candidate_name ?? '').toLowerCase()
    const email = (r.candidate_email ?? '').toLowerCase()
    return name.includes(normalizedSearch) || email.includes(normalizedSearch)
  })

  // Bulk action state (default mode only)
  const queryClient = useQueryClient()
  const [approvingAll, setApprovingAll] = useState(false)
  const [rejectingAll, setRejectingAll] = useState(false)

  const aiShortlistedHeader = (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold text-slate-900">AI Shortlisted</h2>
      <p className="text-sm text-slate-500">Candidates scored by AI with match scores and recommendations.</p>
    </div>
  )

  const handleApproveAll = async () => {
    if (!results) return
    const toApprove = results.filter(
      (r) => r.recommendation === 'shortlisted' && r.hr_decision === 'pending',
    )
    if (toApprove.length === 0) {
      toast('No shortlisted candidates pending a decision.')
      return
    }
    setApprovingAll(true)
    try {
      await Promise.all(
        toApprove.map((r) =>
          api.patch(`/api/shortlist/${r.id}/decision`, { hr_decision: 'approved' }),
        ),
      )
      toast.success(
        `Approved ${toApprove.length} candidate${toApprove.length !== 1 ? 's' : ''}`,
      )
    } catch {
      toast.error('Failed to approve all. Please try again.')
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      setApprovingAll(false)
    }
  }

  const handleRejectAll = async () => {
    if (!results) return
    const toReject = results.filter(
      (r) => r.recommendation === 'rejected' && r.hr_decision === 'pending',
    )
    if (toReject.length === 0) {
      toast('No AI-rejected candidates pending a decision.')
      return
    }
    setRejectingAll(true)
    try {
      await Promise.all(
        toReject.map((r) =>
          api.patch(`/api/shortlist/${r.id}/decision`, { hr_decision: 'rejected' }),
        ),
      )
      toast.success(
        `Rejected ${toReject.length} candidate${toReject.length !== 1 ? 's' : ''}`,
      )
    } catch {
      toast.error('Failed to reject all. Please try again.')
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      setRejectingAll(false)
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  const showLoading = isLoading || (isFetching && !results)
  if (showLoading) {
    return (
      <div className={isAiShortlistedMode ? 'space-y-6' : 'space-y-4'}>
        {isAiShortlistedMode && aiShortlistedHeader}
        {[1, 2, 3].map((i) => (
          <ShortlistCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className={isAiShortlistedMode ? 'space-y-6' : undefined}>
        {isAiShortlistedMode && aiShortlistedHeader}
        <BackendError onRetry={refetch} />
      </div>
    )
  }

  // ── Shortlisting in progress ──────────────────────────────────────────────
  if (isInProgress) {
    return (
      <div className={isAiShortlistedMode ? 'space-y-6' : undefined}>
        {isAiShortlistedMode && aiShortlistedHeader}
        <div className={SHORTLIST_EMPTY_STATE_CLASS}>
          <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          </div>
          <p className="text-slate-700 font-semibold mb-1">AI is scoring candidates…</p>
          <p className="text-slate-400 text-sm max-w-xs">
            This usually takes 30–60 seconds. Results will appear automatically when ready.
          </p>
        </div>
      </div>
    )
  }

  // ── Empty state (no shortlist yet) ────────────────────────────────────────
  if (!hasResults) {
    if (isAiShortlistedMode) {
      return (
        <div className="space-y-6">
          {aiShortlistedHeader}
          <div className={SHORTLIST_EMPTY_STATE_CLASS}>
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-700 font-semibold mb-1">No candidates have been scored yet.</p>
          </div>
        </div>
      )
    }

    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Users className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-700 font-semibold mb-1">No shortlist yet</p>
        <p className="text-slate-400 text-sm max-w-xs mb-5">
          Run AI Shortlist from the Candidates tab to score and rank your candidates.
        </p>
        <button
          onClick={onSwitchToCandidates}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Go to Candidates
        </button>
      </div>
    )
  }

  // ── Results ───────────────────────────────────────────────────────────────
  if (isAiShortlistedMode) {
    return (
      <div className="space-y-6">
        {aiShortlistedHeader}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="w-full max-w-md">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search candidates..."
                className={SHORTLIST_SEARCH_CLASS}
              />
            </div>
          </div>

          <div className="text-sm font-medium text-slate-600 whitespace-nowrap">
            Total Scored Candidates: {scoredResults.length}
          </div>
        </div>

        {filteredScored.length === 0 ? (
          <div className={SHORTLIST_EMPTY_STATE_CLASS}>
            <p className="text-slate-400 text-sm">No results found for your search.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredScored.map((result) => (
              <ShortlistCard
                key={result.id}
                result={result}
                jobId={jobId}
                decisionActions="approveReject"
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row: count + bulk actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          {results.length} candidate{results.length !== 1 ? 's' : ''} scored · sorted by match score
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleApproveAll()}
            disabled={approvingAll || rejectingAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {approvingAll ? (
              <><Loader2 size={11} className="animate-spin" /> Approving…</>
            ) : (
              'Approve All Shortlisted'
            )}
          </button>
          <button
            onClick={() => void handleRejectAll()}
            disabled={approvingAll || rejectingAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {rejectingAll ? (
              <><Loader2 size={11} className="animate-spin" /> Rejecting…</>
            ) : (
              'Reject All Rejected'
            )}
          </button>
        </div>
      </div>
      {results.map((result) => (
        <ShortlistCard key={result.id} result={result} jobId={jobId} />
      ))}
    </div>
  )
}

export default ShortlistTab
