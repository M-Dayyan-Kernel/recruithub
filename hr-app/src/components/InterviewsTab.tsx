import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
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
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { ScreeningCall, InterviewSession, Candidate, Job } from '@/types/api'
import { InterviewRubricPanel } from '@/components/InterviewRubricPanel'

// ---------------------------------------------------------------------------
// Interview status chip
// ---------------------------------------------------------------------------

type InterviewStatus = 'not_sent' | 'link_sent' | 'in_progress' | 'completed' | 'report_ready'

const INTERVIEW_STATUS_CONFIG: Record<
  InterviewStatus,
  { label: string; className: string; dotClassName: string }
> = {
  not_sent: {
    label: 'Not Sent',
    className: 'bg-slate-50 text-slate-600 border-slate-200',
    dotClassName: 'bg-slate-400',
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
  candidateId: string
  candidateName: string
  jobId: string
  hasReport: boolean
  /** Session pre-loaded from backend (source of truth) */
  initialSession?: InterviewSession | null
}

function CandidateInterviewCard({
  candidateId,
  candidateName,
  jobId,
  hasReport,
  initialSession = null,
}: CandidateInterviewCardProps) {
  // localSession is set after a successful send — takes precedence over initialSession
  const [localSession, setLocalSession] = useState<InterviewSession | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // Fetched session is source of truth; override with freshly-sent session
  const session = localSession ?? initialSession

  // Determine interview status
  const interviewStatus = useMemo((): InterviewStatus => {
    if (hasReport) return 'report_ready'
    if (!session) return 'not_sent'
    if (session.status === 'completed') return 'completed'
    if (session.status === 'in_progress') return 'in_progress'
    return 'link_sent'
  }, [session, hasReport])

  const sendMutation = useMutation<InterviewSession, Error>({
    mutationFn: () =>
      api.post(`/api/candidates/${candidateId}/interview/send`) as Promise<InterviewSession>,
    onSuccess: (data) => {
      setLocalSession(data)
      setSendError(null)
      toast.success(`Interview link sent to ${candidateName}!`)
    },
    onError: (err) => {
      setSendError(err.message ?? 'Failed to send interview link.')
      toast.error('Failed to send interview link.')
    },
  })

  const statusHint =
    interviewStatus === 'not_sent'
      ? 'Ready to send AI interview link'
      : interviewStatus === 'link_sent'
        ? 'Waiting for candidate to start'
        : interviewStatus === 'in_progress'
          ? 'Candidate is taking the interview'
          : interviewStatus === 'completed'
            ? 'Interview finished — report generating'
            : 'Interview report is available'

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
        interviewStatus === 'report_ready'
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
          <button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendMutation.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send size={13} />
                Send Link
              </>
            )}
          </button>
        )}

        {interviewStatus === 'report_ready' && (
          <Link
            to={`/jobs/${jobId}/candidates/${candidateId}/report`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <FileText size={13} />
            View Report
          </Link>
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

      {/* Interview link panel */}
      {session?.interview_url && (
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
  // Fetch existing interview sessions from backend
  const {
    data: interviewSessions,
    isLoading: sessionsLoading,
  } = useQuery<InterviewSession[]>({
    queryKey: ['interviews', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/interviews`) as unknown as Promise<InterviewSession[]>,
    enabled: !!jobId,
    refetchInterval: 15000,
  })

  // Fetch screening calls to find passed candidates
  const {
    data: screeningCalls,
    isLoading: screeningLoading,
  } = useQuery<ScreeningCall[]>({
    queryKey: ['screening', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
    enabled: !!jobId,
    refetchInterval: 15000,
  })

  // Fetch candidates to get names
  const { data: candidates } = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
  })

  // Candidates who passed screening
  const passedCandidates = useMemo(() => {
    if (!screeningCalls) return []
    return screeningCalls.filter(
      (sc) => sc.call_status === 'completed' && sc.result === 'pass',
    )
  }, [screeningCalls])

  // Build sessions map: candidateId → InterviewSession
  const sessionsMap = useMemo(() => {
    const map: Record<string, InterviewSession> = {}
    interviewSessions?.forEach((s) => { map[s.candidate_id] = s })
    return map
  }, [interviewSessions])

  // Build candidate name map
  const candidatesMap = useMemo(() => {
    const map: Record<string, Candidate> = {}
    candidates?.forEach((c) => { map[c.id] = c })
    return map
  }, [candidates])

  const getCandidateName = (candidateId: string): string => {
    const c = candidatesMap[candidateId]
    if (!c) return 'Candidate'
    return c.parsed_data?.name ?? c.name ?? 'Candidate'
  }

  // Check reports per candidate — use individual queries
  const reportChecks = useQuery<Record<string, boolean>>({
    queryKey: ['interview-reports-check', jobId, passedCandidates.map((c) => c.candidate_id).join(',')],
    queryFn: async () => {
      const result: Record<string, boolean> = {}
      await Promise.all(
        passedCandidates.map(async (sc) => {
          try {
            await api.get(`/api/candidates/${sc.candidate_id}/report`)
            result[sc.candidate_id] = true
          } catch {
            result[sc.candidate_id] = false
          }
        }),
      )
      return result
    },
    enabled: passedCandidates.length > 0,
    refetchInterval: 15000,
  })

  const reportExistsMap = reportChecks.data ?? {}

  // ── Loading ───────────────────────────────────────────────────────────────
  if (screeningLoading || sessionsLoading) {
    return (
      <div className="space-y-4">
        <InterviewRubricPanel job={job} />
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

  // ── Empty state ───────────────────────────────────────────────────────────
  if (passedCandidates.length === 0) {
    return (
      <div>
        <InterviewRubricPanel job={job} />
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <ClipboardList className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-slate-700 font-semibold mb-1">No candidates ready for interview</p>
          <p className="text-slate-400 text-sm max-w-xs">
            Once a candidate passes voice screening, they will appear below. You can set up the
            interview rubric above anytime.
          </p>
        </div>
      </div>
    )
  }

  // ── Normal view ───────────────────────────────────────────────────────────
  return (
    <div>
      <InterviewRubricPanel job={job} />

      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-slate-500">
          {passedCandidates.length} candidate{passedCandidates.length !== 1 ? 's' : ''} ready
          for interview
        </p>
      </div>

      <div className="space-y-4">
        {passedCandidates.map((sc) => (
          <CandidateInterviewCard
            key={sc.candidate_id}
            candidateId={sc.candidate_id}
            candidateName={getCandidateName(sc.candidate_id)}
            jobId={jobId}
            hasReport={reportExistsMap[sc.candidate_id] ?? false}
            initialSession={sessionsMap[sc.candidate_id] ?? null}
          />
        ))}
      </div>
    </div>
  )
}

export default InterviewsTab
