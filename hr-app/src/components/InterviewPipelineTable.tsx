import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { InterviewPipelineCandidate } from '@/types/api'
import { WORKFLOW_TABLE_CLASS } from '@/lib/workflow'

interface Props {
  jobId: string
  rows: InterviewPipelineCandidate[]
  variant: 'completed' | 'flagged'
  returnSearch: string
  onRescheduled?: () => void
}

function interviewStatusLabel(row: InterviewPipelineCandidate): string {
  const session = row.session
  if (row.assessment_status === 'failed') return 'Assessment Failed'
  if (row.has_report) return 'Completed'
  if (session?.status === 'in_progress') return 'In Progress'
  if (session?.status === 'expired') return 'Expired'
  if (session?.status === 'completed') return 'Completed'
  if (session?.status === 'pending') return 'Link Sent'
  return 'Not Sent'
}

function RescheduleButton({
  row,
  jobId,
  onSuccess,
}: {
  row: InterviewPipelineCandidate
  jobId: string
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()

  const rescheduleMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/candidates/${row.candidate_id}/interview/reschedule`),
    onSuccess: () => {
      toast.success(
        `Interview rescheduled — email sent to ${row.candidate_name ?? 'candidate'}`,
      )
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
      onSuccess()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to reschedule interview'),
  })

  const disabled =
    row.actions_disabled || !row.can_reschedule || row.has_active_session

  let title = 'Send a new interview link by email'
  if (row.actions_disabled) title = 'Candidate or job no longer available'
  else if (row.has_active_session) title = 'Another interview is already pending or in progress'
  else if (!row.can_reschedule) title = 'Reschedule is not available'

  return (
    <button
      type="button"
      disabled={disabled || rescheduleMutation.isPending}
      title={title}
      onClick={() => rescheduleMutation.mutate()}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {rescheduleMutation.isPending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <RefreshCw size={12} />
      )}
      Reschedule
    </button>
  )
}

export function InterviewPipelineTable({
  jobId,
  rows,
  variant,
  returnSearch,
  onRescheduled,
}: Props) {
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/api/candidates/${candidateId}/interview/retry-assessment`),
    onSuccess: () => {
      toast.success('Assessment retry started')
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to retry assessment'),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
  }

  const handleRescheduled = () => {
    invalidate()
    onRescheduled?.()
  }

  const reportLink = (candidateId: string) =>
    `/jobs/${jobId}/candidates/${candidateId}/report${returnSearch}`

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className={WORKFLOW_TABLE_CLASS}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Candidate Name</th>
            <th className="px-4 py-3">Interview Status</th>
            {variant === 'completed' && (
              <>
                <th className="px-4 py-3">Hire Recommendation</th>
                <th className="px-4 py-3">Interview Score</th>
              </>
            )}
            {variant === 'flagged' && <th className="px-4 py-3">Reason</th>}
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const reportReady = row.has_report || row.assessment_status === 'ready'
            const generating = row.assessment_status === 'generating'
            const assessmentFailed = row.assessment_status === 'failed'
            const actionsDisabled = Boolean(row.actions_disabled)

            return (
              <tr key={row.candidate_id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  {row.candidate_name ?? 'Candidate'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {interviewStatusLabel(row)}
                </td>
                {variant === 'completed' && (
                  <>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.report_recommendation ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.report_overall_score != null
                        ? row.report_overall_score
                        : '—'}
                    </td>
                  </>
                )}
                {variant === 'flagged' && (
                  <td className="px-4 py-3 text-sm text-amber-800">
                    {row.flag_reason ?? '—'}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {variant === 'completed' && (
                      <>
                        {assessmentFailed && !actionsDisabled && (
                          <button
                            type="button"
                            onClick={() => retryMutation.mutate(row.candidate_id)}
                            disabled={retryMutation.isPending}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {retryMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            Retry Assessment
                          </button>
                        )}
                        {generating && (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <Loader2 size={12} className="animate-spin" />
                            Generating...
                          </span>
                        )}
                        {reportReady && !actionsDisabled ? (
                          <Link
                            to={reportLink(row.candidate_id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                          >
                            <FileText size={12} />
                            View Report
                          </Link>
                        ) : (
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
                    <RescheduleButton
                      row={row}
                      jobId={jobId}
                      onSuccess={handleRescheduled}
                    />
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
