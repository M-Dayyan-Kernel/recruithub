// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeWindow, formatInstant } from '../src/lib/deadline.ts'

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
