import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * A "?" that explains why something is the way it is. Hover shows the short label as a native
 * tooltip; click opens the full explanation, which closes on Escape or a click elsewhere.
 * Keep it outside any dimmed (disabled) wrapper so it stays usable when its neighbour is not.
 */
export default function InfoPopover({
  label,
  children,
  align = 'left',
}: {
  /** Short name for the control and the hover tooltip. */
  label: string
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={root} className="relative inline-flex">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-subtle transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <HelpCircle size={15} aria-hidden />
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className={`absolute top-full z-30 mt-2 w-72 rounded-md border border-line bg-surface p-3 text-left text-[12px] font-normal leading-relaxed text-ink-muted shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
