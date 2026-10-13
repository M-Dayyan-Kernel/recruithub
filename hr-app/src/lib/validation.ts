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

/** Longest candidate name the database stores. */
export const CANDIDATE_NAME_MAX_LENGTH = 255

/**
 * Suffix of the stand-in address created when a resume had no email. It means
 * "email missing", so it is shown as empty and is never a valid value to save.
 * Mirrors PLACEHOLDER_EMAIL_SUFFIX in the backend schemas.
 */
export const PLACEHOLDER_EMAIL_SUFFIX = '@upload.pending'

export function isPlaceholderEmail(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase().endsWith(PLACEHOLDER_EMAIL_SUFFIX)
}

const PHONE_ALLOWED = /^\+?[\d\s().-]+$/
export const PHONE_MIN_DIGITS = 7
export const PHONE_MAX_DIGITS = 15 // E.164

/** Optional phone number: blank is fine, anything entered must be a real number. */
export function validatePhone(value: string, label = 'Phone'): string | null {
  const phone = value.trim()
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (
    phone.length > 50 ||
    !PHONE_ALLOWED.test(phone) ||
    digits.length < PHONE_MIN_DIGITS ||
    digits.length > PHONE_MAX_DIGITS
  ) {
    return `Enter a valid ${label.toLowerCase()} number (${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digits)`
  }
  return null
}

/** Optional years of experience; a decimal such as 4.5 is allowed. */
export function validateYearsOfExperience(raw: string, label = 'Years of experience'): string | null {
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith('-')) return `${label} cannot be negative`
  if (!/^\d+(\.\d+)?$/.test(text)) return `${label} must be a number`
  if (Number(text) > EXPERIENCE_MAX_YEARS) {
    return `${label} cannot exceed ${EXPERIENCE_MAX_YEARS}`
  }
  return null
}

/** Optional short free-text field (CTC, notice period) capped at its column size. */
export function validateShortText(value: string, label: string, max = 100): string | null {
  return value.trim().length > max ? `${label} must be at most ${max} characters` : null
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
 * Checks what the user typed into a whole-number field.
 *
 * Returns a message for anything that is not a whole number within
 * [min, max], or null when the text is valid. Blank is valid unless
 * `required`. The text is validated exactly as typed and never silently
 * discarded or clamped: swallowing a keystroke leaves the field showing one
 * thing while form state holds another, and clamping on every keystroke
 * rewrites "3" + "7" into "10" so the field can never be edited.
 */
export function validateWholeNumberText(
  raw: string,
  {
    label,
    min,
    max,
    required = false,
    unit,
  }: { label: string; min: number; max: number; required?: boolean; unit?: string },
): string | null {
  const text = raw.trim()
  if (text === '') return required ? `${label} is required` : null
  if (text.startsWith('-')) {
    return min === 0 ? `${label} cannot be negative` : `${label} must be at least ${min}`
  }
  if (!/^\d+$/.test(text)) return `${label} must be a whole number`
  const value = Number(text)
  if (value < min) return `${label} must be at least ${min}`
  if (value > max) return `${label} cannot exceed ${max}${unit ? ` ${unit}` : ''}`
  return null
}

/** Years-of-experience field: blank (not specified) or a whole 0..60. */
export function validateYearsText(raw: string, label: string): string | null {
  return validateWholeNumberText(raw, {
    label,
    min: 0,
    max: EXPERIENCE_MAX_YEARS,
    unit: 'years',
  })
}

// Screening retry limits. Mirror `screening.validation` in backend config.yaml
// (min/max retries; min/max retry delay seconds, shown here in minutes), which
// the API enforces on save.
export const SCREENING_ATTEMPTS_MIN = 1
export const SCREENING_ATTEMPTS_MAX = 10
export const SCREENING_DELAY_MIN_MINUTES = 1
export const SCREENING_DELAY_MAX_MINUTES = 10080

export function validateScreeningAttemptsText(raw: string): string | null {
  return validateWholeNumberText(raw, {
    label: 'Maximum attempts',
    min: SCREENING_ATTEMPTS_MIN,
    max: SCREENING_ATTEMPTS_MAX,
    required: true,
  })
}

export function validateScreeningDelayText(raw: string): string | null {
  return validateWholeNumberText(raw, {
    label: 'Delay between attempts',
    min: SCREENING_DELAY_MIN_MINUTES,
    max: SCREENING_DELAY_MAX_MINUTES,
    required: true,
    unit: 'minutes',
  })
}

/** Validates an experience range, returning the first problem found. */
export function validateExperienceRange(
  min: string,
  max: string,
): { field: 'min' | 'max'; message: string } | null {
  const minError = validateYearsText(min, 'Min experience')
  if (minError) return { field: 'min', message: minError }
  const maxError = validateYearsText(max, 'Max experience')
  if (maxError) return { field: 'max', message: maxError }

  const minNum = min.trim() === '' ? null : Number(min)
  const maxNum = max.trim() === '' ? null : Number(max)

  // A maximum of 0 means "no upper bound" (the API stores a blank max as 0),
  // so it is never compared with the minimum.
  if (minNum !== null && maxNum !== null && maxNum > 0 && maxNum < minNum) {
    return {
      field: 'max',
      message: 'Max experience cannot be less than min experience',
    }
  }
  return null
}
