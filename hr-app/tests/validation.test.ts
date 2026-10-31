// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIENCE_MAX_YEARS,
  SCREENING_ATTEMPTS_MAX,
  SCREENING_DELAY_MAX_MINUTES,
  SCREENING_QUESTIONS_MAX_TOTAL,
  SCREENING_QUESTION_MAX_LENGTH,
  WORK_LOCATION_MAX_LENGTH,
  validateScreeningQuestionText,
  validateWorkLocation,
  validateScreeningAttemptsText,
  validateScreeningDelayText,
  validateWholeNumberText,
} from '../src/lib/validation.ts'

// ── a whole-number field, exactly as typed ─────────────────────────────────

const years = (raw: string) =>
  validateWholeNumberText(raw, { label: 'Years', min: 0, max: EXPERIENCE_MAX_YEARS, unit: 'years' })

test('negative values are flagged, not swallowed', () => {
  assert.equal(years('-5'), 'Years cannot be negative')
  assert.equal(years('-0'), 'Years cannot be negative')
})

test('a lone minus sign is flagged, not treated as blank', () => {
  assert.equal(years('-'), 'Years cannot be negative')
})

test('decimals and non-numeric text are flagged', () => {
  for (const raw of ['2.5', '3,5', 'abc', '1e3', '+4', '5 years', '--5']) {
    assert.ok(years(raw), `should reject ${JSON.stringify(raw)}`)
  }
  assert.equal(years('2.5'), 'Years must be a whole number')
})

test('values above the cap are flagged', () => {
  assert.equal(years(String(EXPERIENCE_MAX_YEARS)), null)
  assert.match(years(String(EXPERIENCE_MAX_YEARS + 1)) ?? '', /cannot exceed 60 years/)
})

test('blank and whole non-negative numbers are valid', () => {
  for (const raw of ['', '   ', '0', '3', '12', '60', ' 7 ']) {
    assert.equal(years(raw), null, JSON.stringify(raw))
  }
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

// ── phone-screening questions and the work location ────────────────────────

test('the limits mirror the backend', () => {
  // backend/app/services/screening_defaults.py: MAX_SCREENING_QUESTIONS / _QUESTION_CHARS / MAX_WORK_LOCATION_CHARS
  assert.equal(SCREENING_QUESTIONS_MAX_TOTAL, 10)
  assert.equal(SCREENING_QUESTION_MAX_LENGTH, 200)
  assert.equal(WORK_LOCATION_MAX_LENGTH, 80)
})

test('a screening question is required and has a length limit', () => {
  assert.equal(validateScreeningQuestionText('Have you used Kafka?'), null)
  assert.equal(validateScreeningQuestionText('x'.repeat(200)), null)
  assert.equal(
    validateScreeningQuestionText('x'.repeat(201)),
    'Questions can be at most 200 characters',
  )
  assert.equal(validateScreeningQuestionText('   '), 'Fill in or remove the empty screening question')
  assert.equal(validateScreeningQuestionText('x'.repeat(51), 50), 'Questions can be at most 50 characters')
})

test('a location is needed for hybrid and on-site jobs only', () => {
  assert.equal(validateWorkLocation('onsite', 'Bengaluru'), null)
  assert.equal(validateWorkLocation('hybrid', ''), 'Work location is required for hybrid and on-site jobs')
  assert.equal(validateWorkLocation('onsite', '   '), 'Work location is required for hybrid and on-site jobs')
  assert.equal(validateWorkLocation('remote', ''), null)
  assert.equal(validateWorkLocation(null, ''), null)
  assert.equal(
    validateWorkLocation('onsite', 'x'.repeat(81)),
    'Work location must be at most 80 characters',
  )
})

