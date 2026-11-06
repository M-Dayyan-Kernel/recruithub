// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialsOf, timeAgo } from '../src/lib/timeAgo.ts'
import { buildPipelineCsv } from '../src/lib/pipelineExport.ts'
import type { PipelineCandidate } from '../src/types/api.ts'

const NOW = new Date('2026-11-06T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

test('how long ago, in the shortest honest words', () => {
  assert.equal(timeAgo(ago(20_000), NOW), 'Just now')
  assert.equal(timeAgo(ago(35 * MIN), NOW), '35m ago')
  assert.equal(timeAgo(ago(2 * HOUR + 5 * MIN), NOW), '2h ago')
  assert.equal(timeAgo(ago(30 * HOUR), NOW), 'Yesterday')
  assert.equal(timeAgo(ago(4 * 24 * HOUR), NOW), '4d ago')
  assert.match(timeAgo(ago(20 * 24 * HOUR), NOW), /Oct/)
  assert.equal(timeAgo('not a date', NOW), '')
})

test('initials are one or two capitals', () => {
  assert.equal(initialsOf('Mohammed Dayyan'), 'MD')
  assert.equal(initialsOf('Shivaharini'), 'S')
  assert.equal(initialsOf('  rohan   k  mehta '), 'RM')
  assert.equal(initialsOf(''), '?')
})

test('the CSV has a header, one row per candidate, and escapes commas and quotes', () => {
  const c = (over: Partial<PipelineCandidate>): PipelineCandidate => ({
    candidate_id: 'c1', name: 'Asha Rao', stage: 'resume', applied_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', ...over,
  })
  const csv = buildPipelineCsv([c({ match_score: 91.6, email: 'asha@x.com' }), c({ name: 'Dev, "DP" P', stage: 'finalist' })])
  const lines = csv.split('\n')
  assert.equal(lines[0], 'Name,Email,Phone,Stage,Status,Match %,Last updated')
  assert.equal(lines.length, 3)
  assert.match(lines[1], /^Asha Rao,asha@x\.com,,Resume Screening,Awaiting your decision,92,/)
  assert.match(lines[2], /^"Dev, ""DP"" P",,,Finalists,Approved as a finalist,,/)
})
