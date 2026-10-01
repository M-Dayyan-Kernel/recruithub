import type { ReactNode } from 'react'

/**
 * The candidate surface, built to the approved screen preview.
 *
 * Light page, one centred panel per screen, no card. Two departures from the
 * preview: the accent is the product's indigo rather than its green, and the
 * flat ground carries a faint indigo wash (`bg-app`) so a sparse screen does
 * not read as a blank document.
 */

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-page bg-app px-5 py-10 font-sans text-ink">
      {children}
    </div>
  )
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-sm font-bold text-accent-ink">
        W
      </span>
      <span className="font-display text-[15px] font-semibold text-ink">Webknot</span>
    </div>
  )
}

export function IconBadge({
  children,
  size = 'lg',
}: {
  children: ReactNode
  /** `sm` is the rounded square badge that introduces a line of body copy. */
  size?: 'sm' | 'lg'
}) {
  return (
    <span
      className={
        size === 'lg'
          ? 'flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent'
          : 'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent'
      }
    >
      {children}
    </span>
  )
}

/**
 * One candidate screen: icon badge, heading, a line of explanation, an optional
 * block, then the action. Every pre-flight screen is this component, so they
 * differ only in content.
 */
export function Panel({
  badge,
  title,
  description,
  children,
  action,
  hint,
  align = 'center',
}: {
  badge?: ReactNode
  title: string
  description?: ReactNode
  children?: ReactNode
  action?: ReactNode
  hint?: ReactNode
  /** Screens carrying a list of points read better left-aligned. */
  align?: 'center' | 'start'
}) {
  return (
    <div className="flex w-full max-w-[560px] flex-col items-center text-center">
      {badge && <div className="mb-5 flex items-center justify-center gap-4">{badge}</div>}

      <h1 className="font-display text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold leading-snug text-ink">
        {title}
      </h1>

      {description && (
        <p className="mt-2 max-w-[440px] text-[0.92rem] leading-relaxed text-ink-muted">
          {description}
        </p>
      )}

      {children && (
        <div className={`mt-7 w-full ${align === 'start' ? 'text-left' : ''}`}>{children}</div>
      )}

      {action && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{action}</div>}

      {hint && <p className="mt-2.5 text-[0.78rem] text-ink-muted">{hint}</p>}
    </div>
  )
}

const BTN_BASE =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[9px] px-6 text-[0.9rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed'

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`${BTN_BASE} bg-accent text-accent-ink hover:bg-primary-700 disabled:bg-line disabled:text-ink-muted`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BTN_BASE} border border-line bg-panel font-medium text-ink hover:bg-panel-alt disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

/** The preview's `.btn-text`: a quiet, underlined secondary action. */
export function TextButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 cursor-pointer px-3 text-[0.9rem] font-semibold text-ink-muted underline underline-offset-[3px] transition-colors hover:text-ink"
    >
      {children}
    </button>
  )
}

/** A short advisory, used for a gate that failed and can be retried. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[9px] border border-warn/25 bg-warn-soft px-4 py-3 text-left text-[0.82rem] leading-relaxed text-warn">
      {children}
    </p>
  )
}

/**
 * Terminal screens: expired link, already completed, error, thank you, and the
 * capacity hold. Same panel, with a tone-coloured badge.
 */
export function StatusScreen({
  icon,
  tone = 'brand',
  title,
  body,
  children,
  footer,
}: {
  icon: ReactNode
  tone?: 'brand' | 'success' | 'danger' | 'muted'
  title: string
  body: string
  children?: ReactNode
  footer?: ReactNode
}) {
  const tones = {
    brand: 'bg-accent-soft text-accent',
    success: 'bg-emerald-50 text-emerald-600',
    danger: 'bg-warn-soft text-warn',
    muted: 'bg-panel-alt text-ink-muted',
  }

  return (
    <Screen>
      <div className="flex w-full max-w-[560px] flex-col items-center text-center">
        <span
          className={`mb-5 flex h-14 w-14 items-center justify-center rounded-full ${tones[tone]}`}
        >
          {icon}
        </span>

        <h1 className="font-display text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold leading-snug text-ink">
          {title}
        </h1>
        <p className="mt-2 max-w-[440px] text-[0.92rem] leading-relaxed text-ink-muted">{body}</p>

        {children}

        <div className="mt-8 w-full border-t border-line pt-5">
          {footer ?? (
            <p className="text-[0.8rem] text-ink-muted">
              Questions? Reach out to{' '}
              <a
                href="mailto:careers@webknot.in"
                className="font-medium text-accent underline underline-offset-[3px]"
              >
                careers@webknot.in
              </a>
            </p>
          )}
        </div>
      </div>
    </Screen>
  )
}
