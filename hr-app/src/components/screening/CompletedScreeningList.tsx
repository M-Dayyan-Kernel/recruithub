import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Phone, Send } from 'lucide-react'
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
  if (!call) return null

  const isRejected = call.result === 'fail'
  const hasSession = Boolean(call.has_interview_session)
  const isGenerating = isScreeningReportGenerating(call)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
    queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
    queryClient.invalidateQueries({ queryKey: ['candidates'] })
  }

  const rejectMutation = useMutation({
    mutationFn: () => api.patch(`/api/screening/${call.id}/result`, { result: 'fail' }),
    onSuccess: () => {
      invalidate()
      toast.success(`${row.candidateName} rejected`)
    },
    onError: () => toast.error('Failed to reject candidate'),
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
          <button
            type="button"
            onClick={() => onOpenReport(row)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600"
          >
            Report
          </button>
        )}
      </td>
      <td className="px-4 py-3">
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
            disabled={busy || isRejected || hasSession}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              hasSession
                ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
            }`}
          >
            {scheduleMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} />
            )}
            {hasSession ? 'Scheduled' : 'Schedule'}
          </button>
          <button
            type="button"
            onClick={() => rejectMutation.mutate()}
            disabled={busy || isRejected}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isRejected
                ? 'border-rose-300 bg-rose-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50'
            }`}
          >
            {rejectMutation.isPending ? (
              <Loader2 size={12} className="inline animate-spin" />
            ) : null}
            Reject
          </button>
        </div>
      </td>
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
