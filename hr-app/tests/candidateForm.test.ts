import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANDIDATE_REQUIRED_FIELDS,
  candidateFormFromProfile,
  candidateUpdatePayload,
  firstInvalidField,
  isRequiredCandidateField,
  validateCandidateForm,
  type CandidateFormValues,
} from '../src/lib/candidateForm.ts'
import { isPlaceholderEmail, validatePhone, validateYearsOfExperience } from '../src/lib/validation.ts'

const valid = (over: Partial<CandidateFormValues> = {}): CandidateFormValues => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+91 98765 43210',
  status: 'active',
  years_experience: '4.5',
  current_ctc: '12 LPA',
  expected_ctc: '16 LPA',
  notice_period: '30 days',
  last_working_day: '',
  ...over,
})

// ── which fields are mandatory ─────────────────────────────────────────────

test('name and email are the mandatory fields; the rest are optional', () => {
  assert.deepEqual([...CANDIDATE_REQUIRED_FIELDS], ['name', 'email'])
  assert.equal(isRequiredCandidateField('name'), true)
  assert.equal(isRequiredCandidateField('email'), true)
  for (const f of ['phone', 'years_experience', 'current_ctc', 'notice_period'] as const) {
    assert.equal(isRequiredCandidateField(f), false, f)
  }
})

// ── leaving mandatory fields empty ─────────────────────────────────────────

test('a complete, valid form has no errors', () => {
  assert.deepEqual(validateCandidateForm(valid()), {})
})

test('blank mandatory fields are reported with a message each', () => {
  const errors = validateCandidateForm(valid({ name: '', email: '' }))
  assert.equal(errors.name, 'Name is required')
  assert.equal(errors.email, 'Email is required')
})

test('whitespace-only is blank, not a value', () => {
  const errors = validateCandidateForm(valid({ name: '   ', email: '  ' }))
  assert.equal(errors.name, 'Name is required')
  assert.equal(errors.email, 'Email is required')
})

test('optional fields may be left empty', () => {
  const errors = validateCandidateForm(
    valid({ phone: '', years_experience: '', current_ctc: '', expected_ctc: '', notice_period: '' }),
  )
  assert.deepEqual(errors, {})
})

test('focus goes to the first invalid field in on-screen order', () => {
  assert.equal(firstInvalidField(validateCandidateForm(valid({ name: '', email: '' }))), 'name')
  assert.equal(firstInvalidField(validateCandidateForm(valid({ email: 'nope' }))), 'email')
  assert.equal(firstInvalidField(validateCandidateForm(valid())), undefined)
})

// ── the placeholder email (resume had none) ────────────────────────────────

test('a placeholder email is shown as empty and cannot be saved', () => {
  assert.equal(isPlaceholderEmail('pending_ab12cd@upload.pending'), true)
  assert.equal(isPlaceholderEmail('Pending_X@Upload.Pending'), true)
  assert.equal(isPlaceholderEmail('ada@example.com'), false)

  const profile = { ...valid(), id: 'c1', email: 'pending_ab12cd@upload.pending' } as never
  const form = candidateFormFromProfile(profile)
  assert.equal(form.email, '', 'the fake address must not be pre-filled')
  assert.equal(validateCandidateForm(form).email, 'Email is required')

  // Typing the placeholder back in is still refused.
  assert.equal(
    validateCandidateForm(valid({ email: 'x@upload.pending' })).email,
    "Enter the candidate's real email address",
  )
})

// ── format rules ───────────────────────────────────────────────────────────

test('malformed email is rejected', () => {
  for (const bad of ['nope', 'a@b', 'a@@b.com', 'a b@c.com']) {
    assert.ok(validateCandidateForm(valid({ email: bad })).email, bad)
  }
})

test('phone: optional, but a value must be a real number', () => {
  assert.equal(validatePhone(''), null)
  assert.equal(validatePhone('+91 98765-43210'), null)
  assert.equal(validatePhone('(022) 2345 6789'), null)
  for (const bad of ['12', 'abc', '98765abc43', '1'.repeat(16)]) {
    assert.ok(validatePhone(bad), bad)
  }
})

test('years of experience: decimals allowed, negatives and text refused', () => {
  assert.equal(validateYearsOfExperience('4.5'), null)
  assert.equal(validateYearsOfExperience(''), null)
  assert.equal(validateYearsOfExperience('-1'), 'Years of experience cannot be negative')
  assert.equal(validateYearsOfExperience('abc'), 'Years of experience must be a number')
  assert.equal(validateYearsOfExperience('61'), 'Years of experience cannot exceed 60')
})

test('over-long free text is flagged', () => {
  assert.ok(validateCandidateForm(valid({ notice_period: 'x'.repeat(101) })).notice_period)
})

// ── what is sent ───────────────────────────────────────────────────────────

test('the payload is trimmed and blanks become null', () => {
  const payload = candidateUpdatePayload(
    valid({ name: '  Ada  ', email: ' ada@example.com ', phone: ' ', current_ctc: '', years_experience: '3' }),
  )
  assert.equal(payload.name, 'Ada')
  assert.equal(payload.email, 'ada@example.com')
  assert.equal(payload.phone, null)
  assert.equal(payload.current_ctc, null)
  assert.equal(payload.years_experience, 3)
})
