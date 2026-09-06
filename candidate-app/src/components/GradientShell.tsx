import type { ReactNode } from 'react'

/**
 * The light, card-on-gradient surface used by every screen outside the
 * interview room: pre-flight, capacity, errors and the thank-you page.
 */

export function GradientShell({
  children,
  size = 'lg',
}: {
  children: ReactNode
  /** Status and result pages read better in a narrower column than the wizard. */
  size?: 'md' | 'lg'
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-fuchsia-600"
      />
      <div
        aria-hidden
        className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-white/25 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-48 -right-32 h-[30rem] w-[30rem] rounded-full bg-fuchsia-400/30 blur-3xl"
      />
      <div className={`relative z-10 w-full ${size === 'md' ? 'max-w-md' : 'max-w-xl'}`}>
        {children}
      </div>
    </div>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[28px] bg-white p-7 shadow-[0_28px_80px_-24px_rgba(49,20,120,0.6)] sm:p-9">
      {children}
    </div>
  )
}

export function Brand({ centered = false }: { centered?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${centered ? 'justify-center' : ''}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
        W
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">Webknot</span>
      <span className="text-[13px] text-slate-400">AI Interview</span>
    </div>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export function IconChip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'brand' | 'success' | 'danger' }) {
  const tones = {
    muted: 'bg-slate-100 text-slate-500',
    brand: 'bg-indigo-50 text-indigo-600',
    success: 'bg-emerald-50 text-emerald-600',
    danger: 'bg-rose-50 text-rose-600',
  }
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

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
      className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
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
      className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-[15px] font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/**
 * Centred result screen: expired link, already completed, error, thank you.
 * One idea per card, so everything is centred around the icon.
 */
export function StatusCard({
  icon,
  tone,
  title,
  body,
  children,
  footer,
}: {
  icon: ReactNode
  tone: 'brand' | 'success' | 'danger' | 'muted'
  title: string
  body: string
  children?: ReactNode
  footer?: ReactNode
}) {
  const halos = {
    brand: 'bg-indigo-100 text-indigo-700 ring-indigo-50',
    success: 'bg-emerald-100 text-emerald-700 ring-emerald-50',
    danger: 'bg-rose-100 text-rose-700 ring-rose-50',
    muted: 'bg-slate-200 text-slate-600 ring-slate-100',
  }

  return (
    <GradientShell size="md">
      <Card>
        <div className="flex flex-col items-center text-center">
          <Brand centered />

          <span
            className={`mt-8 flex h-14 w-14 items-center justify-center rounded-full ring-8 ${halos[tone]}`}
          >
            {icon}
          </span>

          <h1 className="mt-5 text-[22px] font-bold leading-tight tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{body}</p>

          {children}

          <div className="mt-7 w-full border-t border-slate-100 pt-4">
            {footer ?? (
              <p className="text-[13px] text-slate-400">
                Questions? Reach out to{' '}
                <a
                  href="mailto:careers@webknot.in"
                  className="font-medium text-indigo-600 hover:text-indigo-700"
                >
                  careers@webknot.in
                </a>
              </p>
            )}
          </div>
        </div>
      </Card>
    </GradientShell>
  )
}
