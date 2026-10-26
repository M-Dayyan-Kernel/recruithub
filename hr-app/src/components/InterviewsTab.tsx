import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Send,
  Copy,
  Check,
  AlertCircle,
  FileText,
  ClipboardList,
  CheckCircle2,
  Link2,
  Clock,
  CalendarClock,
  Download,
  Ban,
  SkipForward,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { BTN_DANGER, BTN_SECONDARY } from '@/components/ui/Surface'
import type {
  InterviewSession,
  Job,
  InterviewPipelineResponse,
  FinalistsResponse,
} from '@/types/api'
import { ScheduleInterviewModal } from '@/components/screening/ScheduleInterviewModal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { InterviewPipelineTable } from '@/components/InterviewPipelineTable'
import type { InterviewPipelineTab } from '@/types/api'
import { downloadFinalistsExcel } from '@/lib/finalistsExport'
import { PHONE_SCREENING_LABEL } from '@/lib/stageLabels'

// ---------------------------------------------------------------------------
// Interview status chip
// ---------------------------------------------------------------------------

type InterviewStatus =
  | 'not_sent'
  | 'scheduled'
  | 'link_sent'
  | 'in_progress'
  | 'completed'
  | 'report_ready'
  | 'cancelled'

type InterviewTabId = InterviewPipelineTab

type VisibleInterviewTabId = Exclude<InterviewTabId, 'pending'>

const TAB_LABELS: Record<VisibleInterviewTabId, string> = {
  scheduled: 'Scheduled',
  ongoing: 'Ongoing',
  completed: 'Completed',
  flagged: 'Flagged',
  finalists: 'Finalists',
}

const VISIBLE_TABS: VisibleInterviewTabId[] = [
  'scheduled',
  'ongoing',
  'completed',
  'finalists',
  'flagged',
]

function resolveInterviewTab(tab: InterviewTabId | null): VisibleInterviewTabId {
  if (tab === 'pending') return 'scheduled'
  if (tab && VISIBLE_TABS.includes(tab as VisibleInterviewTabId)) return tab as VisibleInterviewTabId
  return 'scheduled'
}

const TAB_EMPTY_MESSAGES: Record<VisibleInterviewTabId, string> = {
  scheduled: 'No candidates waiting for an interview link or scheduled slot.',
  ongoing: 'No interviews in progress right now.',
  completed: 'No completed interviews yet.',
  flagged: 'No flagged interviews.',
  finalists: 'No finalists yet. Approve candidates from Completed to move them here.',
}

function resolveInterviewStatus(
  hasReport: boolean,
  session: InterviewSession | null | undefined,
): InterviewStatus {
  if (!session) return hasReport ? 'completed' : 'not_sent'
  // Called off by HR: the link is dead, and the candidate needs a new one.
  if (session.status === 'cancelled') return 'cancelled'
  if (hasReport || session.status === 'completed') return 'completed'
  if (session.status === 'in_progress') return 'in_progress'
  if (
    session.scheduled_interview_at &&
    new Date(session.scheduled_interview_at) > new Date() &&
    session.status === 'pending'
  ) {
    return 'scheduled'
  }
  return 'link_sent'
}

function formatScheduledAt(iso: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}

function activeTabClass(tab: VisibleInterviewTabId, isActive: boolean): string {
  if (!isActive) return 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
  const active: Record<VisibleInterviewTabId, string> = {
    scheduled: 'bg-blue-600 text-white',
    ongoing: 'bg-amber-500 text-white',
    completed: 'bg-indigo-600 text-white',
    flagged: 'bg-amber-600 text-white',
    finalists: 'bg-emerald-600 text-white',
  }
  return active[tab]
}

const INTERVIEW_STATUS_CONFIG: Record<
  InterviewStatus,
  { label: string; className: string; dotClassName: string }
