// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIENCE_MAX_YEARS,
  validateExperienceRange,
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
