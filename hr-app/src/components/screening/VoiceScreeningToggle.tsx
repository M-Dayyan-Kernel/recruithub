import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, Loader2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BTN_GHOST, BTN_PRIMARY } from '@/components/ui/Surface'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import {
  phoneRoundBreakdown,
  plural,
  resultMessage,
  unaffectedNotes,
  type MoveTo,
  type VoiceScreeningChangeResult,
  type VoiceScreeningPreview,
} from '@/lib/voiceScreeningSwitch'

const CHOICES: Array<{ id: MoveTo; title: string; body: (n: number) => string }> = [
  {
    id: 'interview',
    title: 'Move them to Interviews',
    body: (n) => (n === 1 ? 'They are emailed an interview link now.' : `Each of the ${n} candidates is emailed an interview link now.`),
  },
  {
    id: 'resume',
    title: 'Send them back to Resume Screening',
    body: (n) =>
      `${n === 1 ? 'They return' : 'They all return'} to "Awaiting decision" and queued calls are cancelled. Approving again sends the interview link.`,
  },
]

/**
 * The voice-screening switch, with the question it used to skip: turning screening off
 * while candidates wait in the phone round asks where they go, and nothing changes until
 * HR answers. Turning it on, or off with nobody waiting, still asks first, because it
 * changes what every later approval does.
 */
