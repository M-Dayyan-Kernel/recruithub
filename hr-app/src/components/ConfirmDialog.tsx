import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

export type ConfirmTone = 'danger' | 'warning' | 'default'

interface Props {
  open: boolean
  title: string
  /** Supporting copy. Line breaks in the string render as paragraphs. */
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  /** Keeps the dialog open and disables both buttons while the action runs. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const TONE_STYLES: Record<ConfirmTone, { icon: string; confirm: string }> = {
  danger: {
    icon: 'bg-red-950/60 text-red-400',
    confirm: 'bg-red-600 text-white hover:bg-red-500',
  },
  warning: {
    icon: 'bg-amber-950/60 text-amber-400',
    confirm: 'bg-amber-600 text-white hover:bg-amber-500',
  },
  default: {
    icon: 'bg-teal-950/60 text-teal-400',
    confirm: 'bg-teal-600 text-white hover:bg-teal-500',
  },
}

/**
 * Confirmation dialog for the dark platform-admin surfaces, replacing
 * `window.confirm` so destructive actions read as part of the product.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    // Stop the page behind the overlay from scrolling with the dialog open.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, busy, onCancel])

  if (!open) return null

  const styles = TONE_STYLES[tone]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.icon}`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-100">
              {title}
            </h2>
            {message
              .split('\n')
              .filter((line) => line.trim())
              .map((line, i) => (
                <p key={i} className="mt-2 text-sm leading-relaxed text-slate-400">
                  {line}
                </p>
              ))}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${styles.confirm}`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
