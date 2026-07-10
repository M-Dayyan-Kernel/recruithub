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
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { InterviewSession, Job, InterviewPipelineResponse } from '@/types/api'
import { InterviewRubricPanel } from '@/components/InterviewRubricPanel'
import { ScheduleInterviewModal } from '@/components/screening/ScheduleInterviewModal'
import { InterviewPipelineTable } from '@/components/InterviewPipelineTable'
import type { InterviewPipelineTab } from '@/types/api'

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

type InterviewTabId = InterviewPipelineTab

const TAB_LABELS: Record<InterviewTabId, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  ongoing: 'Ongoing',
  completed: 'Completed',
  flagged: 'Flagged',
}

const VISIBLE_TABS: InterviewTabId[] = ['scheduled', 'ongoing', 'completed', 'flagged']

function resolveInterviewTab(tab: InterviewTabId | null): InterviewTabId {
  if (tab && tab !== 'pending' && VISIBLE_TABS.includes(tab)) return tab
  return 'scheduled'
}

const TAB_EMPTY_MESSAGES: Record<InterviewTabId, string> = {
  pending: 'No candidates waiting for an interview link.',
  scheduled: 'No interviews scheduled for a future slot.',
  ongoing: 'No interviews in progress right now.',
  completed: 'No completed interviews yet.',
  flagged: 'No flagged interviews.',
}

function resolveInterviewStatus(
  hasReport: boolean,
  session: InterviewSession | null | undefined,
): InterviewStatus {
  if (!session) return hasReport ? 'completed' : 'not_sent'
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

function activeTabClass(tab: InterviewTabId, isActive: boolean): string {
  if (!isActive) return 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
  const active: Record<InterviewTabId, string> = {
    pending: 'bg-emerald-600 text-white',
    scheduled: 'bg-blue-600 text-white',
    ongoing: 'bg-amber-500 text-white',
    completed: 'bg-indigo-600 text-white',
    flagged: 'bg-amber-600 text-white',
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
  mockMode?: boolean
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
  mockMode = false,
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
      toast.success(`Interview link sent to ${candidateName}!`)
    },
    onError: (err) => {
      setSendError(err.message ?? 'Failed to send interview link.')
      toast.error('Failed to send interview link.')
    },
  })

  const mockCompleteMutation = useMutation({
    mutationFn: () => api.post(`/api/interview/${session!.unique_token}/complete`),
    onSuccess: () => {
      invalidatePipeline()
      toast.success(`Mock interview completed for ${candidateName}`)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to complete mock interview')
    },
  })

  const canMockComplete =
    mockMode &&
    session?.unique_token &&
    !hasReport &&
    (session.status === 'pending' || session.status === 'in_progress')

  const statusHint =
    interviewStatus === 'not_sent'
      ? 'Ready to send AI interview link'
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

        {interviewStatus === 'not_sent' && (
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <FileText size={13} />
            View Report
          </Link>
        )}

        {canMockComplete && (
          <button
            type="button"
            onClick={() => mockCompleteMutation.mutate()}
            disabled={mockCompleteMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
          >
            {mockCompleteMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            Complete mock interview
          </button>
        )}
      </div>

      {/* Status badges */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={12} />
          Screening passed
        </span>
        <InterviewStatusChip status={interviewStatus} />
      </div>

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

      {/* Interview link panel (immediate send, no future slot) */}
      {session?.interview_url && session.email_sent_at && !isFutureScheduled && (
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

      {/* Error */}
      {sendError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          <AlertCircle size={13} className="shrink-0" />
          {sendError}
        </div>
      )}

      <ScheduleInterviewModal
        job={job}
        candidateId={candidateId}
        candidateName={candidateName}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSuccess={invalidatePipeline}
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
  const [activeTab, setActiveTab] = useState<InterviewTabId>(resolveInterviewTab(tabParam))
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const pageSize = 10

  const syncSearchParams = (nextTab: InterviewTabId, nextSearch = search, nextPage = page) => {
    const params = new URLSearchParams()
    params.set('tab', nextTab)
    if (nextSearch.trim()) params.set('search', nextSearch.trim())
    if (nextPage > 1) params.set('page', String(nextPage))
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    if (tabParam === 'pending') {
      syncSearchParams('scheduled', search, page)
      return
    }
    const resolved = resolveInterviewTab(tabParam)
    if (resolved !== activeTab) {
      setActiveTab(resolved)
    }
  }, [tabParam])

  const handleTabChange = (tab: InterviewTabId) => {
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
    refetchInterval: 15000,
  })

  const { data: health } = useQuery<{ mock_mode?: boolean }>({
    queryKey: ['health'],
    queryFn: () => api.get('/health') as Promise<{ mock_mode?: boolean }>,
    staleTime: 60_000,
  })

  const mockMode = Boolean(health?.mock_mode)

  const tabCounts = pipeline?.counts ?? {
    pending: 0,
    scheduled: 0,
    ongoing: 0,
    completed: 0,
    flagged: 0,
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
    tabCounts.scheduled +
    tabCounts.ongoing +
    tabCounts.completed +
    tabCounts.flagged

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
          <span className="ml-1.5 text-xs opacity-80">({tabCounts[tab]})</span>
        </button>
      ))}
    </div>
  )

  const filterBar =
    activeTab === 'completed' || activeTab === 'flagged' ? (
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
      </div>
    ) : null

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <InterviewRubricPanel job={job} />
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
      <InterviewRubricPanel job={job} />
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
      ) : activeTab === 'completed' || activeTab === 'flagged' ? (
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
              mockMode={mockMode}
              initialSession={row.session ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default InterviewsTab
