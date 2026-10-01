import { useMemo, useState } from 'react'
import { RequiredMark } from '@/components/FieldError'
import { useMutation } from '@tanstack/react-query'
import { CalendarClock, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { InterviewSession, Job } from '@/types/api'

interface Props {
  job: Job
  candidateId: string
  candidateName: string
  open: boolean
  onClose: () => void
  onSuccess: (session: InterviewSession) => void
  mode?: 'schedule' | 'reschedule'
}

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'

function defaultScheduleDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function ScheduleInterviewModal({
  job,
  candidateId,
  candidateName,
  open,
  onClose,
  onSuccess,
  mode = 'schedule',
}: Props) {
  const timezone = job.screening_timezone || 'Asia/Kolkata'
  const [scheduledDate, setScheduledDate] = useState(defaultScheduleDate)
  const [scheduledTime, setScheduledTime] = useState('10:00')

  const previewLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      }).format(new Date(`${scheduledDate}T${scheduledTime}:00`))
    } catch {
      return null
    }
  }, [scheduledDate, scheduledTime, timezone])

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        timezone,
      }
      const endpoint =
        mode === 'reschedule'
          ? `/api/candidates/${candidateId}/interview/reschedule`
          : `/api/candidates/${candidateId}/interview/schedule`
      return api.post(endpoint, body) as unknown as Promise<InterviewSession>
    },
    onSuccess: (data) => {
      const emailed = Boolean(data.email_sent_at)
      if (emailed) {
        toast.success(
          mode === 'reschedule'
            ? `Interview rescheduled — ${candidateName} was notified by email`
            : `Interview scheduled — ${candidateName} was notified by email`,
        )
      } else {
        toast.error(
          `Interview ${mode === 'reschedule' ? 'rescheduled' : 'scheduled'}, but the email could not be sent. Use Resend email.`,
        )
      }
      onSuccess(data)
      onClose()
    },
    onError: (err: Error) =>
      toast.error(err.message || `Failed to ${mode === 'reschedule' ? 'reschedule' : 'schedule'} interview`),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">
              {mode === 'reschedule' ? 'Reschedule interview' : 'Schedule interview'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{candidateName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs text-slate-600">
            The candidate receives an email right away with the interview link and the date and
            time they should attend.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="interview-schedule-date" className="mb-1 block text-xs font-medium text-slate-600">
                Date
                <RequiredMark />
              </label>
              <input
                id="interview-schedule-date"
                type="date"
                aria-required="true"
                value={scheduledDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setScheduledDate(e.target.value)}
                className={inputClass}
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="interview-schedule-time" className="mb-1 block text-xs font-medium text-slate-600">
                Time
                <RequiredMark />
              </label>
              <input
                id="interview-schedule-time"
                type="time"
                aria-required="true"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className={inputClass}
                disabled={mutation.isPending}
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Timezone: <span className="font-medium text-slate-700">{timezone}</span>
            {previewLabel && (
              <span className="mt-1 block text-slate-600">Slot: {previewLabel}</span>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !scheduledDate || !scheduledTime}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CalendarClock size={14} />
            )}
            Confirm schedule
          </button>
        </div>
      </div>
    </div>
  )
}