export function VoiceScreeningToggle({ job, className }: { job: Job; className?: string }) {
  const queryClient = useQueryClient()
  const enabled = job.voice_screening_enabled !== false
  const [target, setTarget] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<VoiceScreeningPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [moveTo, setMoveTo] = useState<MoveTo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VoiceScreeningChangeResult | null>(null)

  const previewQuery = {
    queryKey: ['voice-screening', job.id],
    queryFn: () => api.get(`/api/jobs/${job.id}/voice-screening`) as unknown as Promise<VoiceScreeningPreview>,
  }

  // Always fresh when the dialog opens (staleTime 0), through the same cache as the
  // "Place them" count, so the two cannot disagree.
  const loadPreview = async () => {
    setPreview(null)
    setPreviewError(null)
    try {
      setPreview(await queryClient.fetchQuery({ ...previewQuery, staleTime: 0 }))
    } catch (err) {
      setPreviewError(err instanceof Error && err.message ? err.message : 'Could not check the candidates.')
    }
  }

  // With screening off, anyone still waiting from the phone round (a move that failed, or
  // a call that ended after the switch) is offered here, the one place that can place them.
  const { data: offPreview } = useQuery({ ...previewQuery, enabled: !enabled })
  const stranded = !enabled ? (offPreview?.in_phone_round.length ?? 0) : 0

  const mutation = useMutation({
    mutationFn: (body: { enabled: boolean; move_to: MoveTo | null }) =>
      api.post(`/api/jobs/${job.id}/voice-screening`, body) as unknown as Promise<VoiceScreeningChangeResult>,
  })

  const refreshEverything = () => {
    for (const key of [['job', job.id], ['jobs'], ['shortlist', job.id], ['screening', job.id], ['interviews-pipeline', job.id], ['candidates'], ['voice-screening', job.id]]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const open = (next: boolean) => {
    setTarget(next)
    setMoveTo(null)
    setError(null)
    setResult(null)
    void loadPreview()
  }

  const close = () => {
    setTarget(null)
    setPreview(null)
    setResult(null)
  }

  const waiting = target === false ? (preview?.in_phone_round ?? []) : []

  const apply = async () => {
    if (target === null) return
    setError(null)
    try {
      const out = await mutation.mutateAsync({ enabled: target, move_to: waiting.length ? moveTo : null })
      const msg = resultMessage(out)
      if (msg.ok) {
        toast.success(msg.text)
        close()
      } else {
        // Some could not be moved or emailed: keep the dialog to say who, and offer a retry.
        setResult(out)
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not change voice screening.')
      void loadPreview()
    } finally {
      refreshEverything()
    }
  }

  const retryFailed = async () => {
    setError(null)
    try {
      const out = await mutation.mutateAsync({ enabled: false, move_to: 'interview' })
      if (out.move_to === null) {
        // Nobody is waiting any more: whoever failed is in the Interviews tab without a link.
        toast('Nobody is waiting any more. Check the Interviews tab for anyone still without a link.')
        close()
        return
      }
      setResult(out)
      if (resultMessage(out).ok && out.failed.length === 0) {
        toast.success(resultMessage(out).text)
        close()
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not try again.')
    } finally {
      refreshEverything()
    }
  }

  const busy = mutation.isPending
  const needsChoice = waiting.length > 0
  // Opened from "Place them" while screening is already off: same choice, no flag change.
  const placingOnly = target === false && !enabled
  const title = target ? 'Turn on voice screening?' : placingOnly ? 'Place the candidates still waiting' : 'Turn off voice screening?'
  const confirmLabel = target
    ? 'Turn on'
    : !needsChoice
      ? 'Turn off'
      : moveTo === 'interview'
        ? `${placingOnly ? 'Email' : 'Turn off and email'} ${plural(waiting.length, 'interview link')}`
        : moveTo === 'resume'
          ? `${placingOnly ? 'Return' : 'Turn off and return'} ${plural(waiting.length, 'candidate')}`
          : 'Choose where they go'

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <VoiceScreeningSwitch
          checked={enabled}
          disabled={busy || target !== null}
          onChange={(next) => open(next)}
          className={className}
        />
        {stranded > 0 && (
          <button
            type="button"
            onClick={() => open(false)}
            className="text-[12px] font-semibold text-warn underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {plural(stranded, 'candidate is', 'candidates are')} still waiting for a call · Place them
          </button>
        )}
      </span>
      {target !== null &&
        createPortal(
          <Modal title={result ? 'Voice screening is off' : title} onClose={close} busy={busy}>
            <div className="space-y-4 px-5 py-4 text-[13px] leading-relaxed text-ink-muted">
              {result ? (
                <ResultView result={result} />
              ) : !preview && !previewError ? (
                <p className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  Checking the candidates on this job…
                </p>
              ) : previewError ? (
                <p role="alert" className="flex items-start gap-1.5 text-neg">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {previewError}
                </p>
              ) : target ? (
                <>
                  <p>Newly approved candidates get an AI screening call before an interview.</p>
                  {preview!.in_interviews > 0 && (
                    <p>{plural(preview!.in_interviews, 'candidate is', 'candidates are')} already in Interviews and stay there.</p>
                  )}
                </>
              ) : placingOnly && !needsChoice ? (
                <p>Nobody is waiting from the phone round any more.</p>
              ) : !needsChoice ? (
                <>
                  <p>Approved candidates will skip the call: approving them emails the interview link straight away.</p>
                  {unaffectedNotes(preview!).map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </>
              ) : (
                <>
                  <p>
                    <span className="font-semibold text-ink">{plural(waiting.length, 'candidate is', 'candidates are')} waiting in the phone round</span>
                    {' '}({phoneRoundBreakdown(preview!)}). Where should they go?
                  </p>
                  <div role="radiogroup" aria-label="Where the waiting candidates go" className="space-y-2">
                    {CHOICES.map((c) => (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                          moveTo === c.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent-border'
                        }`}
                      >
                        <input
                          type="radio"
                          name="voice-screening-move"
                          value={c.id}
                          checked={moveTo === c.id}
                          onChange={() => setMoveTo(c.id)}
                          disabled={busy}
                          className="mt-1 h-4 w-4 border-line text-accent focus:ring-accent"
                        />
                        <span>
                          <span className="block font-semibold text-ink">{c.title}</span>
                          <span className="block text-[12px]">{c.body(waiting.length)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {unaffectedNotes(preview!).map((n) => (
                    <p key={n} className="text-[12px]">{n}</p>
                  ))}
                </>
              )}

              {error && (
                <p role="alert" className="flex items-start gap-1.5 text-[12px] text-neg">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button type="button" onClick={close} disabled={busy} className={BTN_GHOST}>
                  {result || (placingOnly && !needsChoice) ? 'Close' : placingOnly ? 'Not now' : target ? 'Keep it off' : 'Keep it on'}
                </button>
                {result ? (
                  result.failed.length > 0 && (
                    <button type="button" onClick={() => void retryFailed()} disabled={busy} className={BTN_PRIMARY}>
                      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                      Try again for {plural(result.failed.length, 'candidate')}
                    </button>
                  )
                ) : (
                  preview && !(placingOnly && !needsChoice) && (
                    <button
                      type="button"
                      onClick={() => void apply()}
                      disabled={busy || (needsChoice && moveTo === null)}
                      className={BTN_PRIMARY}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : needsChoice && moveTo ? <ArrowRight size={14} aria-hidden /> : null}
                      {confirmLabel}
                    </button>
                  )
                )}
              </div>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  )
}

function ResultView({ result }: { result: VoiceScreeningChangeResult }) {
  return (
    <>
      <p>{resultMessage(result).text}</p>
      {result.email_failed.length > 0 && (
        <p>
          <span className="font-semibold text-ink">The interview link did not reach:</span> {result.email_failed.join(', ')}.
          Send it from the Interviews tab.
        </p>
      )}
      {result.failed.length > 0 && (
        <p className="text-neg">
          <span className="font-semibold">Could not be moved:</span> {result.failed.join(', ')}. Trying again retries
          anyone still waiting; check the Interviews tab for the rest.
        </p>
      )}
    </>
  )
}
