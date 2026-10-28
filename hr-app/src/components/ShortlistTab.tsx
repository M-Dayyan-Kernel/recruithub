import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  Trash2,
  XCircle,
  Download,
  FileText,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ShortlistResultWithCandidate, SystemSettings } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { ShortlistTable } from '@/components/shortlist/ShortlistTable'
import { ShortlistTableSkeleton } from '@/components/shortlist/ShortlistTableSkeleton'
import {
  BulkDecisionDialog,
  ShortlistDecisionControls,
  ShortlistStatusCell,
} from '@/components/shortlist/ShortlistDecisionControls'
import { isVoiceScreeningEffective } from '@/lib/voiceScreening'
import { useShortlistApproveNavigation, navigateAfterScreeningSkipped } from '@/hooks/useShortlistApproveNavigation'
import {
  buildShortlistCsv,
  downloadTextFile,
  exportTimestamp,
  slugifyFilename,
} from '@/lib/shortlistReportExport'
import { checkBundleSize } from '@/lib/pdf/limits'

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
  shortlisted: { label: 'Pass', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Fail', className: 'bg-rose-100 text-rose-700' },
  review: { label: 'Needs Review', className: 'bg-amber-100 text-amber-700' },
} as const

type RecommendationFilter = 'all' | keyof typeof REC_CONFIG

const RECOMMENDATION_FILTER_OPTIONS: { value: RecommendationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'shortlisted', label: 'Pass' },
  { value: 'rejected', label: 'Fail' },
  { value: 'review', label: 'Review' },
]

const SHORTLIST_FILTER_SELECT_CLASS =
  'h-11 w-[7.5rem] shrink-0 rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-8 text-left text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'

function RecommendationBadge({ rec }: { rec: ShortlistResultWithCandidate['recommendation'] }) {
  const cfg = REC_CONFIG[rec as keyof typeof REC_CONFIG]
  if (!cfg) return null
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
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

function BulkActionButtons({
  approveLabel,
  rejectLabel,
  approvingAll,
  rejectingAll,
  onApproveAll,
  onRejectAll,
}: {
  approveLabel: string
  rejectLabel: string
  approvingAll: boolean
  rejectingAll: boolean
  onApproveAll: () => void
  onRejectAll: () => void
}) {
  const disabled = approvingAll || rejectingAll

  return (
    <div className="inline-grid w-auto shrink-0 min-w-[15rem] grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
      <button
        type="button"
        onClick={onApproveAll}
        disabled={disabled}
        className="inline-flex h-10 items-center justify-center gap-1.5 bg-pos-soft px-3 text-sm font-semibold text-pos transition-colors hover:bg-pos hover:text-accent-ink focus:outline-none focus:ring-2 focus:ring-inset focus:ring-pos/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {approvingAll ? (
          <>
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className="truncate">Approving…</span>
          </>
        ) : (
          <>
            <CheckCircle size={14} className="shrink-0" />
            <span className="truncate">{approveLabel}</span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={onRejectAll}
        disabled={disabled}
        className="inline-flex h-10 items-center justify-center gap-1.5 bg-surface px-3 text-sm font-semibold text-neg transition-colors hover:bg-neg-soft focus:outline-none focus:ring-2 focus:ring-inset focus:ring-neg/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {rejectingAll ? (
          <>
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className="truncate">Rejecting…</span>
          </>
        ) : (
          <>
            <XCircle size={14} className="shrink-0" />
            <span className="truncate">{rejectLabel}</span>
          </>
        )}
      </button>
    </div>
  )
}

type DecisionActionsMode = 'none' | 'approveReject' | 'full'

