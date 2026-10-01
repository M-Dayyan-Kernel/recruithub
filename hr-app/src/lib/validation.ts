/**
 * Client-side mirrors of the backend Pydantic rules, so forms fail fast
 * instead of round-tripping to the API for a 422.
 *
 * Keep in sync with `backend/app/schemas/schemas.py`:
 *   - `validate_password_strength` / `_PASSWORD_MIN_LEN` / `_PASSWORD_PATTERN`
 *   - `EmailStr` (email-validator)
 *   - `Field(min_length=1, max_length=255)` on name fields
 *
 * Each validator returns an error message, or `null` when the value is valid.
 */

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

// Deliberately far below the String(255) columns — these are names, not prose.
export const ORG_NAME_MAX_LENGTH = 100
export const PERSON_NAME_MAX_LENGTH = 80

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter, a digit, and a special character.`

// Same special-character set the backend accepts.
const PASSWORD_SPECIAL = /[!@#$%^&*(),.?":{}|<>_\-[\]\\/+=~`]/

// email-validator requires a dotted domain, so `test@cda` and `user@localhost`
// are rejected here exactly as the backend rejects them. Deliberately one notch
// stricter on the TLD (2+ letters, so `a@b.c` fails here but passes the backend)
// — no registered TLD is a single character, and it catches more typos.
const EMAIL_PATTERN =
  /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/

export function validateEmail(value: string, label = 'Email'): string | null {
  const email = value.trim()
  if (!email) return `${label} is required`
  if (email.length > 254) return `${label} is too long`

  const [local, ...rest] = email.split('@')
  if (rest.length !== 1) return `Enter a valid ${label.toLowerCase()} address`
  if (local.length > 64) return `${label} is too long`
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return `Enter a valid ${label.toLowerCase()} address`
  }
  if (!EMAIL_PATTERN.test(email)) {
    return `Enter a valid ${label.toLowerCase()} address, e.g. name@company.com`
  }
  return null
}

export function validatePassword(value: string, label = 'Password'): string | null {
  if (!value) return `${label} is required`
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `${label} must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `${label} must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  if (!/[a-z]/.test(value)) return `${label} must include a lowercase letter`
  if (!/[A-Z]/.test(value)) return `${label} must include an uppercase letter`
  if (!/\d/.test(value)) return `${label} must include a digit`
  if (!PASSWORD_SPECIAL.test(value)) return `${label} must include a special character`
  return null
}

/**
 * Names are trimmed before being sent, so whitespace-only input is rejected here
 * even though the backend's `min_length=1` would accept the untrimmed string.
 */
export function validateName(
  value: string,
  label = 'Name',
  maxLength = PERSON_NAME_MAX_LENGTH,
): string | null {
  const name = value.trim()
  if (!name) return `${label} is required`
  if (name.length > maxLength) {
    return `${label} must be at most ${maxLength} characters`
  }
  return null
}

/** Convenience wrapper for organization/company name fields. */
export function validateOrgName(value: string, label = 'Organization name'): string | null {
  return validateName(value, label, ORG_NAME_MAX_LENGTH)
}

/** True when every entry of a field-error map is null/undefined. */
export function isValid(errors: object): boolean {
  return (Object.values(errors) as Array<string | null | undefined>).every((e) => !e)
}

/** Upper bound for a years-of-experience field — a sanity cap, not a real limit. */
export const EXPERIENCE_MAX_YEARS = 60

/**
 * Keeps a years-of-experience input to whole non-negative numbers.
 *
 * `min={0}` on a number input only gates native form validation, and these
 * forms submit via click handlers — so a typed "-5" would otherwise reach
 * state. Returns null when the keystroke should be rejected outright.
 */
export function sanitizeYearsInput(raw: string): string | null {
  if (raw === '') return ''
  if (!/^\d+$/.test(raw)) return null
  return String(Number(raw))
}

/** Validates an experience range, returning the first problem found. */
export function validateExperienceRange(
  min: string,
  max: string,
): { field: 'min' | 'max'; message: string } | null {
  const minNum = min === '' ? null : Number(min)
  const maxNum = max === '' ? null : Number(max)

  for (const [value, field, label] of [
    [minNum, 'min', 'Min experience'],
    [maxNum, 'max', 'Max experience'],
  ] as const) {
    if (value === null) continue
    if (!Number.isFinite(value) || value < 0) {
      return { field, message: `${label} cannot be negative` }
    }
    if (value > EXPERIENCE_MAX_YEARS) {
      return { field, message: `${label} cannot exceed ${EXPERIENCE_MAX_YEARS} years` }
    }
  }

  if (minNum !== null && maxNum !== null && maxNum < minNum) {
    return {
      field: 'max',
      message: 'Max experience cannot be less than min experience',
    }
  }
  return null
}

/**
 * Clamps a numeric-input keystroke to a whole number within [min, max].
 *
 * `min`/`max` on a number input only drive native form validation, so a typed
 * "-29" still reaches state on a page that saves via a click handler. Returns
 * null when the keystroke should be ignored (blank or non-numeric), letting the
 * caller keep the previous value.
 */
export function clampWholeNumberInput(
  raw: string,
  { min, max }: { min: number; max: number },
): number | null {
  if (!/^\d+$/.test(raw)) return null
  return Math.min(Math.max(Number(raw), min), max)
}
