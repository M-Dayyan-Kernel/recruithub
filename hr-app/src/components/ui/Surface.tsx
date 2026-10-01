import type { ReactNode } from 'react'

/**
 * The shared surface primitives.
 *
 * Every page draws its cards, stats and status pills from here rather than
 * hand-rolling a `bg-white border rounded-xl shadow-sm`. That is what keeps
 * one page from drifting onto its own palette, which is exactly how the admin
 * console ended up dark and emerald while the rest of the app was light.
 *
 * Colour comes from the semantic tokens only. No hex literals below.
 */

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode
  className?: string
  /** Adds a hover lift; use only where the whole card is a target. */
  interactive?: boolean
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface shadow-e2 ${
        interactive
          ? 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-e3'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  )
}

const STAT_TONES = {
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  neg: 'bg-neg-soft text-neg',
  neutral: 'bg-surface-3 text-ink-muted',
} as const

export type Tone = keyof typeof STAT_TONES

export function Stat({
  icon,
  label,
  value,
  tone = 'accent',
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  tone?: Tone
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${STAT_TONES[tone]}`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          {/* Counts are figures: tabular so they do not jitter as they update. */}
          <p className="font-mono text-[20px] font-bold leading-none tabular-nums text-ink">
            {value}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {label}
          </p>
        </div>
      </div>
    </Card>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STAT_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** A dot that reads as status without spending a whole badge on it. */
export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const fill =
    tone === 'pos'
      ? 'bg-pos'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'neg'
          ? 'bg-neg'
          : tone === 'accent'
            ? 'bg-accent'
            : 'bg-ink-subtle'
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fill}`} />
}

/**
 * A card with a header row: title left, an optional action right. This is the
 * shape most panels actually want, and hand-rolling it is how header spacing
 * drifts between pages.
 */
export function SectionCard({
  title,
  icon,
  action,
  children,
  bodyClassName = 'p-5',
  className = '',
}: {
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  bodyClassName?: string
  className?: string
}) {
  return (
    <Card className={`flex flex-col overflow-hidden ${className}`}>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-4">
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
            {icon}
          </span>
        )}
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </Card>
  )
}

const TONE_CARD = {
  accent: 'from-accent-soft via-surface to-surface border-accent-border',
  pos: 'from-pos-soft via-surface to-surface border-pos/15',
  warn: 'from-warn-soft via-surface to-surface border-warn/15',
  neg: 'from-neg-soft via-surface to-surface border-neg/15',
  neutral: 'from-surface-3 via-surface to-surface border-line',
} as const

/** A tinted panel, for the one thing on a page that should carry weight. */
export function ToneCard({
  tone = 'accent',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-card border bg-gradient-to-br shadow-e2 ${TONE_CARD[tone]} ${className}`}
    >
      {children}
    </div>
  )
}

/** The small round control used beside a card title. */
export const ICON_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30'

/** The quiet "View all" affordance in a card header. */
export const LINK_ACTION =
  'inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent'

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-3 text-ink-subtle">
        {icon}
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const BTN_PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-ink shadow-accent transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

export const BTN_GHOST =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60'

export const BTN_DANGER =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-neg-soft bg-neg-soft px-3 text-[13px] font-medium text-neg transition-colors hover:border-neg/30 focus:outline-none focus:ring-2 focus:ring-neg/30 disabled:cursor-not-allowed disabled:opacity-60'

export const INPUT =
  'h-11 w-full rounded-md border border-line bg-surface px-4 text-[14px] text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft'
