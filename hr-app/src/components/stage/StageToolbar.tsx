import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

/**
 * The row between a stage's tabs and its list: search and filters on the left, bulk actions
 * and exports on the right. It always sits below the header, never above it.
 */
export default function StageToolbar({
  children,
  actions,
}: {
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}

/** The search box every stage toolbar uses. */
export function StageSearch({
  value,
  onChange,
  placeholder = 'Search candidates…',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative min-w-[14rem] max-w-xs flex-1">
      <Search
        size={14}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </div>
  )
}
