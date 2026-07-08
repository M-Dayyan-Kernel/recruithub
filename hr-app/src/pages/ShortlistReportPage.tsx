import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, ShortlistResultWithCandidate } from '@/types/api'
import { ShortlistReportContent } from '@/components/shortlist/ShortlistReportContent'
import {
  HrDecisionBadge,
  RecommendationBadge,
  ScoreBadge,
} from '@/components/shortlist/shortlistBadges'

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 h-6 w-56 rounded bg-slate-200" />
        <div className="h-4 w-40 rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  )
}

export default function ShortlistReportPage() {
  const { jobId, shortlistId } = useParams<{ jobId: string; shortlistId: string }>()

  const { data: job, isLoading: jobLoading } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}`) as unknown as Promise<Job>,
    enabled: !!jobId,
  })

  const {
    data: results,
    isLoading: shortlistLoading,
    isError,
  } = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<
        ShortlistResultWithCandidate[]
      >,
    enabled: !!jobId,
  })

  const result = results?.find((r) => r.id === shortlistId)
  const isLoading = jobLoading || shortlistLoading
  const notFound = !isLoading && !isError && results && !result

  const displayName = result?.candidate_name ?? 'Candidate'
  const displayEmail = result?.candidate_email

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        to={jobId ? `/jobs/${jobId}` : '/'}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeft size={14} />
        Back to Job
      </Link>

      {isLoading && <ReportSkeleton />}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle size={16} className="shrink-0" />
          Failed to load shortlist report. Please try again.
        </div>
      )}

      {notFound && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <AlertCircle className="h-7 w-7 text-slate-400" />
          </div>
          <p className="mb-2 text-lg font-semibold text-slate-700">Report Not Found</p>
          <p className="max-w-sm text-sm text-slate-400">
            This shortlist result may have been removed or the URL is incorrect.
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="mb-1 text-2xl font-bold text-slate-900">{displayName}</h1>
                {displayEmail && <p className="text-sm text-slate-500">{displayEmail}</p>}
                {job?.title && (
                  <p className="mt-1 text-sm text-slate-400">{job.title}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result.hr_decision !== 'pending' && (
                  <HrDecisionBadge decision={result.hr_decision} />
                )}
                <ScoreBadge score={result.match_score} />
                <RecommendationBadge rec={result.recommendation} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <ShortlistReportContent
              result={result}
              requiredSkills={job?.required_skills ?? []}
            />
          </div>
        </div>
      )}
    </div>
  )
}
