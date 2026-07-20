import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, RotateCcw, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import {
  WORKFLOW_CARD_CLASS,
  formatUploadedAt,
  pipelineStatusLabel,
  resumeDisplayName,
} from '@/lib/workflow'

interface Props {
  jobId: string
  candidates: Candidate[]
  watchedTotal: number
  watchedDone: number
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  onComplete?: () => void
}

export function ProcessingTab({
  jobId,
  candidates,
  watchedTotal,
  watchedDone,
  isLoading = false,
  isError = false,
  onRetry,
  onComplete,
}: Props) {
  const queryClient = useQueryClient()
  const completionFiredRef = useRef(false)

  const inFlight = candidates.filter(
    (c) => c.pipeline_status === 'queued' || c.pipeline_status === 'processing',
  )
  const failed = candidates.filter((c) => c.pipeline_status === 'failed')
  const total = watchedTotal > 0 ? watchedTotal : inFlight.length + watchedDone
  const done =
    watchedTotal > 0
      ? watchedDone
      : candidates.filter((c) => c.pipeline_status === 'completed').length
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0
  const allSettled = total > 0 && done >= total

  useEffect(() => {
    if (!allSettled || completionFiredRef.current) return
    completionFiredRef.current = true
    const succeeded = candidates.filter((c) => c.pipeline_status === 'completed').length
    const failedCount = candidates.filter((c) => c.pipeline_status === 'failed').length
    if (failedCount > 0) {
      toast.success(`AI review complete — ${succeeded} scored, ${failedCount} failed`)
    } else {
      toast.success(`AI review complete — ${succeeded} resume(s) scored`)
    }
    onComplete?.()
  }, [allSettled, candidates, onComplete])

  const retryMutation = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/api/jobs/${jobId}/candidates/${candidateId}/retry-processing`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      toast.success('Re-queued for AI review')
    },
    onError: () => toast.error('Failed to retry'),
  })

  const displayList =
    watchedTotal > 0
      ? candidates
      : [...inFlight, ...failed]

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">AI Review in Progress</h2>
        <p className="text-sm text-slate-500">
          AI is reading each resume and scoring fit against the job description.
        </p>
      </div>

      {total > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              Reviewing {Math.min(done + inFlight.length, total)} of {total} resume
              {total !== 1 ? 's' : ''}…
            </span>
            <span className="tabular-nums text-slate-500">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {isError && onRetry && <BackendError onRetry={onRetry} />}

      {!isError && (
        <div className={WORKFLOW_CARD_CLASS}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-300" />
            </div>
          ) : displayList.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-400">
              No resumes are being reviewed right now. Upload resumes to start AI scoring.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {displayList.map((candidate) => {
                const name = resumeDisplayName(candidate)
                const isProcessing = candidate.pipeline_status === 'processing'
                const isQueued = candidate.pipeline_status === 'queued'
                const isFailed = candidate.pipeline_status === 'failed'
                const isDone = candidate.pipeline_status === 'completed'
                return (
                  <li key={candidate.id} className="flex items-start gap-4 px-6 py-4">
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                          ✓
                        </span>
                      ) : isFailed ? (
                        <AlertCircle size={20} className="text-rose-500" />
                      ) : (
                        <Loader2 size={20} className="animate-spin text-indigo-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Uploaded {formatUploadedAt(candidate.created_at)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {isProcessing || isQueued
                          ? 'AI is reading the resume and scoring fit against the job description…'
                          : isFailed
                            ? 'Review failed — try again or re-upload the file.'
                            : 'Scored and ready on the AI Shortlisted tab.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isFailed
                            ? 'bg-rose-100 text-rose-700'
                            : isDone
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {pipelineStatusLabel(candidate.pipeline_status)}
                      </span>
                      {isFailed && (
                        <button
                          type="button"
                          onClick={() => retryMutation.mutate(candidate.id)}
                          disabled={retryMutation.isPending}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          <RotateCcw size={12} />
                          Retry
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default ProcessingTab
