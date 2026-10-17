/**
 * Asterisk marking a mandatory field, placed inside the field's `<label>`.
 *
 * Hidden from screen readers: the input's own `required`/`aria-required` already
 * announces it, so reading the asterisk too would just be noise.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-rose-500">
      *
    </span>
  )
}

/** Inline validation message rendered under a form field. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1.5 text-xs text-neg">
      {message}
    </p>
  )
}

/**
 * `used / max` counter for a length-capped text field. Stays hidden until the
 * value approaches the cap, so the limit surfaces before input is silently
 * truncated rather than cluttering an empty form.
 */
export function CharCount({ value, max }: { value: string; max: number }) {
  const used = value.length
  if (used < max * 0.7) return null
  return (
    <span className={`text-xs tabular-nums ${used >= max ? 'text-warn' : 'text-ink-subtle'}`}>
      {used}/{max}
    </span>
  )
}
