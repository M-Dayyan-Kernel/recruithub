import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, Check, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ShortlistDecisionResponse, ShortlistResultWithCandidate } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BTN_GHOST } from '@/components/ui/Surface'
import { HrDecisionBadge } from '@/components/shortlist/shortlistBadges'
import { useShortlistDecision } from '@/hooks/useShortlistDecision'
import {
  decisionCopy,
  decisionErrorMessage,
  describeStage,
  type StageTone,
} from '@/lib/shortlistDecision'

type Decision = 'approved' | 'rejected'

const SMALL_BTN =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60'
// Tinted rather than solid: a table has a pair of these on every row, and a column of
// solid fills would shout over the scores. They still read as buttons (border, fill).
const APPROVE_BTN = `${SMALL_BTN} border-pos/30 bg-pos-soft text-pos hover:bg-pos hover:text-accent-ink focus:ring-pos/30`
const REJECT_BTN = `${SMALL_BTN} border-neg/30 bg-surface text-neg hover:bg-neg-soft focus:ring-neg/30`
const CONFIRM_BTN =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold text-accent-ink transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

const TONE_DOT: Record<StageTone, string> = {
  neutral: 'bg-ink-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  neg: 'bg-neg',
}

/** The HR Status column: the decision while there is one to make, the stage once approved. */
export function ShortlistStatusCell({
  result,
  jobId,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
}) {
  if (result.hr_decision === 'pending') {
    return <span className="text-xs text-ink-muted">Awaiting decision</span>
  }
  if (result.hr_decision === 'approved') {
    if (!result.stage) {
      // Between the click and the refetch that brings the stage back.
      return <HrDecisionBadge decision="approved" />
    }
    const view = describeStage(result.stage, jobId)
    return (
      <div className="inline-flex flex-col items-center gap-0.5">
        <span className="text-[13px] font-semibold text-ink">{view.title}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[view.tone]}`} />
          <span>
            {view.detail}
            {view.at && <span className="font-mono tabular-nums">, {view.at}</span>}
          </span>
        </span>
      </div>
    )
  }
  return <HrDecisionBadge decision={result.hr_decision} />
}

/**
 * What can be done with a row's decision.
 *  - pending / overridden: Approve and Reject.
 *  - rejected: Approve only (a rejection can be reversed; an approval cannot).
 *  - approved: no decision buttons. The candidate is in a stage, and a link to that
 *    stage's tab is the only action, because that is where calling, cancelling and
 *    rescheduling live.
 * Approve and Reject open a dialog that says what will happen, and stay open on failure.
 */
export function ShortlistDecisionControls({
  result,
  jobId,
  screeningEffective,
  onApproved,
}: {
  result: ShortlistResultWithCandidate
  jobId: string
  screeningEffective: boolean
  onApproved?: (data: ShortlistDecisionResponse) => void
}) {
  const [confirming, setConfirming] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mutation = useShortlistDecision(jobId, result.id, { onApproved, optimistic: false })
  const name = result.candidate_name ?? 'Candidate'

  const close = () => {
    setConfirming(null)
    setError(null)
  }

  const confirm = async () => {
    if (!confirming) return
    setError(null)
    try {
      await mutation.mutateAsync(confirming)
      toast.success(confirming === 'approved' ? `${name} approved` : `${name} rejected`)
      close()
    } catch (err) {
      setError(decisionErrorMessage(err))
    }
  }

  const copy = confirming
    ? decisionCopy(confirming, { name, score: result.match_score, screeningEffective })
    : null

  // Rendered whatever the row looks like: a refused change (409) means the row has just
  // flipped to approved, and the sentence explaining why must outlive that flip.
  const dialog = (
    <>
      {/* Portalled: this renders inside a centred table cell, and the dialog must not
          inherit its text alignment (or receive clicks as if they were on the row). */}
      {confirming && copy && createPortal(
        <Modal title={copy.title} onClose={close} busy={mutation.isPending}>
          <div className="space-y-4 px-5 py-4">
            {/* Once it has failed, the consequence line would describe something that did not happen. */}
            {!error && <p className="text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>}
            {error && (
              <p role="alert" className="flex items-start gap-1.5 text-[12px] text-neg">
                <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={close} disabled={mutation.isPending} className={BTN_GHOST}>
                {error ? 'Close' : 'Cancel'}
              </button>
              {!error && (
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={mutation.isPending}
                  className={`${CONFIRM_BTN} ${
                    confirming === 'approved'
                      ? 'bg-pos hover:bg-pos/90 focus:ring-pos/40'
                      : 'bg-neg hover:bg-neg/90 focus:ring-neg/40'
                  }`}
                >
                  {mutation.isPending && <Loader2 size={14} className="animate-spin" aria-hidden />}
                  {copy.confirmLabel}
                </button>
              )}
            </div>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  )

  if (result.hr_decision === 'approved') {
    if (!result.stage) return dialog
    const view = describeStage(result.stage, jobId)
    return (
      <>
        <Link to={view.to} className={BTN_GHOST} aria-label={`${view.toLabel} for ${name}`}>
          {view.toLabel}
          <ArrowRight size={13} aria-hidden />
        </Link>
        {dialog}
      </>
    )
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming('approved')} className={APPROVE_BTN} aria-label={`Approve ${name}`}>
        <Check size={13} aria-hidden />
        Approve
      </button>
      {result.hr_decision !== 'rejected' && (
        <button type="button" onClick={() => setConfirming('rejected')} className={REJECT_BTN} aria-label={`Reject ${name}`}>
          <X size={13} aria-hidden />
          Reject
        </button>
      )}
      {dialog}
    </>
  )
}

/**
 * The confirmation for "Approve passed" / "Reject failed". The caller runs the batch and
 * reports its own result; this only asks, names who is affected, and shows progress.
 */
export function BulkDecisionDialog({
  decision,
  names,
  screeningEffective,
  busy,
  onConfirm,
  onClose,
}: {
  decision: Decision
  names: string[]
  screeningEffective: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const copy = decisionCopy(decision, {
    name: names[0] ?? 'Candidate',
    screeningEffective,
    count: names.length,
  })
  const shown = names.slice(0, 5)
  const more = names.length - shown.length
  return (
    <Modal title={copy.title} onClose={onClose} busy={busy}>
      <div className="space-y-4 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>
        <ul className="space-y-1 text-[13px] text-ink">
          {shown.map((n, i) => (
            <li key={`${n}-${i}`} className="truncate">
              {n}
            </li>
          ))}
          {more > 0 && <li className="text-ink-muted">and {more} more</li>}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${CONFIRM_BTN} ${
              decision === 'approved'
                ? 'bg-pos hover:bg-pos/90 focus:ring-pos/40'
                : 'bg-neg hover:bg-neg/90 focus:ring-neg/40'
            }`}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
