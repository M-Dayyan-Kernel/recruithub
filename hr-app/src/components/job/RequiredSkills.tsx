import { useState } from 'react'

const PREVIEW_COUNT = 8

const CHIP = 'rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700'
const TOGGLE =
  'rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

/**
 * A job's required skills: the first few, then a "+N more" button that shows all of them when
 * clicked and "Show less" to fold them back. Click only. Showing them on hover moved the page
 * under the pointer whenever the mouse crossed the block, so nothing here reacts to hover.
 */
export function RequiredSkills({ skills }: { skills: string[] }) {
  const [expanded, setExpanded] = useState(false)
  if (skills.length === 0) return null

  const hiddenCount = skills.length - PREVIEW_COUNT
  const visible = expanded ? skills : skills.slice(0, PREVIEW_COUNT)

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        Required skills <span className="font-mono tabular-nums">({skills.length})</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((skill) => (
          <span key={skill} className={CHIP}>
            {skill}
          </span>
        ))}
        {hiddenCount > 0 && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className={TOGGLE}>
            {expanded ? 'Show less' : `+${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  )
}
