import { useQuery } from '@tanstack/react-query'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type {
  Candidate,
  ShortlistResultWithCandidate,
  ScreeningCall,
  InterviewReport,
} from '@/types/api'

// ---------------------------------------------------------------------------
// Stage status type
// ---------------------------------------------------------------------------

type StageStatus = 'success' | 'fail' | 'in_progress' | 'pending'

function deriveShortlistStatus(
  result: ShortlistResultWithCandidate | undefined,
): StageStatus {
  if (!result) return 'pending'
  if (result.hr_decision === 'approved' || result.hr_decision === 'overridden') {
    return 'success'
  }
  if (result.hr_decision === 'rejected') return 'fail'
  if (result.recommendation === 'shortlisted') return 'success'
  if (result.recommendation === 'rejected') return 'fail'
  return 'in_progress'
}

function deriveScreeningStatus(call: ScreeningCall | undefined): StageStatus {
  if (!call) return 'pending'
  if (call.call_status === 'failed' || call.call_outcome === 'failed') return 'fail'
  if (call.call_status === 'completed' && call.result === 'pass') return 'success'
  if (call.call_status === 'completed' && call.result === 'fail') return 'fail'
  if (call.call_status === 'completed') return 'in_progress'
  if (['pending', 'initiated', 'in_progress'].includes(call.call_status)) {
    return 'in_progress'
  }
  return 'pending'
}

function deriveScreeningDetail(call: ScreeningCall | undefined): string {
  if (!call) return 'Not yet screened'
  if (call.call_status === 'failed' || call.call_outcome === 'failed') {
    return call.summary ?? 'Call failed — check Vapi/Twilio setup'
  }
  if (call.call_status === 'completed') {
    return `Result: ${call.result ?? 'pending review'}`
  }
  const statusLabels: Record<string, string> = {
    pending: 'Queued for calling',
    initiated: 'Calling candidate…',
    in_progress: 'Call in progress…',
  }
  return statusLabels[call.call_status] ?? `Status: ${call.call_status}`
}

interface TimelineStage {
  emoji: string
  label: string
  status: StageStatus
  detail: string
}

// ---------------------------------------------------------------------------
// Stage indicator
// ---------------------------------------------------------------------------

function StageIndicator({ status }: { status: StageStatus }) {
  if (status === 'success')
    return <CheckCircle size={13} className="text-emerald-500 shrink-0" />
  if (status === 'fail')
    return <XCircle size={13} className="text-rose-500 shrink-0" />
  if (status === 'in_progress')
    return <Loader2 size={13} className="animate-spin text-blue-500 shrink-0" />
  return null
}

const STATUS_DOT: Record<StageStatus, string> = {
  success: 'bg-emerald-500',
  fail: 'bg-rose-500',
  in_progress: 'bg-blue-400',
  pending: 'bg-slate-200',
}

const STATUS_CONNECTOR: Record<StageStatus, string> = {
  success: 'bg-emerald-200',
  fail: 'bg-rose-200',
  in_progress: 'bg-blue-100',
  pending: 'bg-slate-100',
}

const STATUS_LABEL: Record<StageStatus, string> = {
  success: 'text-slate-800',
  fail: 'text-rose-700',
  in_progress: 'text-blue-700',
  pending: 'text-slate-400',
}

// ---------------------------------------------------------------------------
// CandidateTimeline
// ---------------------------------------------------------------------------

interface Props {
  candidateId: string
  jobId: string
}

