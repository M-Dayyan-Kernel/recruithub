// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScreeningRows } from '../src/components/screening/screeningRows.ts'
import type { ShortlistResultWithCandidate } from '../src/types/api.ts'

const shortlist = (over: Partial<ShortlistResultWithCandidate> = {}): ShortlistResultWithCandidate =>
  ({
    id: 's1',
    candidate_id: 'c1',
    job_id: 'j1',
    match_score: 80,
    recommendation: 'shortlisted',
    strengths: [],
    gaps: [],
    reason: '',
    hr_decision: 'approved',
    created_at: '2026-11-01T00:00:00Z',
    candidate_name: 'Shivaharini',
    ...over,
  }) as ShortlistResultWithCandidate

// No phone number: the row is flagged, the case that offered "Move to interview" and "Reject".
const rowsFor = (sr: ShortlistResultWithCandidate) => buildScreeningRows([sr], {}, [], undefined)

test('a flagged candidate still waiting in the phone round is listed and can be moved or rejected by hand', () => {
  const rows = rowsFor(shortlist())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tab, 'flagged')
  assert.equal(rows[0].canPlace, true)
})

test('a candidate in an interview is on the Interviews page, not listed here', () => {
  assert.equal(rowsFor(shortlist({ stage: { kind: 'interview', state: 'link_sent' } })).length, 0)
  assert.equal(rowsFor(shortlist({ stage: { kind: 'interview', state: 'completed' } })).length, 0)
})

test('a finalist is on the Finalists page, not listed here', () => {
  assert.equal(rowsFor(shortlist({ stage: { kind: 'interview', state: 'finalist' } })).length, 0)
})

test('an interview stage that has no session yet is still the phone round to act on', () => {
  const rows = rowsFor(shortlist({ stage: { kind: 'interview', state: 'pending' } }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].canPlace, true)
})
