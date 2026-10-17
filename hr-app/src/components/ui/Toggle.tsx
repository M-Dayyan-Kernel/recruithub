/**
 * A switch. Used instead of a checkbox wherever the setting takes effect on
 * save rather than on submit of a form: a switch reads as state, a checkbox
 * reads as a choice in a list.
 */
export default function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}) {
  return (
    <label
      className={`flex items-start gap-3.5 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
          checked ? 'bg-accent' : 'bg-surface-3'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        {/*
          `left` is pinned explicitly. Left to `auto`, the browser resolves the
          static position and that value compounds with the translate, putting
          the knob a full track-width out and over the label beside it.
        */}
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  )
}
