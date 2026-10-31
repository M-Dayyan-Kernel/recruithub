import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, Check, FileText, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { InterviewPipelineCandidate, InterviewSession, Job } from '@/types/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'
import { ScheduleInterviewModal, type ScheduleMode } from '@/components/screening/ScheduleInterviewModal'
import { VoidRoundDialog } from '@/components/VoidRoundDialog'
import { hasAction, interviewRowStatusLabel, roundLabel } from '@/lib/interviewStatus'
import { WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

interface Props {
  job: Job
  jobId: string
  rows: InterviewPipelineCandidate[]
  variant: 'completed' | 'flagged' | 'finalists'
  returnSearch: string
  onRescheduled?: () => void
}

/** Every action on one candidate's current round. The server says which are available. */
function RowActions({
  row,
  job,
  jobId,
  onRescheduled,
}: {
  row: InterviewPipelineCandidate
  job: Job
  jobId: string
  onRescheduled?: () => void
}) {
  const queryClient = useQueryClient()
  const name = row.candidate_name ?? 'Candidate'
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)

  const refresh = () => {
    for (const key of ['interviews-pipeline', 'finalists', 'rejected']) {
      queryClient.invalidateQueries({ queryKey: [key, jobId] })
    }
    queryClient.invalidateQueries({ queryKey: ['candidates'] })
    queryClient.invalidateQueries({ queryKey: ['candidate', row.candidate_id] })
    queryClient.invalidateQueries({ queryKey: ['report', row.candidate_id] })
  }

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/api/candidates/${row.candidate_id}/interview/retry-assessment`),
    onSuccess: () => {
      toast.success('Assessment retry started')
      refresh()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to retry assessment'),
  })

  const finalistMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/candidates/${row.candidate_id}/finalist`) as unknown as Promise<InterviewSession>,
    onSuccess: () => {
      refresh()
      toast.success(`${name} moved to Finalists`)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to mark finalist'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/candidates/${row.candidate_id}/reject`),
    onSuccess: () => {
      refresh()
      setConfirmReject(false)
      toast.success(`${name} moved to Rejected`)
    },
    // Refreshed when the dialog closes, not now: the row may leave the tab underneath it.
    onError: (err: Error) => setRejectError(err.message || 'Failed to reject candidate'),
  })

  if (row.is_live) {
    return <span className="text-xs text-ink-muted">Interview in progress</span>
  }

  const busy = retryMutation.isPending || finalistMutation.isPending || rejectMutation.isPending
  return (
    <>
      {hasAction(row, 'retry_assessment') && (
        <button
          type="button"
          onClick={() => retryMutation.mutate()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {retryMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Retry Assessment
        </button>
      )}
      {hasAction(row, 'mark_finalist') && (
        <button type="button" disabled={busy} onClick={() => finalistMutation.mutate()} className={BTN_PRIMARY}>
          {finalistMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Mark finalist
        </button>
      )}
      {hasAction(row, 'next_round') && (
        <button type="button" disabled={busy} onClick={() => setScheduleMode('next_round')} className={BTN_SECONDARY}>
          <ArrowRight size={12} />
          Next round
        </button>
      )}
      {hasAction(row, 'reschedule') && (
        <button type="button" disabled={busy} onClick={() => setScheduleMode('reschedule')} className={BTN_SECONDARY}>
          <CalendarClock size={12} />
          Reschedule
        </button>
      )}
      {hasAction(row, 'void_round') && (
        <button type="button" disabled={busy} onClick={() => setConfirmVoid(true)} className={BTN_SECONDARY}>
          <RotateCcw size={12} />
          Void round
        </button>
      )}
      {hasAction(row, 'reject') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRejectError(null)
            setConfirmReject(true)
          }}
          className={BTN_DANGER}
        >
          <X size={12} />
          Reject
        </button>
      )}

      {scheduleMode && (
        <ScheduleInterviewModal
          job={job}
          candidateId={row.candidate_id}
          candidateName={name}
          open
          mode={scheduleMode}
          onClose={() => setScheduleMode(null)}
          onSuccess={() => {
            refresh()
            onRescheduled?.()
          }}
        />
      )}
      {confirmVoid && row.round_number > 0 && (
        <VoidRoundDialog
          candidateId={row.candidate_id}
          candidateName={name}
          roundNumber={row.round_number}
          onClose={() => setConfirmVoid(false)}
          onVoided={() => {
            refresh()
            onRescheduled?.()
          }}
        />
      )}
      {confirmReject && (
        <ConfirmDialog
          title={`Reject ${name}?`}
          body={
            <p>
              They move to Rejected and are not emailed until you send it from the Rejected list.
              You can reconsider them until then.
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
            if (rejectError) refresh()
            setConfirmReject(false)
            setRejectError(null)
          }}
        />
      )}
    </>
  )
}

export function InterviewPipelineTable({ job, jobId, rows, variant, returnSearch, onRescheduled }: Props) {
  const reportLink = (candidateId: string) =>
    `/jobs/${jobId}/candidates/${candidateId}/report${returnSearch}`

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className={WORKFLOW_TABLE_CLASS}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Candidate Name</th>
            <th className="px-4 py-3">Interview Status</th>
            {variant === 'completed' || variant === 'finalists' ? (
              <>
                <th className="px-4 py-3">Hire Recommendation</th>
                <th className="px-4 py-3">Interview Score</th>
              </>
            ) : null}
            {variant === 'flagged' && <th className="px-4 py-3">Reason</th>}
            <th className="px-4 py-3 text-right">Report</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const reportReady = row.has_report || row.assessment_status === 'ready'
            const generating = row.assessment_status === 'generating'
            const assessmentFailed = row.assessment_status === 'failed'
            const round = roundLabel(row)

            return (
              <tr key={row.candidate_id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  <div className="flex items-center gap-2">
                    {row.candidate_name ?? 'Candidate'}
                    {round && (
                      <span
                        title={`${row.round_count} round${row.round_count === 1 ? '' : 's'} so far`}
                        className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
                      >
                        {round}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{interviewRowStatusLabel(row)}</td>
                {variant === 'completed' || variant === 'finalists' ? (
                  <>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.report_recommendation ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.report_overall_score != null ? row.report_overall_score : '—'}
                    </td>
                  </>
                ) : null}
                {variant === 'flagged' && (
                  <td className="px-4 py-3 text-sm text-amber-800">{row.flag_reason ?? '—'}</td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {(variant === 'completed' || variant === 'finalists') && (
                      <>
                        {variant === 'completed' && generating && (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <Loader2 size={12} className="animate-spin" />
                            Generating...
                          </span>
                        )}
                        {reportReady ? (
                          <Link to={reportLink(row.candidate_id)} className={BTN_SECONDARY}>
                            <FileText size={12} />
                            View Report
                          </Link>
                        ) : (
                          variant === 'completed' &&
                          !assessmentFailed &&
                          !generating && (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-400"
                            >
                              <FileText size={12} />
                              View Report
                            </button>
                          )
                        )}
                      </>
                    )}
                    <RowActions row={row} job={job} jobId={jobId} onRescheduled={onRescheduled} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
