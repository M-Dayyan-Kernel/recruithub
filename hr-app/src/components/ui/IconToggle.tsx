import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The chip look shared by the header's icon controls. On is accent-tinted with a dot; off is
 * dashed but still clearly a control. State has to read without hovering, since the meaning
 * lives in a tooltip.
 *
 * This is a deliberate use of the accent (HR asked for a visible on-state): the job header's
 * two chips are its only accent marks, so nothing else in the header may use it. docs/UI.md §2
 * caps the accent at about two a screen; the stage tabs are neutral for the same reason.
 */
export function iconChipClass(on: boolean, disabled?: boolean): string {
  return cn(
    'relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
    on
      ? 'border-accent-border bg-accent-soft text-accent hover:bg-accent-soft/70'
      : 'border-dashed border-line-strong bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink',
    disabled && 'cursor-not-allowed opacity-50',
  )
}

/** The "on" dot in the chip's corner. */
export function OnDot() {
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-surface bg-accent"
    />
  )
}

/**
 * A compact on/off switch that is only an icon. `offIcon` (usually the slashed twin) shows
 * while it is off. The description is the hover tooltip and must say what it does and what a
 * click will do.
 */
export default function IconToggle({
  icon: Icon,
  offIcon: OffIcon = Icon,
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  icon: LucideIcon
  offIcon?: LucideIcon
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Short name, used as the accessible name. */
  label: string
  description: string
}) {
  const Shown = checked ? Icon : OffIcon
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={description}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={iconChipClass(checked, disabled)}
    >
      <Shown size={16} aria-hidden />
      {checked && <OnDot />}
    </button>
  )
}
