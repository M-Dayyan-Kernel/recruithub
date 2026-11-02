import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Clock, Loader2, Phone, Settings2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job, ScreeningTriggerResponse } from '@/types/api'
import { editableQuestions } from '@/lib/screeningQuestions'
import { ScreeningCriteriaModal } from '@/components/screening/ScreeningCriteriaModal'
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/ui/Surface'
import {
  formatTimeForInput,
  isWithinCallWindow,
} from '@/components/screening/screeningUtils'

const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

/** The job's saved call window, and whether it is open right now. */
function useCallWindow(job: Job) {
  const from = formatTimeForInput(job.screening_call_from, '09:00')
  const to = formatTimeForInput(job.screening_call_to, '18:00')
  const timezone = job.screening_timezone || 'Asia/Kolkata'
  return { from, to, timezone, withinWindow: isWithinCallWindow(from, to, timezone) }
}

/**
 * The calling controls in the phone stage's header: a clock that says whether the call window
 * is open (green) or closed (red), and the button that dials the candidates who are ready.
 * The window itself is edited in the Settings drawer; this only acts on what is saved.
 */
export function ScreeningCallActions({
  job,
  eligibleCandidateIds,
  onCallsTriggered,
  showStart,
}: {
  job: Job
  eligibleCandidateIds: string[]
  onCallsTriggered: () => void
  /** The window clock always shows; the dial buttons only where there is someone to dial. */
  showStart: boolean
}) {
  const queryClient = useQueryClient()
  const { from, to, timezone, withinWindow } = useCallWindow(job)
  const eligibleCount = eligibleCandidateIds.length

  const startMutation = useMutation({
    mutationFn: (force: boolean) =>
      api.post(`/api/jobs/${job.id}/screening/trigger`, {
        candidate_ids: eligibleCandidateIds,
        force,
      }) as unknown as Promise<ScreeningTriggerResponse>,
    onSuccess: (data, force) => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      const total = data.initiated + data.queued
      if (total > 0) {
        if (!force && data.queued > 0) {
          toast.success(
            `${data.queued} call${data.queued !== 1 ? 's' : ''} queued for ${from} (${timezone})`,
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

  const pending = startMutation.isPending
  const noneReady = eligibleCount === 0
  const startLabel = withinWindow ? 'Start calling now' : `Queue calls for ${from}`
  const windowText = `${from}–${to} (${timezone})`
  // A disabled button gets no hover events in some browsers, so the tip sits on a wrapper.
  const startTip = noneReady
    ? 'No candidates are ready to call'
    : `${eligibleCount} candidate${eligibleCount === 1 ? '' : 's'} ready to call`

  return (
    <>
      <span
        role="img"
        aria-label={withinWindow ? 'Within the call window' : 'Outside the call window'}
        title={
          withinWindow
            ? `Within the call window, ${windowText}. Calls go out now.`
            : `Outside the call window, ${windowText}. Calls are queued until ${from}. Change the window in Settings.`
        }
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${
          withinWindow ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'
        }`}
      >
        <Clock size={16} aria-hidden />
      </span>
      {showStart && (
        <>
          {!withinWindow && (
            <span title={startTip}>
              <button
                type="button"
                onClick={() => startMutation.mutate(true)}
                disabled={pending || noneReady}
                className={BTN_SECONDARY}
              >
                Call now anyway
              </button>
            </span>
          )}
          <span title={startTip}>
            <button
              type="button"
              onClick={() => startMutation.mutate(false)}
              disabled={pending || noneReady}
              className={BTN_PRIMARY}
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
              {startLabel}
            </button>
          </span>
        </>
      )}
    </>
  )
}

/**
 * The phone stage's settings, shown in its drawer: the call window and the screening
 * questions. Both change rarely, so they live behind the Settings button.
 */
export function ScreeningSettingsPanel({ job }: { job: Job }) {
  const queryClient = useQueryClient()
  const saved = useCallWindow(job)
  const [fromTime, setFromTime] = useState(saved.from)
  const [toTime, setToTime] = useState(saved.to)
  const [criteriaOpen, setCriteriaOpen] = useState(false)

  const timezone = saved.timezone
  const dirty = fromTime !== saved.from || toTime !== saved.to
  // The standard questions are the same on every job, so the preview shows what is specific to
  // this one: the role-specific and custom questions.
  const questionCount = job.screening_questions?.length ?? 0
  const extraQuestions = editableQuestions(job.screening_questions)
  const previewText =
    extraQuestions.length > 0
      ? extraQuestions
          .slice(0, 2)
          .map((q) => q.question)
          .join(' · ')
      : 'Standard questions only.'

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

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface-2/60 p-4">
        <h3 className="text-sm font-semibold text-ink">Call window</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          Calls are placed only between these times. Anything approved outside them is queued for the
          next opening.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="screening-from-time" className="mb-1 block text-[11px] text-ink-muted">
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
            <label htmlFor="screening-to-time" className="mb-1 block text-[11px] text-ink-muted">
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
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-muted">
            Timezone: <span className="font-medium text-ink">{timezone}</span>
          </p>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
            className={BTN_SECONDARY}
          >
            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save window'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface-2/60 p-4">
        <h3 className="text-sm font-semibold text-ink">
          Screening questions
          {questionCount > 0 && (
            <span className="ml-1.5 font-mono text-xs font-normal tabular-nums text-ink-muted">
              ({questionCount})
            </span>
          )}
        </h3>
        <p className="mb-3 mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">{previewText}</p>
        <button type="button" onClick={() => setCriteriaOpen(true)} className={BTN_SECONDARY}>
          <Settings2 size={14} aria-hidden />
          {questionCount > 0 ? 'Edit questions' : 'Set up questions'}
        </button>
      </section>

      <ScreeningCriteriaModal job={job} open={criteriaOpen} onClose={() => setCriteriaOpen(false)} />
    </div>
  )
}
