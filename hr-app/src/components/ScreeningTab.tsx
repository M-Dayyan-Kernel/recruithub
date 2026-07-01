import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Loader2,
  Phone,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  FileText,
  Mic,
  Users,
  RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import type {
  ScreeningCall,
  ShortlistResultWithCandidate,
  Candidate,
  CallStatus,
} from '@/types/api'
import { BackendError } from '@/components/BackendError'

// ---------------------------------------------------------------------------
// Call status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  CallStatus,
  { label: string; className: string; spinner: boolean }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-slate-100 text-slate-600',
    spinner: false,
  },
  initiated: {
    label: 'Initiated',
    className: 'bg-blue-100 text-blue-700',
    spinner: true,
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-blue-100 text-blue-700',
    spinner: true,
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-700',
    spinner: false,
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-100 text-rose-700',
    spinner: false,
  },
}

function CallStatusBadge({ status }: { status: ScreeningCall['call_status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.spinner && <Loader2 size={10} className="animate-spin" />}
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Call outcome badge — uses call_outcome when available, falls back to call_status
// ---------------------------------------------------------------------------

function CallOutcomeBadge({
  status,
  outcome,
  retryCount,
}: {
  status: string
  outcome?: string | null
  retryCount?: number
}) {
  if (outcome) {
    const outcomeConfig: Record<string, { label: string; className: string }> = {
      completed: { label: 'Completed',    className: 'bg-emerald-100 text-emerald-700' },
      no_answer: { label: 'No Answer',    className: 'bg-amber-100 text-amber-700' },
      voicemail: { label: 'Voicemail',    className: 'bg-amber-100 text-amber-700' },
      declined:  { label: 'Declined',     className: 'bg-rose-100 text-rose-700' },
      dropped:   { label: 'Call Dropped', className: 'bg-orange-100 text-orange-700' },
      failed:    { label: 'Failed',       className: 'bg-rose-100 text-rose-700' },
    }
    const cfg = outcomeConfig[outcome] ?? { label: outcome, className: 'bg-slate-100 text-slate-600' }
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.className}`}
        >
          {cfg.label}
        </span>
        {(outcome === 'no_answer' || outcome === 'voicemail' || outcome === 'dropped') &&
          (retryCount ?? 0) < 3 && (
            <span className="text-xs text-slate-400">Auto-retry scheduled</span>
          )}
        {(retryCount ?? 0) >= 3 && (
          <span className="text-xs text-slate-400">Max retries reached</span>
        )}
      </div>
    )
  }

  // Fallback to call_status
  const statusConfig: Record<string, { label: string; className: string }> = {
    pending:     { label: 'Queued',      className: 'bg-slate-100 text-slate-600' },
    initiated:   { label: 'Calling…',   className: 'bg-blue-100 text-blue-700' },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
    completed:   { label: 'Completed',   className: 'bg-emerald-100 text-emerald-700' },
    failed:      { label: 'Failed',      className: 'bg-rose-100 text-rose-700' },
  }
  const cfg = statusConfig[status] ?? { label: status, className: 'bg-slate-100 text-slate-600' }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Result badge (only when completed)
// ---------------------------------------------------------------------------

const RESULT_CONFIG = {
  pass: { label: 'Pass', className: 'bg-emerald-100 text-emerald-700' },
  fail: { label: 'Fail', className: 'bg-rose-100 text-rose-700' },
  needs_review: { label: 'Needs Review', className: 'bg-amber-100 text-amber-700' },
} as const

function ResultBadge({ result }: { result: ScreeningCall['result'] }) {
  if (!result) return null
  const cfg = RESULT_CONFIG[result]
  if (!cfg) return null
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Willingness badge
// ---------------------------------------------------------------------------

function WillingnessBadge({ willing }: { willing: boolean | null | undefined }) {
  if (willing === null || willing === undefined)
    return <span className="text-sm text-slate-400">—</span>
  return willing ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 font-medium">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-rose-100 text-rose-700 font-medium">
      No
    </span>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ScreeningCallSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
          <div className="h-4 bg-slate-200 rounded w-36" />
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="h-5 w-20 bg-slate-100 rounded-full" />
          <div className="h-5 w-16 bg-slate-100 rounded-full" />
        </div>
      </div>
      <div className="h-24 bg-slate-50 rounded-lg" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Structured field row
// ---------------------------------------------------------------------------

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Communication quality colours
// ---------------------------------------------------------------------------

const QUALITY_COLORS: Record<string, string> = {
  excellent: 'text-emerald-700',
  good: 'text-blue-700',
  fair: 'text-amber-700',
  poor: 'text-rose-700',
}

// ---------------------------------------------------------------------------
// HR screening decision buttons
// ---------------------------------------------------------------------------

function ScreeningHrDecisionButtons({
  call,
  jobId,
}: {
  call: ScreeningCall
  jobId: string
}) {
  const queryClient = useQueryClient()

  const decisionMutation = useMutation<
    unknown,
    Error,
    ScreeningCall['result']
  >({
    mutationFn: (result) =>
      api.patch(`/api/screening/${call.id}/result`, { result }),
    onMutate: async (result) => {
      await queryClient.cancelQueries({ queryKey: ['screening', jobId] })
      const previous = queryClient.getQueryData<ScreeningCall[]>(['screening', jobId])
      queryClient.setQueryData<ScreeningCall[]>(['screening', jobId], (old) =>
        old
          ? old.map((sc) => (sc.id === call.id ? { ...sc, result } : sc))
          : old,
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: ScreeningCall[] } | undefined
      if (ctx?.previous) {
        queryClient.setQueryData(['screening', jobId], ctx.previous)
      }
      toast.error('Failed to update screening decision')
    },
    onSuccess: (_data, result) => {
      toast.success(
        result === 'pass' ? 'Candidate marked as pass' : 'Candidate marked as fail',
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
    },
  })

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 border-t border-slate-100 pt-4">
      <button
        type="button"
        onClick={() => decisionMutation.mutate('pass')}
        disabled={decisionMutation.isPending}
        className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          call.result === 'pass'
            ? 'bg-emerald-600 text-white border-emerald-600'
            : 'border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600'
        }`}
      >
        Approve Pass
      </button>
      <button
        type="button"
        onClick={() => decisionMutation.mutate('fail')}
        disabled={decisionMutation.isPending}
        className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          call.result === 'fail'
            ? 'bg-rose-600 text-white border-rose-600'
            : 'border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600'
        }`}
      >
        Reject Fail
      </button>
      {decisionMutation.isPending && (
        <Loader2 size={14} className="animate-spin text-slate-400" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screening result card
// ---------------------------------------------------------------------------

function ScreeningResultCard({
  call,
  candidateName,
  jobId,
}: {
  call: ScreeningCall
  candidateName: string
  jobId: string
}) {
  const [showSummary, setShowSummary] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/jobs/${jobId}/screening/trigger`, {
        candidate_ids: [call.candidate_id],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      toast.success('Screening call re-initiated')
    },
    onError: () => toast.error('Failed to retry screening call'),
  })

  const isCompleted = call.call_status === 'completed'
  const isActive = ['pending', 'initiated', 'in_progress'].includes(call.call_status)
  const isTechnicalFailure =
    call.call_status === 'failed' || call.call_outcome === 'failed'

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0 uppercase">
            {candidateName[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{candidateName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <CallOutcomeBadge
            status={call.call_status}
            outcome={call.call_outcome}
            retryCount={call.retry_count}
          />
          {isCompleted && call.result && !isTechnicalFailure && (
            <ResultBadge result={call.result} />
          )}
        </div>
      </div>

      {/* Retry attempt counter */}
      {(call.retry_count ?? 0) > 0 && (
        <span className="text-xs text-slate-400 mt-0.5 block mb-2">
          Attempt {(call.retry_count ?? 0) + 1} of 4
        </span>
      )}

      {/* Active call status */}
      {isActive && (
        <div className="flex items-center gap-2 text-sm text-blue-700 mb-4 px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg">
          <Loader2 size={14} className="animate-spin shrink-0" />
          <span>
            {call.call_status === 'pending'
              ? 'Waiting for call to start…'
              : 'AI call in progress — checking back shortly'}
          </span>
        </div>
      )}

      {/* Technical failure — telephony / Vapi setup */}
      {isTechnicalFailure && (
        <div className="flex items-start gap-2 text-sm text-rose-800 mb-4 px-4 py-3 bg-rose-50 border border-rose-100 rounded-lg">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Call could not connect</p>
            <p className="text-rose-700 mt-1 text-xs leading-relaxed">
              {call.summary ??
                'Check Vapi phone number, Twilio provider, and Geo Permissions for India (+91).'}
            </p>
          </div>
        </div>
      )}

      {/* Retry button — failed calls */}
      {isTechnicalFailure && (
        <button
          onClick={() => retryMutation.mutate()}
          disabled={retryMutation.isPending}
          className="mt-1 mb-3 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {retryMutation.isPending ? (
            <><Loader2 size={12} className="animate-spin" /> Retrying...</>
          ) : (
            <><RefreshCw size={12} /> Retry Call</>
          )}
        </button>
      )}

      {/* Structured fields — completed calls only */}
      {isCompleted && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 mb-4 bg-slate-50 rounded-lg p-4">
          <FieldRow label="Current CTC" value={call.current_ctc} />
          <FieldRow label="Expected CTC" value={call.expected_ctc} />
          <FieldRow label="Notice Period" value={call.notice_period} />
          <FieldRow label="Availability" value={call.availability} />
          <FieldRow label="Location Preference" value={call.location_preference} />
          <FieldRow label="Relevant Exp" value={call.relevant_experience ?? '—'} />

          <div>
            <p className="text-xs text-slate-500 font-medium mb-0.5">Willingness to Proceed</p>
            <WillingnessBadge willing={call.willingness_to_proceed} />
          </div>

          {call.communication_quality && (
            <div>
              <p className="text-xs text-slate-500 font-medium mb-0.5">
                Communication Quality
              </p>
              <p
                className={`text-sm font-medium capitalize ${
                  QUALITY_COLORS[call.communication_quality] ?? 'text-slate-700'
                }`}
              >
                {call.communication_quality}
              </p>
            </div>
          )}
        </div>
      )}

      {/* HR decision — completed calls with screening outcome */}
      {isCompleted && !isTechnicalFailure && (
        <ScreeningHrDecisionButtons call={call} jobId={jobId} />
      )}

      {/* Expandable: summary + transcript */}
      {isCompleted && (call.summary || call.transcript) && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {call.summary && (
            <div>
              <button
                onClick={() => setShowSummary((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform ${showSummary ? 'rotate-180' : ''}`}
                />
                AI Summary
              </button>
              {showSummary && (
                <p className="mt-2 text-sm text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-3">
                  {call.summary}
                </p>
              )}
            </div>
          )}
          {call.transcript && (
            <div>
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
              >
                <FileText size={11} />
                <span>{showTranscript ? 'Hide Transcript' : 'View Transcript'}</span>
                <ChevronDown
                  size={12}
                  className={`transition-transform ${showTranscript ? 'rotate-180' : ''}`}
                />
              </button>
              {showTranscript && (
                <pre className="mt-2 text-xs leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                  {call.transcript}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trigger section — top card for starting new screening calls
// ---------------------------------------------------------------------------

interface UnscreenedItem extends ShortlistResultWithCandidate {
  phone: string | null
}

interface TriggerSectionProps {
  jobId: string
  unscreened: UnscreenedItem[]
  eligibleIds: string[]
  missingPhoneNames: string[]
}

function TriggerSection({
  jobId,
  unscreened,
  eligibleIds,
  missingPhoneNames,
}: TriggerSectionProps) {
  const queryClient = useQueryClient()
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [triggerSuccess, setTriggerSuccess] = useState<{ initiated: number } | null>(null)
  const [skippedCandidates, setSkippedCandidates] = useState<Array<{ name: string; reason: string }>>([])
  const [showConfirm, setShowConfirm] = useState(false)

  const triggerMutation = useMutation<
    { initiated: number; skipped: Array<{ name: string; reason: string }> },
    Error,
    string[]
  >({
    mutationFn: (candidate_ids) =>
      api.post(`/api/jobs/${jobId}/screening/trigger`, {
        candidate_ids,
      }) as Promise<{ initiated: number; skipped: Array<{ name: string; reason: string }> }>,
    onSuccess: (data) => {
      setTriggerSuccess({ initiated: data.initiated })
      setSkippedCandidates(data.skipped ?? [])
      setTriggerError(null)
      toast.success(
        `Screening started for ${data.initiated} candidate${data.initiated !== 1 ? 's' : ''}. Calls will connect shortly.`,
      )
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
    },
    onError: (err) => {
      // If 422 slips through (phone not available), surface it clearly
      setTriggerError(err.message ?? 'Failed to start screening. Please try again.')
      toast.error('Failed to start screening. Please try again.')
    },
  })

  const handleTriggerConfirmed = () => {
    setShowConfirm(false)
    setTriggerError(null)
    setTriggerSuccess(null)
    setSkippedCandidates([])
    triggerMutation.mutate(eligibleIds)
  }

  if (unscreened.length === 0) return null

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-slate-800 mb-0.5">Ready to Screen</h3>
          <p className="text-sm text-slate-500">
            {unscreened.length} approved candidate{unscreened.length !== 1 ? 's' : ''} not yet
            screened.
          </p>
        </div>
      </div>

      {/* Candidate list with phone status */}
      <div className="space-y-2 mb-4">
        {unscreened.map((item) => (
          <div
            key={item.candidate_id}
            className="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded-lg"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-semibold shrink-0 uppercase">
                {(item.candidate_name ?? 'C')[0]}
              </div>
              <span className="text-sm text-slate-700 truncate">
                {item.candidate_name ?? 'Candidate'}
              </span>
            </div>
            {!item.phone && (
              <span className="flex items-center gap-1 text-xs text-amber-600 shrink-0 ml-2">
                <AlertCircle size={11} />
                No phone
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Missing phone warning */}
      {missingPhoneNames.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {missingPhoneNames.length} candidate
                {missingPhoneNames.length !== 1 ? 's' : ''} missing a phone number
              </p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                <strong>{missingPhoneNames.join(', ')}</strong> — AI screening requires a phone
                number.{' '}
                {eligibleIds.length > 0
                  ? 'Screening will be started for the remaining candidates.'
                  : 'Please add phone numbers before triggering screening.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success banner */}
      {triggerSuccess && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-700">
            Screening started for {triggerSuccess.initiated} candidate
            {triggerSuccess.initiated !== 1 ? 's' : ''}. Calls will connect shortly.
          </p>
        </div>
      )}

      {/* Skipped candidates amber banner */}
      {skippedCandidates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-amber-800 font-medium text-sm mb-2">
            {skippedCandidates.length} candidate{skippedCandidates.length !== 1 ? 's' : ''} skipped
          </p>
          <ul className="text-amber-700 text-sm space-y-1">
            {skippedCandidates.map((s, i) => (
              <li key={i}>• {s.name} — {s.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Error banner */}
      {triggerError && (
        <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
          <AlertCircle size={14} className="text-rose-600 shrink-0" />
          <p className="text-sm text-rose-700">{triggerError}</p>
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={triggerMutation.isPending || eligibleIds.length === 0}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {triggerMutation.isPending ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Starting Calls…
          </>
        ) : (
          <>
            <Phone size={14} />
            Start AI Screening
            {eligibleIds.length > 0 && eligibleIds.length < unscreened.length && (
              <span className="text-indigo-300 text-xs font-normal ml-1">
                ({eligibleIds.length} of {unscreened.length})
              </span>
            )}
          </>
        )}
      </button>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Start AI Screening?</h3>
            <p className="text-sm text-slate-600 mb-5">
              You're about to start AI screening for{' '}
              <strong>{eligibleIds.length} candidate{eligibleIds.length !== 1 ? 's' : ''}</strong>.
              This will make live phone calls. Continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={triggerMutation.isPending}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTriggerConfirmed}
                disabled={triggerMutation.isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {triggerMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                Confirm &amp; Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScreeningTab — main component
// ---------------------------------------------------------------------------

interface Props {
  jobId: string
}

export function ScreeningTab({ jobId }: Props) {
  // ── Screening calls query — with status polling ───────────────────────────
  const {
    data: screeningCalls,
    isLoading,
    isError,
    refetch,
  } = useQuery<ScreeningCall[]>({
    queryKey: ['screening', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.length === 0) return false
      const hasActive = data.some((sc) =>
        (['pending', 'initiated', 'in_progress'] as CallStatus[]).includes(sc.call_status),
      )
      return hasActive ? 8000 : false
    },
  })

  // ── Shortlist results — for approved candidates not yet screened ──────────
  // Same queryKey as ShortlistTab → TanStack deduplicates, no extra request
  const { data: shortlistResults } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<
        ShortlistResultWithCandidate[]
      >,
    enabled: !!jobId,
  })

  // ── Candidates — for phone check + name lookup ───────────────────────────
  // Same queryKey as JobDetailPage / CandidatesTab → deduped
  const { data: candidates } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
  })

  // ── Derived data ──────────────────────────────────────────────────────────

  const candidatesMap = useMemo(() => {
    const map: Record<string, Candidate> = {}
    candidates?.forEach((c) => {
      map[c.id] = c
    })
    return map
  }, [candidates])

  const screenedCandidateIds = useMemo(
    () => new Set(screeningCalls?.map((sc) => sc.candidate_id) ?? []),
    [screeningCalls],
  )

  // Approved candidates who haven't been screened yet
  const unscreenedApproved = useMemo((): UnscreenedItem[] => {
    if (!shortlistResults) return []
    return shortlistResults
      .filter(
        (sr) => sr.hr_decision === 'approved' && !screenedCandidateIds.has(sr.candidate_id),
      )
      .map((sr) => ({
        ...sr,
        phone: candidatesMap[sr.candidate_id]?.phone ?? null,
      }))
  }, [shortlistResults, screenedCandidateIds, candidatesMap])

  // IDs eligible to screen (have phone)
  const eligibleIds = useMemo(
    () => unscreenedApproved.filter((u) => !!u.phone).map((u) => u.candidate_id),
    [unscreenedApproved],
  )

  // Names of candidates missing phone (for warning)
  const missingPhoneNames = useMemo(
    () =>
      unscreenedApproved
        .filter((u) => !u.phone)
        .map((u) => u.candidate_name ?? 'Candidate'),
    [unscreenedApproved],
  )

  // Resolve candidate name from screening call
  const getCandidateName = (candidateId: string): string => {
    const c = candidatesMap[candidateId]
    if (!c) return 'Candidate'
    return c.parsed_data?.name ?? c.name ?? 'Candidate'
  }

  const hasResults = screeningCalls && screeningCalls.length > 0

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <ScreeningCallSkeleton key={i} />
        ))}
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return <BackendError onRetry={refetch} />
  }

  // ── Empty state (no calls at all) ─────────────────────────────────────────
  if (!hasResults && unscreenedApproved.length === 0) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Mic className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-700 font-semibold mb-1">No screening calls yet</p>
        <p className="text-slate-400 text-sm max-w-xs">
          Select approved candidates from the Shortlist tab to start AI voice screening.
        </p>
      </div>
    )
  }

  // ── Normal view ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* Trigger section — shown if there are unscreened approved candidates */}
      {unscreenedApproved.length > 0 && (
        <TriggerSection
          jobId={jobId}
          unscreened={unscreenedApproved}
          eligibleIds={eligibleIds}
          missingPhoneNames={missingPhoneNames}
        />
      )}

      {/* Results list */}
      {hasResults && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">
              {screeningCalls.length} screening call
              {screeningCalls.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-3">
              {screeningCalls.filter((sc) => sc.call_status === 'completed').length > 0 && (
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                    {screeningCalls.filter((sc) => sc.result === 'pass').length} pass
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-rose-400" />
                    {screeningCalls.filter((sc) => sc.result === 'fail').length} fail
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                    {screeningCalls.filter((sc) => sc.result === 'needs_review').length} review
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
                    {screeningCalls.filter(
                      (sc) => sc.call_status === 'failed' || sc.call_outcome === 'failed',
                    ).length} failed
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {screeningCalls.map((call) => (
              <ScreeningResultCard
                key={call.id}
                call={call}
                candidateName={getCandidateName(call.candidate_id)}
                jobId={jobId}
              />
            ))}
          </div>
        </>
      )}

      {/* No results yet but trigger section was shown (means unscreened > 0) */}
      {!hasResults && unscreenedApproved.length > 0 && (
        <div className="py-12 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-slate-500 text-sm">
            No calls initiated yet. Click "Start AI Screening" above to begin.
          </p>
        </div>
      )}
    </div>
  )
}

export default ScreeningTab
