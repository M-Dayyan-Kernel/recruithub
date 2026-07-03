import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Clock, Loader2, Phone, Settings2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, ScreeningTriggerResponse } from '@/types/api'
import { ScreeningCriteriaModal } from '@/components/screening/ScreeningCriteriaModal'
import {
  formatTimeForInput,
  isWithinCallWindow,
} from '@/components/screening/screeningUtils'

interface Props {
  job: Job
  eligibleCandidateIds: string[]
  onCallsTriggered: () => void
}

const inputClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'

const btnSecondary =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'

export function ScreeningSettingsCard({ job, eligibleCandidateIds, onCallsTriggered }: Props) {
  const queryClient = useQueryClient()
  const [fromTime, setFromTime] = useState(
    formatTimeForInput(job.screening_call_from, '09:00'),
  )
  const [toTime, setToTime] = useState(formatTimeForInput(job.screening_call_to, '18:00'))
  const [criteriaOpen, setCriteriaOpen] = useState(false)

  const timezone = job.screening_timezone || 'Asia/Kolkata'
  const withinWindow = isWithinCallWindow(fromTime, toTime, timezone)
  const hasCriteria = Boolean(job.screening_criteria?.trim())
  const eligibleCount = eligibleCandidateIds.length

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/jobs/${job.id}`, {
        screening_call_from: `${fromTime}:00`,
        screening_call_to: `${toTime}:00`,
        screening_timezone: timezone,
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Call window saved')
    },
    onError: () => toast.error('Failed to save call window'),
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
            `Scheduled ${data.queued} call${data.queued !== 1 ? 's' : ''} for ${fromTime}–${toTime} ${timezone}`,
          )
        } else {
          toast.success(
            `Started calling ${data.initiated} candidate${data.initiated !== 1 ? 's' : ''}` +
              (data.queued > 0 ? ` (${data.queued} queued)` : ''),
          )
        }
      } else if (data.skipped.length > 0) {
        toast.error('No calls started — check skipped candidates')
      }
      onCallsTriggered()
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start screening calls'),
  })

  const startButtonLabel = withinWindow ? 'Start Calling Now' : `Schedule for ${fromTime}`

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Screening call settings
            </p>
            <h3 className="mt-0.5 truncate text-base font-semibold text-slate-900">{job.title}</h3>
            <p className="mt-1 text-xs text-slate-500">Call window, criteria, and bulk dial</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
              withinWindow ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
            }`}
          >
            <Clock size={12} />
            {withinWindow ? 'Within window' : 'Outside window'}
          </span>
        </div>

        <div className="space-y-3 p-4">
          {/* Window + criteria */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">Call window</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="screening-from-time" className="mb-1 block text-[11px] text-slate-500">
                    From
                  </label>
                  <input
                    id="screening-from-time"
                    type="time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="screening-to-time" className="mb-1 block text-[11px] text-slate-500">
                    To
                  </label>
                  <input
                    id="screening-to-time"
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Timezone: <span className="font-medium text-slate-700">{timezone}</span>
              </p>
            </div>

            <div className="flex flex-col rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">Screening criteria</p>
              <p className="mb-2 line-clamp-2 flex-1 text-xs leading-relaxed text-slate-600">
                {hasCriteria
                  ? job.screening_criteria
                  : 'No custom criteria — AI uses default screening questions.'}
              </p>
              <button
                type="button"
                onClick={() => setCriteriaOpen(true)}
                className={`${btnSecondary} w-fit`}
              >
                <Settings2 size={14} />
                {hasCriteria ? 'Edit criteria' : 'Set up criteria'}
              </button>
            </div>
          </div>

          {!withinWindow && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Outside the call window. Calls will queue until {fromTime} ({timezone}). Use{' '}
              <span className="font-semibold">Call now anyway</span> to override.
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{eligibleCount}</span>
              {eligibleCount === 1 ? ' candidate' : ' candidates'} ready in Pending / Flagged
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className={btnSecondary}
              >
                {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save window'}
              </button>
              <button
                type="button"
                onClick={() => startMutation.mutate(false)}
                disabled={startMutation.isPending || eligibleCount === 0}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Phone size={14} />
                )}
                {startButtonLabel}
              </button>
              {!withinWindow && (
                <button
                  type="button"
                  onClick={() => startMutation.mutate(true)}
                  disabled={startMutation.isPending || eligibleCount === 0}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  Call now anyway
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ScreeningCriteriaModal job={job} open={criteriaOpen} onClose={() => setCriteriaOpen(false)} />
    </>
  )
}
