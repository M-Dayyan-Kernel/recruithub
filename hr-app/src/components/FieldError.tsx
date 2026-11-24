import { WRAP_SAFE } from '@/components/ui/FormAlert'

/**
 * Asterisk marking a mandatory field, placed inside the field's `<label>`.
 *
 * Hidden from screen readers: the input's own `required`/`aria-required` already
 * announces it, so reading the asterisk too would just be noise.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-neg">
      *
    </span>
  )
}

/**
 * Inline validation message rendered under a form field. `id` lets the input point at it with
 * aria-describedby, so a screen reader reads the message with the field.
 */
export function FieldError({ message, id }: { message?: string | null; id?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className={`mt-1.5 text-xs text-neg ${WRAP_SAFE}`}>
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
