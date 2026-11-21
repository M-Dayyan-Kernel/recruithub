import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, Clock, Loader2, PauseCircle, RotateCcw } from 'lucide-react'
import type { Candidate } from '@/types/api'
import { api } from '@/lib/api'
import { BackendError } from '@/components/BackendError'
import { RemoveResumeButton } from '@/components/RemoveResumeButton'
import { BTN_SECONDARY, Badge, ToneCard } from '@/components/ui/Surface'
import { describeProcessingRow, type ProcessingRowKind } from '@/lib/processingStatus'
import { WORKFLOW_CARD_CLASS, formatUploadedAt, resumeDisplayName } from '@/lib/workflow'

/** How often the elapsed times re-render when the list itself has not changed. */
const CLOCK_TICK_MS = 15_000

function RowIcon({ kind }: { kind: ProcessingRowKind }) {
  switch (kind) {
    case 'done':
      return <CheckCircle2 size={20} className="text-pos" aria-hidden />
    case 'reviewing':
      return <Loader2 size={20} className="animate-spin text-ink-muted" aria-hidden />
    case 'queued':
      return <Clock size={20} className="text-ink-subtle" aria-hidden />
    case 'retrying':
      return <RotateCcw size={20} className="text-warn" aria-hidden />
    case 'paused':
      return <PauseCircle size={20} className="text-warn" aria-hidden />
    default:
      return <AlertTriangle size={20} className="text-warn" aria-hidden />
  }
}

interface Props {
  jobId?: string
  candidates: Candidate[]
  watchedTotal: number
  watchedDone: number
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  /** Called once when every watched resume has settled, with how many of them failed. */
  onComplete?: (summary: { failed: number }) => void
  /** Whether a worker is listening for resume reviews; undefined while unknown. */
  processingAvailable?: boolean
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
  processingAvailable,
}: Props) {
  const completionFiredRef = useRef(false)
  const queryClient = useQueryClient()

  const inFlight = candidates.filter(
    (c) => c.pipeline_status === 'queued' || c.pipeline_status === 'processing',
  )
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
    onComplete?.({ failed: failedCount })
  }, [allSettled, candidates, onComplete])

  // Failures are listed, with their reason and Retry, on the Failed tab. They still count as
  // settled in the progress bar above, so a batch can finish.
  const displayList = (watchedTotal > 0 ? candidates : inFlight).filter(
    (c) => c.pipeline_status !== 'failed',
  )

  // The list only re-renders when its data changes; a paused queue does not change, and its
  // "waiting 12 min" must still count up.
  const [now, setNow] = useState(() => Date.now())
  const hasInFlight = inFlight.length > 0
  useEffect(() => {
    if (!hasInFlight) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [hasInFlight, candidates])

  const rows = displayList.map((candidate) => ({
    candidate,
    row: describeProcessingRow(candidate, now, processingAvailable),
  }))
  const stalled = rows.filter((r) => r.row.canRetry)
  const paused = processingAvailable === false && hasInFlight

  const refresh = () => {
    if (!jobId) return
    void queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
  }

  const retryOne = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/api/jobs/${jobId}/candidates/${candidateId}/retry-processing`),
    onSuccess: () => toast.success('Re-queued for AI review'),
    // The server says why it refused (the review is still running), so show that.
    onError: (err: Error) => toast.error(err.message || 'Failed to retry'),
    onSettled: refresh,
  })

  const retryStalled = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0
      for (const id of ids) {
        try {
          await api.post(`/api/jobs/${jobId}/candidates/${id}/retry-processing`)
          ok += 1
        } catch {
          /* counted below */
        }
      }
      return { ok, total: ids.length }
    },
    onSuccess: ({ ok, total }) => {
      if (ok < total) toast.error(`${ok} re-queued, ${total - ok} could not be retried`)
      else toast.success(`${ok} re-queued for AI review`)
    },
    onSettled: refresh,
  })

  const busy = retryOne.isPending || retryStalled.isPending

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">AI Review in Progress</h2>
        <p className="text-sm text-ink-muted">
          AI is reading each resume and scoring fit against the job description.
        </p>
      </div>

      {paused && (
        <ToneCard tone="warn" className="flex items-start gap-3 px-5 py-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">AI review is paused</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              The processing service is offline.{' '}
              <span className="font-mono tabular-nums">{inFlight.length}</span>{' '}
              {inFlight.length === 1 ? 'resume is' : 'resumes are'} waiting and will continue automatically
              when it&apos;s back. Nothing needs to be uploaded again.
            </p>
          </div>
        </ToneCard>
      )}

      {total > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {allSettled
                ? `Finished ${total} resume${total !== 1 ? 's' : ''}`
                : `Reviewed ${done} of ${total} resume${total !== 1 ? 's' : ''}…`}
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

      {jobId && stalled.length >= 2 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            Some resumes are taking longer than usual. Retrying starts their review again.
          </p>
          <button
            type="button"
            onClick={() => retryStalled.mutate(stalled.map((r) => r.candidate.id))}
            disabled={busy}
            className={BTN_SECONDARY}
          >
            {retryStalled.isPending ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw size={13} aria-hidden />
            )}
            {/* One element: the button is a flex row with a gap, which split "(", the count and ")". */}
            <span>
              Retry stalled (<span className="font-mono tabular-nums">{stalled.length}</span>)
            </span>
          </button>
        </div>
      )}

      {isError && onRetry && <BackendError onRetry={onRetry} />}

      {!isError && (
        <div className={WORKFLOW_CARD_CLASS}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-ink-subtle" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-ink-subtle">
              No resumes are being reviewed right now. Upload resumes from the job overview to start AI scoring.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map(({ candidate, row }) => {
                const name = resumeDisplayName(candidate)
                return (
                  <li key={candidate.id} className="flex flex-wrap items-start gap-4 px-6 py-4 sm:flex-nowrap">
                    <div className="mt-0.5 shrink-0">
                      <RowIcon kind={row.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{name}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Uploaded {formatUploadedAt(candidate.created_at)}
                      </p>
                      <p className="mt-1 text-sm tabular-nums text-ink-muted">{row.detail}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge tone={row.tone}>{row.label}</Badge>
                      {jobId && (row.canRetry || row.canRemove) && (
                        <div className="flex gap-2">
                          {row.canRetry && (
                            <button
                              type="button"
                              onClick={() => retryOne.mutate(candidate.id)}
                              disabled={busy}
                              className={BTN_SECONDARY}
                            >
                              <RotateCcw size={13} aria-hidden />
                              Retry
                            </button>
                          )}
                          {row.canRemove && (
                            <RemoveResumeButton jobId={jobId} candidateId={candidate.id} name={name} disabled={busy} />
                          )}
                        </div>
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
