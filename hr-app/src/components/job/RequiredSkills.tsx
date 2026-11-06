import { useEffect, useId, useRef, useState } from 'react'

const PREVIEW_COUNT = 8
// Long enough that a pointer passing over the pill does not open it, short enough to feel instant.
const OPEN_DELAY_MS = 120
// The grace to cross the gap between the pill and its panel without the panel closing.
const CLOSE_DELAY_MS = 150

const CHIP = 'rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700'

/**
 * A job's required skills: the first few inline, and the rest in a floating panel behind the
 * "+N more" pill. The panel floats, so opening it never pushes the page down, and only the pill
 * reacts to the pointer (the old whole-block hover moved the layout whenever the mouse crossed it).
 *
 * Hover opens it after a short delay and closes it after a short grace, focus opens it for
 * keyboard users, and a click or tap pins it open until Escape, a click elsewhere, or another click.
 */
export function RequiredSkills({ skills }: { skills: string[] }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const panelId = useId()

  const shown = skills.slice(0, PREVIEW_COUNT)
  const hidden = skills.slice(PREVIEW_COUNT)

  const setPin = (next: boolean) => {
    pinnedRef.current = next
    setPinned(next)
  }
  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(next), ms)
  }
  const closeNow = () => {
    window.clearTimeout(timer.current)
    setPin(false)
    setOpen(false)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) closeNow()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNow()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (skills.length === 0) return null

  return (
    <div ref={root} className="relative">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        Required skills <span className="font-mono tabular-nums">({skills.length})</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((skill) => (
          <span key={skill} className={CHIP}>
            {skill}
          </span>
        ))}
        {hidden.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${hidden.length} more required skills`}
            onMouseEnter={() => later(true, OPEN_DELAY_MS)}
            onMouseLeave={() => {
              if (!pinnedRef.current) later(false, CLOSE_DELAY_MS)
            }}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
              if (!pinnedRef.current && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
            }}
            onClick={() => {
              if (open && pinned) closeNow()
              else {
                window.clearTimeout(timer.current)
                setPin(true)
                setOpen(true)
              }
            }}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              open ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700'
            }`}
          >
            +{hidden.length} more
          </button>
        )}
      </div>

      {open && hidden.length > 0 && (
        <div
          id={panelId}
          role="region"
          aria-label="All required skills"
          onMouseEnter={() => {
            window.clearTimeout(timer.current)
            setOpen(true)
          }}
          onMouseLeave={() => {
            if (!pinnedRef.current) later(false, CLOSE_DELAY_MS)
          }}
          // Floats over the page: opening it never moves what is below it.
          className="absolute left-0 top-full z-30 mt-1.5 max-h-64 w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span key={skill} className={CHIP}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
