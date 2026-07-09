import { useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, AlertCircle, Check, Download, Loader2, MessageSquareText, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { InterviewReport, InterviewQuestionScore } from '@/types/api'
import { downloadInterviewReportPdf } from '@/lib/interviewReportPdf'
import TranscriptChat from '@/components/TranscriptChat'
import { parseTranscript } from '@/lib/transcript'

// ---------------------------------------------------------------------------
// Rubric question card
// ---------------------------------------------------------------------------

function coveredCount(qs: InterviewQuestionScore): number | null {
  if (!qs.point_coverage?.length) return null
  return qs.point_coverage.filter((p) => p.covered).length
}

function QuestionScoreCard({ qs, index }: { qs: InterviewQuestionScore; index: number }) {
  const covered = coveredCount(qs)
  const totalExpected = qs.point_coverage?.length ?? qs.expected_points?.length ?? null
  const hasCoverage = (qs.point_coverage?.length ?? 0) > 0
  const hasCandidatePoints = (qs.candidate_points?.length ?? 0) > 0
  const showLegacyAnswer =
    Boolean(qs.candidate_answer?.trim()) && !hasCandidatePoints && !hasCoverage

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-800">
          Q{index + 1}. {qs.question}
        </p>
        <div className="shrink-0 text-right">
          <span className="text-sm font-semibold text-indigo-700">
            {qs.earned_score != null ? qs.earned_score : '—'}/{qs.score}
          </span>
          {covered != null && totalExpected != null && (
            <p className="mt-0.5 text-[10px] text-slate-400">
              {covered}/{totalExpected} points covered
            </p>
          )}
        </div>
      </div>

      {hasCoverage ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Expected answer
          </p>
          <ul className="mt-2 space-y-1.5">
            {qs.point_coverage!.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                {item.covered ? (
                  <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <X size={14} className="mt-0.5 shrink-0 text-rose-500" aria-hidden />
                )}
                <span className={item.covered ? 'text-slate-700' : 'text-slate-500'}>
                  {item.point}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (qs.expected_points?.length ?? 0) > 0 ? (
        <p className="mt-2 text-xs text-amber-600">
          Answer checklist is being prepared — reload this page in a moment.
        </p>
      ) : null}

      {hasCandidatePoints && (
        <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Candidate said
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
            {qs.candidate_points!.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {showLegacyAnswer && (
        <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Candidate answer
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
            {qs.candidate_answer}
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recommendation badge
// ---------------------------------------------------------------------------

type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire' | string

function RecommendationBadge({ rec }: { rec: Recommendation | undefined }) {
  if (!rec) return null

  const cfg: Record<string, { label: string; className: string }> = {
    strong_hire: {
      label: 'Strong Hire',
      className: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
    },
    hire: {
      label: 'Hire',
      className: 'bg-blue-100 text-blue-800 border border-blue-300',
    },
    hold: {
      label: 'Hold',
      className: 'bg-amber-100 text-amber-800 border border-amber-300',
    },
    no_hire: {
      label: 'No Hire',
      className: 'bg-rose-100 text-rose-800 border border-rose-300',
    },
  }

  const { label, className } = cfg[rec] ?? {
    label: rec,
    className: 'bg-slate-100 text-slate-700 border border-slate-300',
  }

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${className}`}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Score progress bar
// ---------------------------------------------------------------------------

function ScoreBar({ score }: { score: number | undefined }) {
  const pct = Math.min(Math.max(score ?? 0, 0), 100)
  const colour =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
      <div
        className={`h-2 rounded-full transition-all ${colour}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score card
// ---------------------------------------------------------------------------

interface ScoreCardProps {
  label: string
  score?: number
}

function ScoreCard({ label, score }: ScoreCardProps) {
  const display = score != null ? score : '—'
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">
        {display}
        {score != null && (
          <span className="text-sm font-normal text-slate-400 ml-1">/100</span>
        )}
      </p>
      <ScoreBar score={score} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ReportSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="h-7 bg-slate-200 rounded w-56 mb-3" />
        <div className="h-4 bg-slate-200 rounded w-40 mb-2" />
        <div className="h-8 bg-slate-100 rounded-full w-28" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="h-12 bg-slate-200 rounded-full w-24 mx-auto mb-6" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReportPage
// ---------------------------------------------------------------------------

export default function ReportPage() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>()
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  // ── Report ────────────────────────────────────────────────────────────────
  const {
    data: report,
    isLoading,
    isError,
    error,
  } = useQuery<InterviewReport>({
    queryKey: ['report', candidateId],
    queryFn: () =>
      api.get(`/api/candidates/${candidateId}/report`) as unknown as Promise<InterviewReport>,
    enabled: !!candidateId,
    retry: false,
    refetchInterval: (query) => (query.state.data ? false : 10_000),
  })

  // ── 404 / not-ready detection ─────────────────────────────────────────────
  const isReportNotReady =
    isError &&
    (error?.message?.includes('404') ||
     error?.message?.toLowerCase().includes('not found') ||
     error?.message?.toLowerCase().includes('not ready'))

  const SCORE_LABELS: Array<{ key: keyof InterviewReport; label: string }> = [
    { key: 'technical_fit_score', label: 'Technical Fit' },
    { key: 'communication_score', label: 'Communication' },
    { key: 'problem_solving_score', label: 'Problem Solving' },
    { key: 'experience_score', label: 'Experience' },
    { key: 'role_alignment_score', label: 'Role Alignment' },
  ]

  const transcriptTurns = useMemo(
    () => (report?.transcript ? parseTranscript(report.transcript) : []),
    [report?.transcript],
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back link */}
      <Link
        to={jobId ? `/jobs/${jobId}` : '/'}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Job
      </Link>

      {/* Loading */}
      {isLoading && <ReportSkeleton />}

      {/* 404 / Report not ready */}
      {isReportNotReady && (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-700 font-semibold text-lg mb-2">Report Not Ready Yet</p>
          <p className="text-slate-400 text-sm max-w-sm">
            The interview report isn't available yet. Check back after the interview completes.
          </p>
        </div>
      )}

      {/* Generic error */}
      {isError && !isReportNotReady && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          Failed to load report. Please try again.
        </div>
      )}

      {/* Report loaded */}
      {report && (
        <div className="space-y-6">
          {/* Header card — candidate name + job title + recommendation */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 mb-1">
                  {report.candidate_name ?? 'Interview Report'}
                </h1>
                {report.job_title && (
                  <p className="text-sm text-slate-500 mb-1">
                    {report.job_title}
                  </p>
                )}
                {!report.candidate_name && !report.job_title && (
                  <p className="text-sm text-slate-400 mb-1">Interview Assessment</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-3">
                <RecommendationBadge rec={report.final_recommendation} />
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={() => {
                    setDownloadingPdf(true)
                    try {
                      downloadInterviewReportPdf(report)
                      toast.success('Interview report downloaded')
                    } catch {
                      toast.error('Failed to generate PDF')
                    } finally {
                      setDownloadingPdf(false)
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloadingPdf ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  Download PDF
                </button>
              </div>
            </div>
          </div>

          {/* Overall score */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center">
            <p className="text-sm text-slate-500 font-medium mb-2">Overall Score</p>
            <p className="text-6xl font-extrabold text-slate-900">
              {report.overall_score != null ? report.overall_score : '—'}
              {report.overall_score != null && (
                <span className="text-2xl font-normal text-slate-400">
                  {report.rubric_total != null ? `/${report.rubric_total}` : '/100'}
                </span>
              )}
            </p>
          </div>

          {/* Rubric question scores or legacy dimension breakdown */}
          {report.question_scores && report.question_scores.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Question Scores</h2>
              <div className="space-y-3">
                {report.question_scores.map((qs, i) => (
                  <QuestionScoreCard key={qs.id || i} qs={qs} index={i} />
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Score Breakdown</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SCORE_LABELS.map(({ key, label }) => (
                  <ScoreCard
                    key={key}
                    label={label}
                    score={report[key] as number | undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Strengths + Weaknesses */}
          {((report.strengths?.length ?? 0) > 0 || (report.weaknesses?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Strengths */}
              {(report.strengths?.length ?? 0) > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-800 mb-3">Strengths</h2>
                  <div className="flex flex-wrap gap-2">
                    {report.strengths!.map((s, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Weaknesses */}
              {(report.weaknesses?.length ?? 0) > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-800 mb-3">Areas to Improve</h2>
                  <div className="flex flex-wrap gap-2">
                    {report.weaknesses!.map((w, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {report.summary && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-3">Summary</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
            </div>
          )}

          {/* JD Fit */}
          {report.jd_fit && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-3">JD Fit</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{report.jd_fit}</p>
            </div>
          )}

          {/* Complete transcript */}
          {report.transcript && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-800">
                  <MessageSquareText size={18} className="text-indigo-500" />
                  Complete Interview Transcript
                </h2>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                  {transcriptTurns.length} messages
                </span>
              </div>
              <TranscriptChat transcript={report.transcript} maxHeightClass="max-h-[32rem]" />
            </div>
          )}

          {/* Transcript Summary (fallback when full transcript unavailable) */}
          {!report.transcript && report.transcript_summary && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-3">Transcript Summary</h2>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {report.transcript_summary}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