export function CandidateTimeline({ candidateId, jobId }: Props) {
  // ── Data fetches (reuse cached queries where possible) ────────────────────

  const { data: candidate } = useQuery<Candidate>({
    queryKey: ['candidate', candidateId],
    queryFn: () =>
      api.get(`/api/candidates/${candidateId}`) as unknown as Promise<Candidate>,
  })

  const { data: shortlistResults } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(
        `/api/jobs/${jobId}/shortlist`,
      ) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data
      const candidateResult = data?.find((r) => r.candidate_id === candidateId)
      if (!candidateResult) return false
      return candidateResult.recommendation === 'review' &&
        candidateResult.hr_decision === 'pending'
        ? 8000
        : false
    },
  })

  const { data: screeningCalls } = useQuery<ScreeningCall[]>({
    queryKey: ['screening', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/screening`) as unknown as Promise<ScreeningCall[]>,
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data
      const call = data?.find((sc) => sc.candidate_id === candidateId)
      if (!call) return false
      return ['pending', 'initiated', 'in_progress'].includes(call.call_status)
        ? 8000
        : false
    },
  })

  const { data: report } = useQuery<InterviewReport>({
    queryKey: ['report', candidateId],
    queryFn: () =>
      api.get(
        `/api/candidates/${candidateId}/report`,
      ) as unknown as Promise<InterviewReport>,
    retry: false,
  })

  // ── Derived data ──────────────────────────────────────────────────────────

  const shortlistResult = shortlistResults?.find(
    (r) => r.candidate_id === candidateId,
  )
  const screeningCall = screeningCalls?.find(
    (sc) => sc.candidate_id === candidateId,
  )

  // ── Compute stages ────────────────────────────────────────────────────────

  const parseStatus = candidate?.parse_status

  // Stage 1: Uploaded — always done once candidate exists
  const uploadedStatus: StageStatus = 'success'

  // Stage 2: Parsed
  const parsedStatus: StageStatus = !parseStatus
    ? 'pending'
    : parseStatus === 'ready'
    ? 'success'
    : parseStatus === 'parse_failed'
    ? 'fail'
    : ['parsing', 'parsed'].includes(parseStatus)
    ? 'in_progress'
    : 'pending'

  const parsedDetail =
    parseStatus === 'ready'
      ? 'Resume parsed & embedded'
      : parseStatus === 'parse_failed'
      ? 'Parsing failed — re-upload resume'
      : parseStatus === 'parsing'
      ? 'Parsing in progress…'
      : parseStatus === 'parsed'
      ? 'Generating embeddings…'
      : parseStatus === 'pending_parse'
      ? 'Waiting for a parse slot'
      : parseStatus === 'parse_queued'
      ? 'Queued for parsing'
      : 'Waiting to parse'

  // Stage 3: Shortlisted
  const shortlistStatus = deriveShortlistStatus(shortlistResult)

  const shortlistDetail = shortlistResult
    ? `${Math.round(shortlistResult.match_score)}% match · ${shortlistResult.recommendation}` +
      (shortlistResult.hr_decision !== 'pending'
        ? ` · HR: ${shortlistResult.hr_decision}`
        : '')
    : 'AI shortlisting not yet run'

  // Stage 4: Voice Screened
  const screeningStatus = deriveScreeningStatus(screeningCall)
  const screeningDetail = deriveScreeningDetail(screeningCall)

  // Stage 5: Interview
  const interviewStatus: StageStatus = report
    ? 'success'
    : screeningCall?.result === 'pass'
    ? 'in_progress'
    : 'pending'

  const interviewDetail = report
    ? 'Interview completed'
    : screeningCall?.result === 'pass'
    ? 'Link sent — awaiting interview'
    : 'Candidate must pass screening first'

  // Stage 6: Assessment
  const assessmentStatus: StageStatus = report ? 'success' : 'pending'

  const assessmentDetail = report
    ? [
        report.overall_score != null ? `Score: ${report.overall_score}/100` : null,
        report.final_recommendation
          ? `Recommendation: ${report.final_recommendation.replace(/_/g, ' ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Assessment complete'
    : 'Awaiting interview completion'

  // ── Stage list ────────────────────────────────────────────────────────────

  const stages: TimelineStage[] = [
    { emoji: '📄', label: 'Uploaded',       status: uploadedStatus,   detail: 'Resume received'     },
    { emoji: '🔍', label: 'Parsed',         status: parsedStatus,     detail: parsedDetail           },
    { emoji: '⚡', label: 'AI Shortlisted', status: shortlistStatus,  detail: shortlistDetail        },
    { emoji: '📞', label: 'Voice Screened', status: screeningStatus,  detail: screeningDetail        },
    { emoji: '🎤', label: 'Interview',      status: interviewStatus,  detail: interviewDetail        },
    { emoji: '📊', label: 'Assessment',     status: assessmentStatus, detail: assessmentDetail       },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-0">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1
        return (
          <div key={i} className="flex gap-3">
            {/* Left column: dot + connector */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5 ${
                  stage.status === 'pending' ? 'bg-slate-100' : 'bg-white border border-slate-200'
                }`}
              >
                {stage.emoji}
              </div>
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 my-1 rounded-full ${STATUS_CONNECTOR[stage.status]}`}
                  style={{ minHeight: 16 }}
                />
              )}
            </div>

            {/* Right column: text */}
            <div className={`${isLast ? 'pb-0' : 'pb-3'} min-w-0 flex-1 pt-0.5`}>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[stage.status]}`} />
                <p className={`text-sm font-medium leading-tight ${STATUS_LABEL[stage.status]}`}>
                  {stage.label}
                </p>
                <StageIndicator status={stage.status} />
              </div>
              <p className="text-xs text-slate-400 mt-0.5 ml-3">{stage.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default CandidateTimeline
