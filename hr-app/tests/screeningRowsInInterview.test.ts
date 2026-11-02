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

test('a flagged candidate still waiting in the phone round can be moved or rejected by hand', () => {
  const [row] = rowsFor(shortlist())
  assert.equal(row.tab, 'flagged')
  assert.equal(row.inInterview, false)
  assert.equal(row.canPlace, true)
})

test('a candidate whose interview exists stays listed but offers no call, move or reject', () => {
  const [row] = rowsFor(shortlist({ stage: { kind: 'interview', state: 'link_sent' } }))
  assert.equal(row.tab, 'flagged')
  assert.equal(row.inInterview, true)
  assert.equal(row.canPlace, false)
  assert.equal(row.canCallNow, false)
  assert.equal(row.canCancel, false)
})

test('an interview stage that has no session yet is still the phone round to act on', () => {
  const [row] = rowsFor(shortlist({ stage: { kind: 'interview', state: 'pending' } }))
  assert.equal(row.inInterview, false)
  assert.equal(row.canPlace, true)
})

test('a finalist is also past the phone round, and their stage says Finalist', () => {
  const [row] = rowsFor(shortlist({ stage: { kind: 'interview', state: 'finalist' } }))
  assert.equal(row.inInterview, true)
  assert.equal(row.canPlace, false)
  assert.equal(row.shortlist.stage?.state, 'finalist')
})
