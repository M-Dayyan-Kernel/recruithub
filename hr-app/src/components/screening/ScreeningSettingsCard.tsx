import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, Phone, Settings2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, ScreeningTriggerResponse } from '@/types/api'
import { ScreeningCriteriaModal } from '@/components/screening/ScreeningCriteriaModal'
import {
  formatTimeForInput,
  isWithinCallWindow,
} from '@/components/screening/screeningUtils'
import { WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'

interface Props {
  job: Job
  eligibleCandidateIds: string[]
  onCallsTriggered: () => void
}

export function ScreeningSettingsCard({ job, eligibleCandidateIds, onCallsTriggered }: Props) {
  const queryClient = useQueryClient()
  const [fromTime, setFromTime] = useState(
    formatTimeForInput(job.screening_call_from, '09:00'),
  )
  const [toTime, setToTime] = useState(formatTimeForInput(job.screening_call_to, '18:00'))
  const [criteriaOpen, setCriteriaOpen] = useState(false)

  const timezone = job.screening_timezone || 'Asia/Kolkata'
  const withinWindow = isWithinCallWindow(fromTime, toTime, timezone)

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/jobs/${job.id}`, {
        screening_call_from: `${fromTime}:00`,
        screening_call_to: `${toTime}:00`,
        screening_timezone: timezone,
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Screening settings saved')
    },
    onError: () => toast.error('Failed to save screening settings'),
  })

  const startMutation = useMutation({
    mutationFn: async (force: boolean) => {
      await api.patch(`/api/jobs/${job.id}`, {
        screening_call_from: `${fromTime}:00`,
        screening_call_to: `${toTime}:00`,
        screening_timezone: timezone,
      })
      return api.post(`/api/jobs/${job.id}/screening/trigger`, {
        candidate_ids: eligibleCandidateIds,
        force,
      }) as unknown as Promise<ScreeningTriggerResponse>
    },
    onSuccess: (data, force) => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      const total = data.initiated + data.queued
      if (total > 0) {
        if (!force && data.queued > 0) {
          toast.success(
            `Scheduled ${data.queued} call${data.queued !== 1 ? 's' : ''} for the next window (${fromTime}–${toTime} ${timezone})`,
          )
        } else {
          toast.success(
            `Started calling ${data.initiated} candidate${data.initiated !== 1 ? 's' : ''}` +
              (data.queued > 0 ? ` (${data.queued} queued for call window)` : ''),
          )
        }
      } else if (data.skipped.length > 0) {
        toast.error('No calls started — check skipped candidates')
      }
      onCallsTriggered()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start screening calls'),
  })

  return (
    <>
      <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-800">Screening Call Settings</h3>

        {!withinWindow && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Outside call window ({fromTime}–{toTime}, {timezone}). Scheduled calls will dial when
            the window opens. Use &quot;Call now anyway&quot; to override.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">From Time of Day</label>
            <input
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-slate-400">{timezone}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">To Time of Day</label>
            <input
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className={WORKFLOW_INPUT_CLASS}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setCriteriaOpen(true)}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full gap-2`}
            >
              <Settings2 size={16} />
              Setup Screening Criteria
            </button>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full`}
            >
              {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => startMutation.mutate(false)}
              disabled={startMutation.isPending || eligibleCandidateIds.length === 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Phone size={16} />
              )}
              {withinWindow ? 'Start Calling' : `Schedule for ${fromTime}`}
            </button>
            {!withinWindow && (
              <button
                type="button"
                onClick={() => startMutation.mutate(true)}
                disabled={startMutation.isPending || eligibleCandidateIds.length === 0}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                Call now anyway
              </button>
            )}
          </div>
        </div>
      </div>

      <ScreeningCriteriaModal job={job} open={criteriaOpen} onClose={() => setCriteriaOpen(false)} />
    </>
  )
}
