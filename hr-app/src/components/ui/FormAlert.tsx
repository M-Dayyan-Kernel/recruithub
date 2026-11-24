import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'

/**
 * Wraps anywhere, including inside one long unbroken word. Server messages carry emails, URLs and
 * ids with no spaces in them, and without this they stretched the card or ran off a phone screen.
 */
export const WRAP_SAFE = 'min-w-0 break-words [overflow-wrap:anywhere]'

const TONES = {
  neg: { box: 'border-neg/15 bg-neg-soft', text: 'text-neg', Icon: AlertCircle },
  warn: { box: 'border-warn/15 bg-warn-soft', text: 'text-warn', Icon: AlertTriangle },
} as const

/**
 * A message about a whole form or page section: a sign-in that failed, a save the server refused,
 * figures that could not load. It stays until the cause changes, unlike a toast, which is gone
 * before a slow reader finishes it. Errors about one field belong under that field (FieldError).
 */
export function FormAlert({
  tone = 'neg',
  title,
  children,
  action,
  className = '',
}: {
  tone?: keyof typeof TONES
  title?: ReactNode
  children?: ReactNode
  /** A control that fixes it, e.g. a Retry link, placed after the text. */
  action?: ReactNode
  className?: string
}) {
  const { box, text, Icon } = TONES[tone]
  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-md border px-3.5 py-3 ${box} ${className}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${text}`} aria-hidden />
      <div className={`flex-1 text-[13px] leading-relaxed ${WRAP_SAFE}`}>
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-ink-muted' : 'text-ink'}>{children}</div>}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  )
}

export default FormAlert
