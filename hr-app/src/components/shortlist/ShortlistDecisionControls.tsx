import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ShortlistDecisionResponse, ShortlistResultWithCandidate } from '@/types/api'
import Modal from '@/components/ui/Modal'
import { BTN_GHOST } from '@/components/ui/Surface'
import { useShortlistDecision } from '@/hooks/useShortlistDecision'
import { decisionCopy, decisionErrorMessage } from '@/lib/shortlistDecision'

type Decision = 'approved' | 'rejected'

const SMALL_BTN =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60'
// Tinted rather than solid: a table has a pair of these on every row, and a column of
// solid fills would shout over the scores. They still read as buttons (border, fill).
const APPROVE_BTN = `${SMALL_BTN} border-pos/30 bg-pos-soft text-pos hover:bg-pos hover:text-accent-ink focus:ring-pos/30`
const REJECT_BTN = `${SMALL_BTN} border-neg/30 bg-surface text-neg hover:bg-neg-soft focus:ring-neg/30`
const CONFIRM_BTN =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold text-accent-ink transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Approve and Reject for a row on the Resume Screening list. Every row there is awaiting a
 * decision, so these are always the actions; a decided candidate leaves the list for the stage
 * they are now in. Each opens a dialog that says what will happen.
 *
 * A failure is reported as a toast and the dialog closes. The dialog lives inside the row, and a
 * refused change (409: someone else decided first) refetches the list and removes the row, which
 * would take an in-dialog message with it.
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
  const mutation = useShortlistDecision(jobId, result.id, { onApproved, optimistic: false })
  const name = result.candidate_name ?? 'Candidate'

  const confirm = async () => {
    if (!confirming) return
    const decision = confirming
    try {
      await mutation.mutateAsync(decision)
      if (decision === 'rejected') toast.success(`${name} moved to Rejected`)
      // With screening off the approval's own handler reports the interview and navigates.
      else if (screeningEffective) toast.success(`${name} approved and moved to Phone screening`)
    } catch (err) {
      toast.error(decisionErrorMessage(err))
    } finally {
      setConfirming(null)
    }
  }

  const copy = confirming
    ? decisionCopy(confirming, { name, score: result.match_score, screeningEffective })
    : null

  return (
    <>
      <button type="button" onClick={() => setConfirming('approved')} className={APPROVE_BTN} aria-label={`Approve ${name}`}>
        <Check size={13} aria-hidden />
        Approve
      </button>
      <button type="button" onClick={() => setConfirming('rejected')} className={REJECT_BTN} aria-label={`Reject ${name}`}>
        <X size={13} aria-hidden />
        Reject
      </button>
      {/* Portalled: this renders inside a centred table cell, and the dialog must not
          inherit its text alignment (or receive clicks as if they were on the row). */}
      {confirming && copy && createPortal(
        <Modal title={copy.title} onClose={() => setConfirming(null)} busy={mutation.isPending}>
          <div className="space-y-4 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} disabled={mutation.isPending} className={BTN_GHOST}>
                Cancel
              </button>
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
            </div>
          </div>
        </Modal>,
        document.body,
      )}
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
