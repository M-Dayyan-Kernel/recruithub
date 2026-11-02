import { cn } from '@/lib/utils'

export interface StageTab<T extends string> {
  id: T
  label: string
  /** Omit for a tab with no count. A zero is shown, but not emphasised. */
  count?: number
  /** `danger` tints the count red: something here needs attention. */
  tone?: 'danger'
}

/**
 * The sub-view tabs of a stage. Replaces three hand-rolled tab bars (a coloured pill per tab
 * on Phone screening, bordered buttons on Interviews, indigo pills on Resume screening), so a
 * tab looks and behaves the same everywhere: an underline marks the active one, the count is
 * a mono figure, and the whole bar is one tablist for assistive tech.
 */
export default function StageTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<StageTab<T>>
  active: T
  onChange: (id: T) => void
  /** Accessible name for the tablist. */
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-1 border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
              // Neutral, not accent: docs/UI.md allows about two accent marks a screen, and a
              // stage page already has its primary action.
              selected
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                  tab.tone === 'danger' && tab.count > 0
                    ? 'bg-neg-soft text-neg'
                    : selected && tab.count > 0
                      ? 'bg-surface-3 text-ink'
                      : 'bg-surface-3 text-ink-muted',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
