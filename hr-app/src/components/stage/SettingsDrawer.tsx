import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'

/**
 * A right-hand drawer for a stage's configuration (the phone call window and questions, the
 * interview topics). Settings change rarely and the editors are long, so they open on a
 * "Settings" button instead of sitting above the list on every visit.
 *
 * Mount it to open it and unmount it to close it. Escape and a click on the scrim close it,
 * unless `busy`. Focus moves in, and back to what opened it on close.
 */
export default function SettingsDrawer({
  title,
  description,
  onClose,
  busy = false,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  /** Blocks every way of closing while a save runs. */
  busy?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useEscapeToClose(onClose, { busy })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-surface shadow-e3 focus:outline-none animate-in slide-in-from-right duration-200"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{description}</p>}
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