function ShortlistCard({
  result,
  jobId,
  readOnly = false,
  decisionActions,
  showDelete = false,
  screeningEffective = true,
  onApproved,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
  readOnly?: boolean
  decisionActions?: DecisionActionsMode
  showDelete?: boolean
  screeningEffective?: boolean
  onApproved?: ReturnType<typeof useShortlistApproveNavigation>
}) {
  const actionsMode: DecisionActionsMode =
    decisionActions ?? (readOnly ? 'none' : 'full')
  const showDecisionButtons = actionsMode !== 'none'
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

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/candidates/${result.candidate_id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      toast.success('Resume removed')
    },
    onError: () => toast.error('Failed to remove resume'),
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

  const handleDelete = () => {
    if (window.confirm(`Remove ${displayName}?`)) {
      deleteMutation.mutate()
    }
  }

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
            <ShortlistStatusCell result={result} jobId={jobId} />
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
            <ShortlistDecisionControls
              result={result}
              jobId={jobId}
              screeningEffective={screeningEffective}
              onApproved={onApproved}
            />
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
            {showDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed ${showFeedback ? '' : 'ml-auto'}`}
                title="Remove resume"
              >
                {deleteMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                Delete
              </button>
            )}
          </div>

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
  mode?: 'default' | 'aiShortlisted'
  requiredSkills?: string[]
  jobTitle?: string
  voiceScreeningEnabled?: boolean
}

export function ShortlistTab({
  jobId,
  shortlistTriggered,
  onShortlistComplete,
  mode = 'default',
  requiredSkills = [],
  jobTitle,
  voiceScreeningEnabled,
}: Props) {
  const isAiShortlistedMode = mode === 'aiShortlisted'
  const [search, setSearch] = useState('')
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>('all')

  const { data: results, isLoading, isFetching, isError, refetch } = useQuery<
    ShortlistResultWithCandidate[]
  >({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<
        ShortlistResultWithCandidate[]
      >,
    enabled: !!jobId,
    // The stage of an approved row changes elsewhere (a call ends, a link is sent), so a
    // visit to this tab should always show the current one rather than a 30s-old answer.
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data
      // Poll every 3 s while the Celery task is running but results haven't arrived yet
      if (shortlistTriggered && (!data || data.length === 0)) return 3000
      return false
    },
  })

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })
  const screeningEffective = isVoiceScreeningEffective(settings, {
    voice_screening_enabled: voiceScreeningEnabled,
  })
  const navigate = useNavigate()
  const onApproved = useShortlistApproveNavigation(jobId)

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
    if (recommendationFilter !== 'all' && r.recommendation !== recommendationFilter) {
      return false
    }
    if (!normalizedSearch) return true
    const name = (r.candidate_name ?? '').toLowerCase()
    const email = (r.candidate_email ?? '').toLowerCase()
    return name.includes(normalizedSearch) || email.includes(normalizedSearch)
  })

  // Bulk approve/reject by AI recommendation (shortlisted = passed, rejected = failed)
  const queryClient = useQueryClient()
  const [approvingAll, setApprovingAll] = useState(false)
  const [rejectingAll, setRejectingAll] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  // The names are captured when the dialog opens: the list refetches while the batch
  // runs, and a dialog that re-derives them would empty itself before it closes.
  const [bulkConfirm, setBulkConfirm] = useState<{ decision: 'approved' | 'rejected'; names: string[]; ids: Set<string> } | null>(null)

  // Only rows still awaiting a decision: approved rows are locked, and a rejected row
  // is not "failed" work for the batch to redo.
  const bulkTargets = (decision: 'approved' | 'rejected') =>
    (results ?? []).filter(
      (r) =>
        r.hr_decision === 'pending' &&
        r.recommendation === (decision === 'approved' ? 'shortlisted' : 'rejected'),
    )

  const requestBulk = (decision: 'approved' | 'rejected') => {
    if (bulkTargets(decision).length === 0) {
      toast(
        decision === 'approved'
          ? 'No resume-passed candidates pending approval.'
          : 'No resume-failed candidates pending rejection.',
      )
      return
    }
    setBulkConfirm({
      decision,
      names: bulkTargets(decision).map((r) => r.candidate_name ?? 'Candidate'),
      ids: new Set(bulkTargets(decision).map((r) => r.id)),
    })
  }

  const aiShortlistedHeader = (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold text-slate-900">Resume Screening</h2>
      <p className="text-sm text-slate-500">Candidates scored by AI with match scores and recommendations.</p>
    </div>
  )

  // The batch acts on the rows HR was shown, and only those still awaiting a decision:
  // a row someone else decided in the meantime is left alone.
  const confirmedTargets = (decision: 'approved' | 'rejected') =>
    bulkTargets(decision).filter((r) => !bulkConfirm || bulkConfirm.ids.has(r.id))

  const handleApproveAll = async () => {
    const toApprove = confirmedTargets('approved')
    if (toApprove.length === 0) return
    setApprovingAll(true)
    try {
      const settled = await Promise.allSettled(
        toApprove.map(
          (r) =>
            api.patch(`/api/shortlist/${r.id}/decision`, {
              hr_decision: 'approved',
            }) as unknown as Promise<{ screening_skipped?: boolean; interview_email_sent?: boolean | null }>,
        ),
      )
      const responses = settled.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))
      const failed = settled.length - responses.length
      const plural = (n: number) => `${n} candidate${n !== 1 ? 's' : ''}`
      const anyEmailFailed =
        !screeningEffective && responses.some((r) => r.screening_skipped && r.interview_email_sent === false)
      if (failed > 0) {
        // Most often a row that changed under us (approved from another tab).
        toast.error(
          (responses.length > 0
            ? `Approved ${plural(responses.length)}, but ${failed} could not be updated.`
            : 'Could not approve.') +
            (anyEmailFailed ? ' Some interview emails also failed.' : '') +
            ' The list has been refreshed.',
        )
      } else if (anyEmailFailed) {
        toast.error(`Approved ${plural(responses.length)}, but some interview emails failed.`)
      } else if (!screeningEffective) {
        toast.success(`Approved ${plural(responses.length)} — interview links sent`)
      } else {
        toast.success(`Approved ${plural(responses.length)}`)
      }
      if (!screeningEffective && responses.length > 0) {
        navigateAfterScreeningSkipped(jobId, navigate, queryClient)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
      setApprovingAll(false)
    }
  }

  const handleRejectAll = async () => {
    const toReject = confirmedTargets('rejected')
    if (toReject.length === 0) return
    setRejectingAll(true)
    try {
      const settled = await Promise.allSettled(
        toReject.map((r) => api.patch(`/api/shortlist/${r.id}/decision`, { hr_decision: 'rejected' })),
      )
      const done = settled.filter((o) => o.status === 'fulfilled').length
      const failed = settled.length - done
      const plural = (n: number) => `${n} candidate${n !== 1 ? 's' : ''}`
      if (failed > 0) {
        toast.error(
          done > 0
            ? `Rejected ${plural(done)}, but ${failed} could not be updated. The list has been refreshed.`
            : 'Could not reject. The list has been refreshed.',
        )
      } else {
        toast.success(`Rejected ${plural(done)}`)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['rejected', jobId] })
      setRejectingAll(false)
    }
  }

  const confirmBulk = async () => {
    const decision = bulkConfirm?.decision
    if (!decision) return
    if (decision === 'approved') await handleApproveAll()
    else await handleRejectAll()
    setBulkConfirm(null)
  }

  const aiShortlistedCandidates = scoredResults.filter(
    (result) => result.recommendation === 'shortlisted',
  )
  const exportBaseName = slugifyFilename(jobTitle ?? 'job')

  const handleExportShortlistedCsv = () => {
    if (aiShortlistedCandidates.length === 0) {
      toast('No resume-screened candidates to export.')
      return
    }
    const csv = buildShortlistCsv(aiShortlistedCandidates, requiredSkills)
    downloadTextFile(
      `${exportBaseName}-ai-shortlisted-${exportTimestamp()}.csv`,
      csv,
      'text/csv;charset=utf-8',
    )
    toast.success(
      `Exported ${aiShortlistedCandidates.length} candidate${aiShortlistedCandidates.length !== 1 ? 's' : ''} as CSV`,
    )
  }

  const handleExportShortlistedReports = async () => {
    if (exportingPdf) return
    if (aiShortlistedCandidates.length === 0) {
      toast('No resume-screened candidates to export.')
      return
    }
    const size = checkBundleSize(aiShortlistedCandidates.length)
    if (!size.ok) {
      toast.error(size.message)
      return
    }
    setExportingPdf(true)
    // A large export is laid out on the main thread, so the page can pause for a few seconds.
    const notice = size.slow
      ? toast.loading(`Preparing ${aiShortlistedCandidates.length} reports. This page may pause for a few seconds.`)
      : null
    try {
      // Loaded on demand: the PDF library and its fonts are not part of the page.
      const { downloadShortlistBundle } = await import('@/lib/pdf')
      await downloadShortlistBundle(aiShortlistedCandidates, requiredSkills, { jobTitle })
      toast.success(
        `Downloaded PDF with ${aiShortlistedCandidates.length} report${aiShortlistedCandidates.length !== 1 ? 's' : ''}`,
      )
    } catch {
      toast.error('Failed to generate PDF export')
    } finally {
      if (notice) toast.dismiss(notice)
      setExportingPdf(false)
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  const showLoading = isLoading || (isFetching && !results)
  if (showLoading) {
    return (
      <div className={isAiShortlistedMode ? 'space-y-6' : 'space-y-4'}>
        {isAiShortlistedMode && aiShortlistedHeader}
        {isAiShortlistedMode ? (
          <ShortlistTableSkeleton />
        ) : (
          [1, 2, 3].map((i) => <ShortlistCardSkeleton key={i} />)
        )}
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
          Upload resumes from the job overview to get AI recommendations.
        </p>
        <Link
          to={`/jobs/${jobId}`}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Go to job overview
        </Link>
      </div>
    )
  }

  // ── Results ───────────────────────────────────────────────────────────────
  if (isAiShortlistedMode) {
    return (
      <div className="space-y-4">
        {aiShortlistedHeader}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-3">
            <div className="relative min-w-0 flex-1">
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
            <select
              value={recommendationFilter}
              onChange={(e) => setRecommendationFilter(e.target.value as RecommendationFilter)}
              aria-label="Filter by recommendation"
              className={SHORTLIST_FILTER_SELECT_CLASS}
            >
              {RECOMMENDATION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <p className="text-sm text-slate-500 whitespace-nowrap">
              {recommendationFilter === 'all' ? (
                <>
                  <span className="font-semibold text-slate-800">{scoredResults.length}</span>
                  {' '}scored candidate{scoredResults.length !== 1 ? 's' : ''}
                </>
              ) : (
                <>
                  Showing{' '}
                  <span className="font-semibold text-slate-800">{filteredScored.length}</span>
                  {' '}of{' '}
                  <span className="font-semibold text-slate-800">{scoredResults.length}</span>
                </>
              )}
            </p>
            <BulkActionButtons
              approveLabel="Approve passed"
              rejectLabel="Reject failed"
              approvingAll={approvingAll}
              rejectingAll={rejectingAll}
              onApproveAll={() => requestBulk('approved')}
              onRejectAll={() => requestBulk('rejected')}
            />
            <button
              type="button"
              onClick={handleExportShortlistedCsv}
              disabled={aiShortlistedCandidates.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} />
              Export CSV ({aiShortlistedCandidates.length})
            </button>
            <button
              type="button"
              onClick={handleExportShortlistedReports}
              disabled={aiShortlistedCandidates.length === 0 || exportingPdf}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {exportingPdf ? 'Preparing PDF…' : 'Export all PDFs'}
            </button>
          </div>
        </div>

        {filteredScored.length === 0 ? (
          <div className={SHORTLIST_EMPTY_STATE_CLASS}>
            <p className="text-slate-400 text-sm">
              {scoredResults.length === 0
                ? 'No scored candidates yet.'
                : search || recommendationFilter !== 'all'
                  ? 'No candidates match your filters.'
                  : 'No results found.'}
            </p>
          </div>
        ) : (
          <ShortlistTable
            results={filteredScored}
            jobId={jobId}
            requiredSkills={requiredSkills}
            jobTitle={jobTitle}
            voiceScreeningEnabled={voiceScreeningEnabled}
          />
        )}

        {bulkConfirm && (
          <BulkDecisionDialog
            decision={bulkConfirm.decision}
            names={bulkConfirm.names}
            screeningEffective={screeningEffective}
            busy={approvingAll || rejectingAll}
            onConfirm={() => void confirmBulk()}
            onClose={() => setBulkConfirm(null)}
          />
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
        <BulkActionButtons
          approveLabel="Approve shortlisted"
          rejectLabel="Reject failed"
          approvingAll={approvingAll}
          rejectingAll={rejectingAll}
          onApproveAll={() => requestBulk('approved')}
          onRejectAll={() => requestBulk('rejected')}
        />
      </div>
      {results.map((result) => (
        <ShortlistCard
          key={result.id}
          result={result}
          jobId={jobId}
          screeningEffective={screeningEffective}
          onApproved={onApproved}
        />
      ))}
    </div>
  )
}

export default ShortlistTab
