// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIENCE_MAX_YEARS,
  SCREENING_ATTEMPTS_MAX,
  SCREENING_DELAY_MAX_MINUTES,
  validateExperienceRange,
  validateScreeningAttemptsText,
  validateScreeningDelayText,
  validateWholeNumberText,
  validateYearsText,
} from '../src/lib/validation.ts'

// ── a single field, exactly as typed ───────────────────────────────────────

test('negative values are flagged, not swallowed', () => {
  assert.equal(validateYearsText('-5', 'Min experience'), 'Min experience cannot be negative')
  assert.equal(validateYearsText('-1', 'Max experience'), 'Max experience cannot be negative')
  assert.equal(validateYearsText('-0', 'Min experience'), 'Min experience cannot be negative')
})

test('a lone minus sign is flagged, not treated as blank', () => {
  assert.equal(validateYearsText('-', 'Min experience'), 'Min experience cannot be negative')
})

test('decimals and non-numeric text are flagged', () => {
  for (const raw of ['2.5', '3,5', 'abc', '1e3', '+4', '5 years', '--5']) {
    assert.ok(validateYearsText(raw, 'Min experience'), `should reject ${JSON.stringify(raw)}`)
  }
  assert.equal(validateYearsText('2.5', 'Min experience'), 'Min experience must be a whole number')
})

test('values above the cap are flagged', () => {
  assert.equal(validateYearsText(String(EXPERIENCE_MAX_YEARS), 'Max experience'), null)
  assert.match(
    validateYearsText(String(EXPERIENCE_MAX_YEARS + 1), 'Max experience') ?? '',
    /cannot exceed 60 years/,
  )
})

test('blank and whole non-negative numbers are valid', () => {
  for (const raw of ['', '   ', '0', '3', '12', '60', ' 7 ']) {
    assert.equal(validateYearsText(raw, 'Min experience'), null, JSON.stringify(raw))
  }
})

// ── the range, as submitted ────────────────────────────────────────────────

test('submit is blocked for a negative min, naming the min field', () => {
  assert.deepEqual(validateExperienceRange('-5', ''), {
    field: 'min',
    message: 'Min experience cannot be negative',
  })
})

test('submit is blocked for a negative max, naming the max field', () => {
  assert.deepEqual(validateExperienceRange('', '-3'), {
    field: 'max',
    message: 'Max experience cannot be negative',
  })
})

test('both negative reports min first', () => {
  assert.equal(validateExperienceRange('-2', '-9')?.field, 'min')
})

test('a bad value is never reported as a blank (the original bug)', () => {
  // The old input handler dropped these, leaving state '' and submitting nothing.
  for (const bad of ['-5', '-', '2.5', 'abc']) {
    assert.notEqual(validateExperienceRange(bad, ''), null, `min ${bad}`)
    assert.notEqual(validateExperienceRange('', bad), null, `max ${bad}`)
  }
})

test('max below min is rejected, equal bounds and open-ended ranges are fine', () => {
  assert.equal(validateExperienceRange('6', '3')?.field, 'max')
  assert.equal(validateExperienceRange('4', '4'), null)
  assert.equal(validateExperienceRange('5', ''), null)
  assert.equal(validateExperienceRange('5', '0'), null) // 0 max = no upper bound
  assert.equal(validateExperienceRange('', ''), null)
})

// ── screening attempts / delay (Settings) ──────────────────────────────────

test('every attempt count in range is accepted, as the ticket lists 2-9', () => {
  for (let n = 1; n <= SCREENING_ATTEMPTS_MAX; n += 1) {
    assert.equal(validateScreeningAttemptsText(String(n)), null, `attempts ${n}`)
  }
})

test('the field can be emptied and re-entered: blank is reported, not swallowed', () => {
  // Typing "3" -> backspace -> "7" passes through "" and must not be rejected
  // by the input handler; the blank state is only a save-time error.
  assert.equal(validateScreeningAttemptsText('3'), null)
  assert.equal(validateScreeningAttemptsText(''), 'Maximum attempts is required')
  assert.equal(validateScreeningAttemptsText('7'), null)
})

test('appending a digit is never silently rewritten to the maximum', () => {
  // The old handler clamped "37" to 10 on the keystroke, so 7 could never be set
  // after 3. The value is now kept as typed and reported honestly.
  assert.equal(validateScreeningAttemptsText('37'), 'Maximum attempts cannot exceed 10')
})

test('attempt bounds', () => {
  assert.equal(validateScreeningAttemptsText('0'), 'Maximum attempts must be at least 1')
  assert.equal(validateScreeningAttemptsText('11'), 'Maximum attempts cannot exceed 10')
  assert.equal(validateScreeningAttemptsText('-2'), 'Maximum attempts must be at least 1')
  assert.equal(validateScreeningAttemptsText('2.5'), 'Maximum attempts must be a whole number')
  assert.equal(validateScreeningAttemptsText('abc'), 'Maximum attempts must be a whole number')
})

test('delay accepts 1 minute up to 7 days, and is required', () => {
  for (const ok of ['1', '2', '30', '60', '1440', String(SCREENING_DELAY_MAX_MINUTES)]) {
    assert.equal(validateScreeningDelayText(ok), null, ok)
  }
  assert.equal(validateScreeningDelayText(''), 'Delay between attempts is required')
  assert.equal(validateScreeningDelayText('0'), 'Delay between attempts must be at least 1')
  assert.equal(
    validateScreeningDelayText(String(SCREENING_DELAY_MAX_MINUTES + 1)),
    'Delay between attempts cannot exceed 10080 minutes',
  )
})

test('limits mirror the backend config (60..604800 seconds, 1..10 attempts)', () => {
  assert.equal(SCREENING_ATTEMPTS_MAX, 10)
  assert.equal(SCREENING_DELAY_MAX_MINUTES * 60, 604800)
})

test('the generic validator keeps the years messages unchanged', () => {
  assert.equal(
    validateWholeNumberText('-1', { label: 'Min experience', min: 0, max: 60, unit: 'years' }),
    'Min experience cannot be negative',
  )
  assert.equal(
    validateWholeNumberText('61', { label: 'Max experience', min: 0, max: 60, unit: 'years' }),
    'Max experience cannot exceed 60 years',
  )
})
