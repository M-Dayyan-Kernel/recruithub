// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeWindow, formatCountdown, formatInstant } from '../src/lib/deadline.ts'

const IST = { timeZone: 'Asia/Kolkata', locale: 'en-US' }

test('an instant is shown in the given timezone, with the zone named', () => {
  const text = formatInstant('2026-10-31T12:30:00.000Z', IST)
  assert.ok(text)
  assert.match(text, /Oct 31, 2026/)
  assert.match(text, /6:00/)
  assert.match(text, /\+5:30|IST/)
})

test('the same instant reads differently in another timezone', () => {
  const utc = formatInstant('2026-10-31T12:30:00.000Z', { timeZone: 'UTC', locale: 'en-US' })
  assert.ok(utc)
  assert.match(utc, /12:30/)
})

test('a missing or unreadable instant has no text', () => {
  assert.equal(formatInstant(null), null)
  assert.equal(formatInstant(undefined), null)
  assert.equal(formatInstant(''), null)
  assert.equal(formatInstant('not a date'), null)
})

test('a send-now interview has a deadline and no opening time', () => {
  const text = describeWindow({ scheduled_interview_at: null, expires_at: '2026-10-31T12:30:00.000Z' }, IST)
  assert.equal(text.opens, null)
  assert.match(text.completeBy ?? '', /Oct 31, 2026/)
})

test('a scheduled interview has both', () => {
  const text = describeWindow(
    { scheduled_interview_at: '2026-10-28T05:30:00.000Z', expires_at: '2026-10-31T05:30:00.000Z' },
    IST,
  )
  assert.match(text.opens ?? '', /Oct 28, 2026/)
  assert.match(text.completeBy ?? '', /Oct 31, 2026/)
})

test('a session from before links expired shows neither', () => {
  assert.deepEqual(describeWindow({}), { opens: null, completeBy: null })
})

test('times are shown in IST, named as IST, whatever the candidate\'s own clock says', () => {
  // No timezone or locale passed: the default is what a candidate gets.
  assert.equal(formatInstant('2026-11-02T07:30:00.000Z'), 'Mon, 2 Nov, 2026, 1:00 pm IST')
  assert.equal(formatInstant('2026-11-02T07:30:00.000Z', { locale: 'en-IN' }), 'Mon, 2 Nov, 2026, 1:00 pm IST')
})

test('the opening time and the deadline both default to IST', () => {
  const text = describeWindow({ scheduled_interview_at: '2026-11-02T07:30:00.000Z', expires_at: '2026-11-05T07:30:00.000Z' })
  assert.equal(text.opens, 'Mon, 2 Nov, 2026, 1:00 pm IST')
  assert.equal(text.completeBy, 'Thu, 5 Nov, 2026, 1:00 pm IST')
})

test('a countdown reads in the largest sensible units', () => {
  assert.equal(formatCountdown(45), '45 s')
  assert.equal(formatCountdown(11 * 60), '11 min 00 s')
  assert.equal(formatCountdown(12 * 60 + 30), '12 min 30 s')
  assert.equal(formatCountdown(3600 + 5 * 60), '1 h 05 min')
  assert.equal(formatCountdown(86_400 + 3 * 3600), '1 day 3 h')
  assert.equal(formatCountdown(2 * 86_400), '2 days 0 h')
})

test('a countdown never shows a negative or fractional time', () => {
  assert.equal(formatCountdown(-5), '0 s')
  assert.equal(formatCountdown(0.2), '1 s')
})
