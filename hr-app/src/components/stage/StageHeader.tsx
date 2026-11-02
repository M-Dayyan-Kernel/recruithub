import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * The top of every pipeline stage page (Resume screening, Phone screening, Interviews,
 * Finalists, Rejected): what this stage is, how many are in it, the stage's own actions, and
 * its sub-views. One shape for all five, so a stage is never missing its title or carrying it
 * under its own filters.
 *
 * Order matters and is fixed: title, then tabs, then (in the page) the toolbar, then content.
 */
export default function StageHeader({
  icon: Icon,
  title,
  description,
  count,
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  /** Shown beside the title. Omit while loading rather than showing a wrong 0. */
  count?: number
  /** The stage's own buttons: its primary action, exports, Settings. */
  actions?: ReactNode
  /** Sub-view tabs (`StageTabs`), rendered under the title. */
  children?: ReactNode
}) {
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-muted"
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
              {count !== undefined && (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-ink-muted">
                  {count}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
