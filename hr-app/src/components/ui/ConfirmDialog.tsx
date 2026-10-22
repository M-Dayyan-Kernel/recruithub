import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { BTN_GHOST } from '@/components/ui/Surface'

const CONFIRM_BASE =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold text-accent-ink transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * "Are you sure?" for an action with consequences: says what will happen, stays open and
 * shows the server's sentence when the action is refused, and cannot be dismissed while it
 * runs. Portalled, because the buttons that open it often sit in a centred table cell and
 * the dialog must not inherit that alignment or receive clicks as if they were on the row.
 *
 * Once an error is showing, the confirm button is gone and the body is hidden: the body
 * describes what would happen, and by then it has not.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'neg',
  busy = false,
  error = null,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neg' | 'accent'
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
  /** Extra controls between the text and the buttons, e.g. an opt-in checkbox. */
  children?: ReactNode
}) {
  return createPortal(
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="space-y-4 px-5 py-4">
        {!error && <div className="text-[13px] leading-relaxed text-ink-muted">{body}</div>}
        {!error && children}
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-[12px] text-neg">
            <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>
            {error ? 'Close' : cancelLabel}
          </button>
          {!error && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`${CONFIRM_BASE} ${
                tone === 'neg'
                  ? 'bg-neg hover:bg-neg/90 focus:ring-neg/40'
                  : 'bg-accent hover:bg-accent-hover focus:ring-accent/40'
              }`}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
