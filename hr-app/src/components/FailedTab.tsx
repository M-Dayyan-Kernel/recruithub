import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'
import { WORKFLOW_CARD_CLASS, formatUploadedAt, resumeDisplayName } from '@/lib/workflow'

interface Props {
  jobId: string
  candidates: Candidate[]
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
}

/**
 * Resumes the AI review could not finish. They have no score, so they are on neither the
 * Resume Screening list nor, once settled, the Processing list; without this tab they were
 * only visible as part of the job's applicant total.
 */
export function FailedTab({ jobId, candidates, isLoading = false, isError = false, onRetry }: Props) {
  const queryClient = useQueryClient()

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    void queryClient.invalidateQueries({ queryKey: ['candidates'] })
  }

  const retryOne = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/api/jobs/${jobId}/candidates/${candidateId}/retry-processing`),
    onSuccess: () => toast.success('Re-queued for AI review'),
    onError: () => toast.error('Failed to retry'),
    onSettled: refresh,
  })

  const retryAll = useMutation({
    mutationFn: async () => {
      // One at a time: the queue meters how many run at once, and a failure on one should not
      // stop the rest being re-queued.
      let ok = 0
      for (const c of candidates) {
        try {
          await api.post(`/api/jobs/${jobId}/candidates/${c.id}/retry-processing`)
          ok += 1
        } catch {
          /* counted below */
        }
      }
      return ok
    },
    onSuccess: (ok) => {
      const failed = candidates.length - ok
      if (failed > 0) toast.error(`${ok} re-queued, ${failed} could not be retried`)
      else toast.success(`${ok} re-queued for AI review`)
    },
    onSettled: refresh,
  })

  const busy = retryOne.isPending || retryAll.isPending

  if (isError && onRetry) return <BackendError onRetry={onRetry} />

  return (
    <div className="space-y-4">
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            These resumes could not be scored, so they are not on the Resume Screening list. Retry them, or
            re-upload the file if the reason says it cannot be read.
          </p>
          <button type="button" onClick={() => retryAll.mutate()} disabled={busy} className={BTN_PRIMARY}>
            {retryAll.isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Retry all ({candidates.length})
          </button>
        </div>
      )}

      <div className={WORKFLOW_CARD_CLASS}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-ink-subtle" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <CheckCircle2 size={28} className="mb-3 text-pos" aria-hidden />
            <p className="text-sm font-medium text-ink">Nothing has failed</p>
            <p className="mt-1 text-sm text-ink-muted">Every uploaded resume was scored or is still being reviewed.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex items-start gap-4 px-5 py-4">
                <AlertCircle size={20} className="mt-0.5 shrink-0 text-neg" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{resumeDisplayName(candidate)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">Uploaded {formatUploadedAt(candidate.created_at)}</p>
                  <p className="mt-1.5 break-words text-sm text-ink-muted">
                    <span className="font-medium text-neg">Why: </span>
                    {candidate.failure_reason?.trim() || 'No reason was recorded.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => retryOne.mutate(candidate.id)}
                  disabled={busy}
                  className={BTN_SECONDARY}
                >
                  <RotateCcw size={13} aria-hidden />
                  Retry
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default FailedTab
