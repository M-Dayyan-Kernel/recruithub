// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excerpt, formatDate, formatDateTime, formatOutOf, formatPercent, formatScore, humanize } from '../src/lib/pdf/format.ts'
import { reportFilename, slug } from '../src/lib/pdf/filename.ts'

const WHEN = '2026-10-28T15:49:32Z'

test('dates are day-month-year, never the US order', () => {
  assert.equal(formatDate(WHEN, 'Asia/Kolkata'), '28 Oct 2026')
  assert.match(formatDateTime(WHEN, 'Asia/Kolkata'), /^28 Oct 2026,? 9:19\s?pm$/i)
  // 3 Nov must not read as March 11.
  assert.equal(formatDate('2026-11-03T05:00:00Z', 'Asia/Kolkata'), '3 Nov 2026')
})

test('a missing or unreadable date is empty, not "Invalid Date"', () => {
  for (const value of [null, undefined, '', 'not a date']) {
    assert.equal(formatDate(value as string), '')
    assert.equal(formatDateTime(value as string), '')
  }
})

test('scores drop trailing zeros and read "—" when missing', () => {
  assert.equal(formatScore(82), '82')
  assert.equal(formatScore(82.5), '82.5')
  assert.equal(formatScore(82.25), '82.3')
  assert.equal(formatScore(null), '—')
  assert.equal(formatOutOf(28, 105), '28 / 105')
  assert.equal(formatOutOf(null, 100), '—')
})

test('confidence arrives as 0..1 or 0..100 and prints as a whole percentage', () => {
  assert.equal(formatPercent(0.94), '94%')
  assert.equal(formatPercent(88), '88%')
  assert.equal(formatPercent(0), null)
  assert.equal(formatPercent(null), null)
})

test('an excerpt is cut at a word and marked, and left alone when short', () => {
  assert.equal(excerpt('  a   short\nanswer '), 'a short answer')
  assert.equal(excerpt('', 10), null)
  assert.equal(excerpt(null), null)
  const cut = excerpt('alpha beta gamma delta epsilon zeta', 20)
  assert.ok(cut && cut.endsWith('…') && cut.length <= 21)
  assert.ok(!cut.includes('  '))
  assert.equal(excerpt('x'.repeat(300), 280)?.length, 281)
})

test('end reasons read as words', () => {
  assert.equal(humanize('customer-ended-call'), 'Customer Ended Call')
  assert.equal(humanize('needs_review'), 'Needs Review')
})

test('file names: a name with no Latin letters gets the stated fallback, not "export"', () => {
  assert.equal(slug('Varshini Rao', 'candidate'), 'varshini-rao')
  assert.equal(slug('José  Álvarez', 'candidate'), 'jose-alvarez')
  assert.equal(slug('राहुल शर्मा', 'candidate'), 'candidate')
  assert.equal(slug('', 'job'), 'job')
  assert.equal(slug(null, 'job'), 'job')
  assert.equal(
    reportFilename({ subject: 'Asha Menon', fallback: 'candidate', kind: 'interview-report', stamp: '2026-10-28' }),
    'asha-menon-interview-report-2026-10-28.pdf',
  )
  assert.equal(
    reportFilename({ subject: 'राहुल', fallback: 'candidate', kind: 'screening-report', stamp: '2026-10-28' }),
    'candidate-screening-report-2026-10-28.pdf',
  )
})
