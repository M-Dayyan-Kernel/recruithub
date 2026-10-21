import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * A centred dialog on a scrim (a bottom sheet below `sm`, since panels have to work at
 * 375px first). Mount it to open it and unmount it to close it: the content's state then
 * resets by itself, which is what a form in a dialog wants.
 *
 * Escape and a click on the scrim close it, unless `busy` (a request is in flight).
 * Focus moves into the dialog, and back to what opened it on close.
 */
export default function Modal({
  title,
  description,
  onClose,
  busy = false,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  /** Blocks every way of closing while an action runs. */
  busy?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Read through a ref so the effect below does not re-run (and re-steal focus) when a
  // parent passes a new onClose on every render.
  const closeRef = useRef({ onClose, busy })
  closeRef.current = { onClose, busy }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    )
    // The close button is first in the DOM; prefer the first field of the content.
    const field = panelRef.current?.querySelector<HTMLElement>('[data-modal-body] input, [data-modal-body] select')
    ;(field ?? first)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeRef.current.busy) closeRef.current.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    // Stop the page behind the scrim from scrolling.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-card border border-line bg-surface shadow-e3 sm:max-w-lg sm:rounded-card"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