> = {
  not_sent: {
    label: 'Not Sent',
    className: 'bg-slate-50 text-slate-600 border-slate-200',
    dotClassName: 'bg-slate-400',
  },
  scheduled: {
    label: 'Scheduled',
    className: 'bg-violet-50 text-violet-700 border-violet-200',
    dotClassName: 'bg-violet-500',
  },
  link_sent: {
    label: 'Link Sent',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClassName: 'bg-blue-500',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClassName: 'bg-amber-500',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClassName: 'bg-emerald-500',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-surface text-ink-muted border-line',
    dotClassName: 'bg-ink-subtle',
  },
  report_ready: {
    label: 'Report Ready',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dotClassName: 'bg-indigo-500',
  },
}

function InterviewStatusChip({ status }: { status: InterviewStatus }) {
  const cfg = INTERVIEW_STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dotClassName}`} />
      {cfg.label}
    </span>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'C'
  if (parts.length === 1) return parts[0][0] ?? 'C'
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`
}

// ---------------------------------------------------------------------------
// Copyable URL field
// ---------------------------------------------------------------------------

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback — select text
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2 pl-3">
      <Link2 size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">{url}</span>
      <button
        onClick={handleCopy}
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
          copied
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100'
        }`}
        title="Copy link"
      >
        {copied ? (
          <>
            <Check size={12} />
            Copied
          </>
        ) : (
          <>
            <Copy size={12} />
            Copy
          </>
        )}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidate interview card
// ---------------------------------------------------------------------------

interface CandidateInterviewCardProps {
  job: Job
  candidateId: string
  candidateName: string
  jobId: string
  jobTimezone?: string
  hasReport: boolean
  /** Moved here without a call; `skipReason` is the sentence HR (or the job setting) gave. */
  screeningSkipped?: boolean
  skipReason?: string | null
  /** Session pre-loaded from backend (source of truth) */
  initialSession?: InterviewSession | null
}

function CandidateInterviewCard({
  job,
  candidateId,
  candidateName,
  jobId,
  jobTimezone,
  hasReport,
  screeningSkipped = false,
  skipReason = null,
  initialSession = null,
}: CandidateInterviewCardProps) {
  const queryClient = useQueryClient()
  // localSession is set after a successful send — takes precedence over initialSession
  const [localSession, setLocalSession] = useState<InterviewSession | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Fetched session is source of truth; override with freshly-sent session
  const session = localSession ?? initialSession

  // Determine interview status
  const interviewStatus = useMemo(
    (): InterviewStatus => resolveInterviewStatus(hasReport, session),
    [session, hasReport],
  )

  const invalidatePipeline = () => {
    queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
    queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
  }

  const sendMutation = useMutation<InterviewSession, Error>({
    mutationFn: () =>
      api.post(`/api/candidates/${candidateId}/interview/send`) as Promise<InterviewSession>,
    onSuccess: (data) => {
      setLocalSession(data)
      setSendError(null)
      invalidatePipeline()
      if (data.email_sent_at) {
        toast.success(`Interview link sent to ${candidateName}!`)
      } else {
        toast.error(
          `Session created but email could not be sent to ${candidateName}. Use Resend email.`,
        )
      }
    },
    onError: (err) => {
      setSendError(err.message ?? 'Failed to send interview link.')
      toast.error('Failed to send interview link.')
    },
  })

  const resendEmailMutation = useMutation<InterviewSession, Error>({
    mutationFn: () =>
      api.post(
        `/api/candidates/${candidateId}/interview/resend-email`,
      ) as Promise<InterviewSession>,
    onSuccess: (data) => {
      setLocalSession(data)
      invalidatePipeline()
      toast.success(`Interview email sent to ${candidateName}`)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to send interview email')
    },
  })

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [notifyOnCancel, setNotifyOnCancel] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const cancelMutation = useMutation<{ email_sent: boolean | null }, Error, boolean>({
    mutationFn: (notify) =>
      api.post(`/api/candidates/${candidateId}/interview/cancel`, {
        notify_candidate: notify,
      }) as Promise<{ email_sent: boolean | null }>,
  })
  const handleCancelInterview = async () => {
    setCancelError(null)
    try {
      const out = await cancelMutation.mutateAsync(notifyOnCancel)
      if (session) setLocalSession({ ...session, status: 'cancelled' })
      if (notifyOnCancel && out.email_sent === false) {
        toast.error(`Interview cancelled, but the email to ${candidateName} could not be sent.`)
      } else {
        toast.success(`Interview for ${candidateName} cancelled`)
      }
      setConfirmCancel(false)
    } catch (err) {
      setCancelError(err instanceof Error && err.message ? err.message : 'Could not cancel the interview. Please try again.')
    } finally {
      // Whatever the answer, someone may have changed this candidate: refetch every list.
      invalidatePipeline()
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
    }
  }

  // Rejecting someone whose interview has not started: their link (if any) is cancelled and
  // they move to Rejected. A live or finished interview is not rejected from here.
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const refreshAfterReject = () => {
    invalidatePipeline()
    queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    queryClient.invalidateQueries({ queryKey: ['candidates'] })
    queryClient.invalidateQueries({ queryKey: ['rejected', jobId] })
  }
  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/candidates/${candidateId}/reject`),
    onSuccess: () => {
      setConfirmReject(false)
      toast.success(`${candidateName} moved to Rejected`)
      refreshAfterReject()
    },
    // Not refreshed on a refusal: the card may leave this tab (the interview just started)
    // and take the explanation with it. It refreshes when the dialog is closed.
    onError: (err: Error) => setRejectError(err.message || 'Could not reject this candidate.'),
  })
  const canReject =
    !hasReport && ['not_sent', 'cancelled', 'scheduled', 'link_sent'].includes(interviewStatus)

  const canResendEmail =
    session?.status === 'pending' && !hasReport && interviewStatus !== 'not_sent'
  // Only a link the candidate has not opened: stopping a live interview is a separate action.
  const canCancelInterview = session?.status === 'pending' && !hasReport

  const showEmailWarning =
    session?.status === 'pending' && !session.email_sent_at && interviewStatus !== 'not_sent'

  const statusHint =
    interviewStatus === 'not_sent'
      ? 'Ready to send AI interview link'
      : interviewStatus === 'cancelled'
        ? 'Interview cancelled. Send a new link or schedule a new time.'
        : interviewStatus === 'scheduled'
        ? 'Candidate notified — please attend at the scheduled time'
        : interviewStatus === 'link_sent'
          ? 'Waiting for candidate to start'
          : interviewStatus === 'in_progress'
            ? 'Candidate is taking the interview'
            : hasReport
              ? 'Interview report is available'
              : 'Interview finished — report generating'

  const isFutureScheduled = Boolean(
    session?.status !== 'cancelled' &&
      session?.scheduled_interview_at &&
      new Date(session.scheduled_interview_at) > new Date(),
  )

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
        interviewStatus === 'completed' && hasReport
          ? 'border-indigo-200 ring-1 ring-indigo-50'
          : 'border-slate-200'
      }`}
    >
      {/* Identity + primary action */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-indigo-100 text-sm font-semibold uppercase text-indigo-600 ring-2 ring-white">
            {getInitials(candidateName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{candidateName}</p>
            <p className="mt-0.5 text-xs text-slate-500">{statusHint}</p>
          </div>
        </div>

        {(interviewStatus === 'not_sent' || interviewStatus === 'cancelled') && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send size={13} />
                  Send link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              disabled={sendMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CalendarClock size={13} />
              Schedule
            </button>
          </div>
        )}

        {hasReport && (
          <Link
            to={`/jobs/${jobId}/candidates/${candidateId}/report?tab=completed`}
            className={`${BTN_SECONDARY} shrink-0`}
          >
            <FileText size={13} />
            View Report
          </Link>
        )}

        {(canResendEmail || canCancelInterview) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {canResendEmail && (
              <button
                type="button"
                onClick={() => resendEmailMutation.mutate()}
                disabled={resendEmailMutation.isPending || sendMutation.isPending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resendEmailMutation.isPending ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    {session?.email_sent_at ? 'Resend email' : 'Send email'}
                  </>
                )}
              </button>
            )}
            {canCancelInterview && (
              <button
                type="button"
                onClick={() => {
                  setCancelError(null)
                  setNotifyOnCancel(Boolean(session?.email_sent_at))
                  setConfirmCancel(true)
                }}
                aria-label={`Cancel interview for ${candidateName}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink-muted transition-colors hover:border-neg/30 hover:bg-neg-soft hover:text-neg focus:outline-none focus:ring-2 focus:ring-neg/30"
              >
                <Ban size={13} aria-hidden />
                Cancel interview
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status badges */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {screeningSkipped ? (
          <span
            title={skipReason ?? undefined}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted"
          >
            <SkipForward size={12} aria-hidden />
            {PHONE_SCREENING_LABEL} skipped
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={12} />
            {PHONE_SCREENING_LABEL} passed
          </span>
        )}
        <InterviewStatusChip status={interviewStatus} />
        {canReject && (
          <button
            type="button"
            onClick={() => {
              setRejectError(null)
              setConfirmReject(true)
            }}
            aria-label={`Reject ${candidateName}`}
            className={`${BTN_DANGER} ml-auto`}
          >
            <X size={13} aria-hidden />
            Reject
          </button>
        )}
      </div>
      {confirmReject && (
        <ConfirmDialog
          title={`Reject ${candidateName}?`}
          body={
            <p>
              Their interview link stops working and they move to Rejected. They are not emailed
              until you send it from the Rejected list, and you can reconsider them until then.
            </p>
          }
          confirmLabel="Reject candidate"
          busy={rejectMutation.isPending}
          error={rejectError}
          onConfirm={() => {
            setRejectError(null)
            rejectMutation.mutate()
          }}
          onClose={() => {
            if (rejectError) refreshAfterReject()
            setConfirmReject(false)
          }}
        />
      )}
      {screeningSkipped && skipReason && (
        <p className="mt-2 text-xs text-ink-muted">{skipReason}</p>
      )}

      {/* Scheduled slot — candidate notified immediately with link */}
      {isFutureScheduled && session?.scheduled_interview_at && (
        <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
          <p className="text-xs font-medium text-violet-800">Scheduled for</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-violet-900">
            <CalendarClock size={14} className="shrink-0" />
            {formatScheduledAt(session.scheduled_interview_at, jobTimezone)}
          </p>
          <p className="mt-1 text-xs text-violet-700">
            {session.email_sent_at
              ? 'The candidate was emailed with the interview link and asked to attend at this time.'
              : 'Notification email could not be sent — share the interview link manually below.'}
          </p>
          {session.interview_url && (
            <div className="mt-3 border-t border-violet-100 pt-3">
              <p className="mb-2 text-xs font-medium text-violet-900">Interview link</p>
              <CopyableUrl url={session.interview_url} />
              {session.email_sent_at && (
                <p className="mt-2 text-xs text-violet-600">
                  Notified {new Date(session.email_sent_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Interview link when email failed or not yet sent */}
      {session?.interview_url && session.status !== 'cancelled' && !session.email_sent_at && !isFutureScheduled && (
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">Interview link</p>
          <CopyableUrl url={session.interview_url} />
        </div>
      )}

      {/* Interview link panel (immediate send, no future slot) */}
      {session?.interview_url && session.status !== 'cancelled' && session.email_sent_at && !isFutureScheduled && (
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">Interview link</p>
          <CopyableUrl url={session.interview_url} />
          {(session.email_sent_at || session.started_at || session.completed_at) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {session.email_sent_at && (
                <span className="inline-flex items-center gap-1">
                  <Send size={11} />
                  Sent {new Date(session.email_sent_at).toLocaleString()}
                </span>
              )}
              {session.started_at && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  Started {new Date(session.started_at).toLocaleString()}
                </span>
              )}
              {session.completed_at && (
                <span className="inline-flex items-center gap-1">
                  <Check size={11} />
                  Completed {new Date(session.completed_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Email not sent warning */}
      {showEmailWarning && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={13} className="shrink-0" />
          Interview is set up but the notification email was not delivered. Use Send email above
          or copy the link below.
        </div>
      )}

      {/* Error */}
      {sendError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          <AlertCircle size={13} className="shrink-0" />
          {sendError}
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title={`Cancel the interview for ${candidateName}?`}
          body={
            <p>
              The interview link stops working straight away. {candidateName} stays in Interviews,
              and you can send a new link or schedule a new time afterwards.
            </p>
          }
          confirmLabel="Cancel interview"
          cancelLabel="Keep interview"
          busy={cancelMutation.isPending}
          error={cancelError}
          onConfirm={() => void handleCancelInterview()}
          onClose={() => setConfirmCancel(false)}
        >
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={notifyOnCancel}
              onChange={(e) => setNotifyOnCancel(e.target.checked)}
              disabled={cancelMutation.isPending}
              className="mt-0.5 h-4 w-4 rounded border-line text-accent focus:ring-accent"
            />
            <span>
              Email {candidateName} that the interview was cancelled
              {!session?.email_sent_at && (
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  They were never emailed this link, so you may not need to.
                </span>
              )}
            </span>
          </label>
        </ConfirmDialog>
      )}

      <ScheduleInterviewModal
        job={job}
        candidateId={candidateId}
        candidateName={candidateName}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSuccess={(data) => {
          setLocalSession(data)
          invalidatePipeline()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// InterviewsTab — main component
// ---------------------------------------------------------------------------

interface Props {
  job: Job
  jobId: string
}

export function InterviewsTab({ job, jobId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as InterviewTabId | null
  const [activeTab, setActiveTab] = useState<VisibleInterviewTabId>(resolveInterviewTab(tabParam))
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const pageSize = 10

  const syncSearchParams = (nextTab: VisibleInterviewTabId, nextSearch = search, nextPage = page) => {
    const params = new URLSearchParams()
    params.set('tab', nextTab)
    if (nextSearch.trim()) params.set('search', nextSearch.trim())
    if (nextPage > 1) params.set('page', String(nextPage))
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    const resolved = resolveInterviewTab(tabParam)
    if (resolved !== activeTab) {
      setActiveTab(resolved)
    }
  }, [tabParam])

  const handleTabChange = (tab: VisibleInterviewTabId) => {
    setActiveTab(tab)
    syncSearchParams(tab, search, 1)
  }

  const returnSearch = useMemo(() => {
    const params = new URLSearchParams()
    params.set('tab', activeTab)
    if (search.trim()) params.set('search', search.trim())
    if (page > 1) params.set('page', String(page))
    return `?${params.toString()}`
  }, [activeTab, search, page])

  const {
    data: pipeline,
    isLoading,
  } = useQuery<InterviewPipelineResponse>({
    queryKey: ['interviews-pipeline', jobId, activeTab],
    queryFn: () =>
      api.get(
        `/api/jobs/${jobId}/interviews/pipeline?tab=${activeTab}`,
      ) as unknown as Promise<InterviewPipelineResponse>,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const rows = query.state.data?.candidates ?? []
      const generating = rows.some((r) => r.assessment_status === 'generating')
      return generating ? 4000 : 15000
    },
  })

  const { data: finalistsData } = useQuery<FinalistsResponse>({
    queryKey: ['finalists', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/finalists`) as unknown as Promise<FinalistsResponse>,
    enabled: !!jobId && activeTab === 'finalists',
  })

  const tabCounts = pipeline?.counts ?? {
    pending: 0,
    scheduled: 0,
    ongoing: 0,
    completed: 0,
    flagged: 0,
    finalists: 0,
  }

  const pipelineCandidates = pipeline?.candidates ?? []

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return pipelineCandidates
    return pipelineCandidates.filter((row) =>
      (row.candidate_name ?? '').toLowerCase().includes(q),
    )
  }, [pipelineCandidates, search])

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedCandidates = filteredCandidates.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  )

  const totalEligible =
    tabCounts.pending +
    tabCounts.scheduled +
    tabCounts.ongoing +
    tabCounts.completed +
    tabCounts.flagged +
    (tabCounts.finalists ?? 0)

  const displayTabCount = (tab: VisibleInterviewTabId): number => {
    if (tab === 'scheduled') return tabCounts.scheduled + tabCounts.pending
    return tabCounts[tab] ?? 0
  }

  const tabBar = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {VISIBLE_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => handleTabChange(tab)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTabClass(tab, activeTab === tab)}`}
        >
          {TAB_LABELS[tab]}
          <span className="ml-1.5 text-xs opacity-80">({displayTabCount(tab)})</span>
        </button>
      ))}
    </div>
  )

  const filterBar =
    activeTab === 'completed' || activeTab === 'flagged' || activeTab === 'finalists' ? (
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            syncSearchParams(activeTab, e.target.value, 1)
          }}
          placeholder="Search candidates…"
          className="h-9 w-full max-w-xs rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => syncSearchParams(activeTab, search, safePage - 1)}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => syncSearchParams(activeTab, search, safePage + 1)}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
        {activeTab === 'finalists' && (
          <button
            type="button"
            disabled={(finalistsData?.candidates.length ?? 0) === 0}
            onClick={() => {
              const candidates = finalistsData?.candidates ?? []
              if (candidates.length === 0) {
                toast.error('No finalists to export')
                return
              }
              downloadFinalistsExcel(job.title, candidates)
            }}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={15} />
            Export Excel
          </button>
        )}
      </div>
    ) : null

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        {tabBar}
        {[1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-full bg-slate-200" />
                <div className="space-y-2">
                  <div className="h-4 w-36 rounded bg-slate-200" />
                  <div className="h-3 w-48 rounded bg-slate-100" />
                </div>
              </div>
              <div className="h-8 w-24 rounded-lg bg-slate-200" />
            </div>
            <div className="mt-3 flex gap-2">
              <div className="h-6 w-28 rounded-full bg-slate-100" />
              <div className="h-6 w-24 rounded-full bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Normal view (tabs always visible) ─────────────────────────────────────
  return (
    <div>
      {tabBar}
      {filterBar}

      {totalEligible === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            <ClipboardList className="h-6 w-6 text-slate-400" />
          </div>
          <p className="mb-1 font-semibold text-slate-700">No candidates ready for interview</p>
          <p className="mx-auto max-w-xs text-sm text-slate-400">
            Once a candidate is approved for interview, they will appear in these tabs. You can set
            up the interview rubric above anytime.
          </p>
        </div>
      ) : pipelineCandidates.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-slate-500">{TAB_EMPTY_MESSAGES[activeTab]}</p>
        </div>
      ) : activeTab === 'completed' || activeTab === 'flagged' || activeTab === 'finalists' ? (
        filteredCandidates.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
            <p className="text-sm text-slate-500">No candidates match your search.</p>
          </div>
        ) : (
          <InterviewPipelineTable
            jobId={jobId}
            rows={pagedCandidates}
            variant={activeTab}
            returnSearch={returnSearch}
            onRescheduled={() => handleTabChange('scheduled')}
          />
        )
      ) : (
        <div className="space-y-4">
          {pipelineCandidates.map((row) => (
            <CandidateInterviewCard
              key={row.candidate_id}
              job={job}
              candidateId={row.candidate_id}
              candidateName={row.candidate_name ?? 'Candidate'}
              jobId={jobId}
              jobTimezone={job.screening_timezone}
              hasReport={row.has_report}
              screeningSkipped={row.screening_skipped}
              skipReason={row.skip_reason}
              initialSession={row.session ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default InterviewsTab
