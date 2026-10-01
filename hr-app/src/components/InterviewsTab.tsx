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
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { ScreeningCall, InterviewSession, Candidate } from '@/types/api'

// ---------------------------------------------------------------------------
// Interview status chip
// ---------------------------------------------------------------------------

type InterviewStatus = 'not_sent' | 'link_sent' | 'in_progress' | 'completed' | 'report_ready'

const INTERVIEW_STATUS_CONFIG: Record<
  InterviewStatus,
  { label: string; className: string }
> = {
  not_sent: { label: 'Not Sent', className: 'bg-slate-100 text-slate-500' },
  link_sent: { label: 'Link Sent', className: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'In Progress', className: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700' },
  report_ready: { label: 'Report Ready', className: 'bg-indigo-100 text-indigo-700' },
}

function InterviewStatusChip({ status }: { status: InterviewStatus }) {
  const cfg = INTERVIEW_STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  )
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
    <div className="mt-3 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <span className="flex-1 text-xs text-slate-600 font-mono truncate">{url}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-700"
        title="Copy link"
      >
        {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
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

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0 uppercase">
            {(candidateName[0] ?? 'C')}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{candidateName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Pass badge */}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            Pass
          </span>

          {/* Interview status chip */}
          <InterviewStatusChip status={interviewStatus} />

          {/* Action buttons */}
          {interviewStatus === 'not_sent' && (
            <button
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send size={12} />
                  Send Interview Link
                </>
              )}
            </button>
          )}

          {interviewStatus === 'report_ready' && (
            <Link
              to={`/jobs/${jobId}/candidates/${candidateId}/report`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <FileText size={12} />
              View Report
            </Link>
          )}
        </div>
      </div>

      {/* Copyable URL after sending */}
      {session?.interview_url && (
        <div className="mt-3">
          <p className="text-xs text-slate-500 mb-1">Interview link (share with candidate):</p>
          <CopyableUrl url={session.interview_url} />
          {session.email_sent_at && (
            <p className="text-xs text-slate-400 mt-1.5">
              Email sent at {new Date(session.email_sent_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {sendError && (
        <div className="mt-3 flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
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
  jobId: string
}

export function InterviewsTab({ jobId }: Props) {
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
        {[1, 2].map((i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
              <div className="h-4 bg-slate-200 rounded w-36" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (passedCandidates.length === 0) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <ClipboardList className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-700 font-semibold mb-1">No candidates ready for interview</p>
        <p className="text-slate-400 text-sm max-w-xs">
          No candidates have passed voice screening yet. Once screening is complete with a Pass
          result, candidates will appear here.
        </p>
      </div>
    )
  }

  // ── Normal view ───────────────────────────────────────────────────────────
  return (
    <div>
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
