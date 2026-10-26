import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, FileText, Loader2, Phone, Send, X } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { BTN_DANGER, BTN_SECONDARY, BTN_STAGE_LINK } from '@/components/ui/Surface'
import { describeStage } from '@/lib/shortlistDecision'
import type { ScreeningRow } from '@/components/screening/screeningRows'
import { ScreeningReportModal } from '@/components/screening/ScreeningReportModal'
import { displayField, isScreeningReportGenerating } from '@/components/screening/screeningUtils'
import type { JobOutletContext } from '@/components/JobLayout'
import { api } from '@/lib/api'
import {
  WORKFLOW_TABLE_CLASS,
} from '@/lib/workflow'

async function scheduleInterviewForRow(row: ScreeningRow) {
  const call = row.latestCall
  if (!call) throw new Error('No screening call found')

  if (call.result !== 'pass') {
    await api.patch(`/api/screening/${call.id}/result`, { result: 'pass' })
  }
  await api.post(`/api/candidates/${row.candidateId}/interview/send`)
}

function CompletedScreeningRow({
  row,
  jobId,
  onOpenReport,
}: {
  row: ScreeningRow
  jobId: string
  onOpenReport: (row: ScreeningRow) => void
}) {
  const queryClient = useQueryClient()
  const call = row.latestCall
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  if (!call) return null

  const isRejected = call.result === 'fail'
  const stage = row.shortlist.stage
  // Past screening: the interview owns the candidate now, so this row only says where they
  // are. (A passed call with no session yet is still this stage's to act on.)
  const pastScreening =
    Boolean(call.has_interview_session) || (stage?.kind === 'interview' && stage.state !== 'pending')
  const stageView = pastScreening && stage ? describeStage(stage, jobId) : null
  const isGenerating = isScreeningReportGenerating(call)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
    queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
    queryClient.invalidateQueries({ queryKey: ['voice-screening', jobId] })
    queryClient.invalidateQueries({ queryKey: ['candidates'] })
    queryClient.invalidateQueries({ queryKey: ['rejected', jobId] })
  }

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/api/jobs/${jobId}/candidates/${row.candidateId}/reject`),
    onSuccess: () => {
      invalidate()
      setConfirmReject(false)
      toast.success(`${row.candidateName} moved to Rejected`)
    },
    // No refresh here: the row may flip to its next stage underneath the dialog and take
    // the refusal's explanation with it. The lists refresh when the dialog is closed.
    onError: (err: Error) => setRejectError(err.message || 'Failed to reject candidate'),
  })

  const scheduleMutation = useMutation({
    mutationFn: () => scheduleInterviewForRow(row),
    onSuccess: () => {
      invalidate()
      toast.success(`Interview invitation sent to ${row.candidateName}`)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to schedule interview'),
  })

  const recallMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/jobs/${jobId}/screening/trigger`, {
        candidate_ids: [row.candidateId],
        force: true,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(`Recalling ${row.candidateName}`)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start call'),
  })

  const busy =
    isGenerating ||
    rejectMutation.isPending ||
    scheduleMutation.isPending ||
    recallMutation.isPending

  return (
    <tr className="hover:bg-slate-50/80">
      <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.candidateName}</td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {displayField(call.notice_period) ?? '—'}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {displayField(call.expected_ctc) ?? '—'}
      </td>
      <td className="px-4 py-3">
        {isGenerating ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <Loader2 size={12} className="animate-spin" />
            Generating…
          </span>
        ) : (
          <button type="button" onClick={() => onOpenReport(row)} className={BTN_SECONDARY}>
            <FileText size={13} aria-hidden />
            Report
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        {pastScreening ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-[13px] text-ink-muted">
              {stageView ? `${stageView.title} · ${stageView.detail}` : 'In Interviews'}
            </span>
            <Link to={stageView?.to ?? `/jobs/${jobId}/interviews`} className={BTN_STAGE_LINK}>
              Open Interviews
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {row.canCallNow && (
            <button
              type="button"
              onClick={() => recallMutation.mutate()}
              disabled={busy || row.isActive}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recallMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Phone size={12} />
              )}
              Recall
            </button>
          )}
          {row.isActive && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-600">
              <Loader2 size={12} className="animate-spin" />
              In progress
            </span>
          )}
          <button
            type="button"
            onClick={() => scheduleMutation.mutate()}
            disabled={busy || isRejected}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scheduleMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <Send size={13} aria-hidden />
            )}
            Send interview link
          </button>
          {isRejected ? (
            <span className="text-[13px] font-medium text-neg">Rejected</span>
          ) : (
            <button type="button" onClick={() => setConfirmReject(true)} disabled={busy} className={BTN_DANGER}>
              <X size={13} aria-hidden />
              Reject
            </button>
          )}
        </div>
        )}
      </td>
      {confirmReject && (
        <ConfirmDialog
          title={`Reject ${row.candidateName}?`}
          body={<p>They move to Rejected and are not emailed until you send it from the Rejected list. You can reconsider them until then.</p>}
          confirmLabel="Reject"
          busy={rejectMutation.isPending}
          error={rejectError}
          onConfirm={() => rejectMutation.mutate()}
          onClose={() => {
            if (rejectError) invalidate() // refused: the row may be stale now
            setConfirmReject(false)
            setRejectError(null)
          }}
        />
      )}
    </tr>
  )
}

export function CompletedScreeningList({
  rows,
  jobId,
}: {
  rows: ScreeningRow[]
  jobId: string
}) {
  const { job } = useOutletContext<JobOutletContext>()
  const queryClient = useQueryClient()
  const [reportRow, setReportRow] = useState<ScreeningRow | null>(null)

  const schedulableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.latestCall &&
          row.latestCall.result !== 'fail' &&
          !row.latestCall.has_interview_session &&
          !isScreeningReportGenerating(row.latestCall),
      ),
    [rows],
  )

  const scheduleAllMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        schedulableRows.map((row) => scheduleInterviewForRow(row)),
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - succeeded
      return { succeeded, failed, total: results.length }
    },
    onSuccess: ({ succeeded, failed, total }) => {
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
    queryClient.invalidateQueries({ queryKey: ['voice-screening', jobId] })
      if (total === 0) {
        toast('No candidates to schedule')
        return
      }
      if (failed === 0) {
        toast.success(`Scheduled ${succeeded} interview${succeeded === 1 ? '' : 's'}`)
      } else {
        toast.error(`Scheduled ${succeeded} of ${total}; ${failed} failed`)
      }
    },
    onError: () => toast.error('Failed to schedule interviews'),
  })

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-slate-500">No completed screenings yet.</p>
    )
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-slate-500">{rows.length} completed</p>
        {schedulableRows.length > 0 && (
          <button
            type="button"
            onClick={() => scheduleAllMutation.mutate()}
            disabled={scheduleAllMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {scheduleAllMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} />
            )}
            Schedule all ({schedulableRows.length})
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className={WORKFLOW_TABLE_CLASS}>
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Candidate
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notice Period
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Expected CTC
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Report
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {rows.map((row) =>
              row.latestCall ? (
                <CompletedScreeningRow
                  key={row.candidateId}
                  row={row}
                  jobId={jobId}
                  onOpenReport={setReportRow}
                />
              ) : null,
            )}
          </tbody>
        </table>
      </div>

      {reportRow?.latestCall && (
        <ScreeningReportModal
          call={reportRow.latestCall}
          jobId={jobId}
          candidateName={reportRow.candidateName}
          phone={reportRow.phone}
          attemptNumber={reportRow.attemptNumber}
          jobTitle={job.title}
          onClose={() => setReportRow(null)}
        />
      )}
    </>
  )
}
