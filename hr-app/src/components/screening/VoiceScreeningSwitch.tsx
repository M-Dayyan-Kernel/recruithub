import { cn } from '@/lib/utils'

interface Props {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function VoiceScreeningSwitch({ checked, disabled, onChange, className }: Props) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2.5 select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span className="text-xs font-medium text-slate-600 sm:text-sm">Voice screening</span>
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2" />
        <span className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  )
}
