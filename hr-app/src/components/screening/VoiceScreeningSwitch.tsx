import { cn } from '@/lib/utils'

interface Props {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  className?: string
  /** The visible label; the same switch serves other per-job settings. */
  label?: string
}

export function VoiceScreeningSwitch({
  checked,
  disabled,
  onChange,
  className,
  label = 'Voice screening',
}: Props) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2.5 select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span className="text-xs font-medium text-slate-600 sm:text-sm">{label}</span>
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span className="pointer-events-none h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2" />
        <span className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  )
}
