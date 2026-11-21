// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeProcessingRow, formatElapsed } from '../src/lib/processingStatus.ts'
import type { Candidate } from '../src/types/api.ts'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const cand = (over: Partial<Candidate>): Candidate => ({
  id: 'c1',
  job_id: 'j1',
  pipeline_status: 'queued',
  created_at: ago(60),
  processing_attempts: 0,
  processing_max_attempts: 4,
  ...over,
})

test('elapsed time reads in seconds, minutes and hours, never negative', () => {
  assert.equal(formatElapsed(40_000), '40 s')
  assert.equal(formatElapsed(12 * 60_000), '12 min')
  assert.equal(formatElapsed(65 * 60_000), '1 h 5 min')
  assert.equal(formatElapsed(-5_000), '0 s')
})

test('a fresh queued resume is waiting, with nothing to do', () => {
  const row = describeProcessingRow(cand({ pipeline_status_at: ago(2) }), NOW, true)
  assert.deepEqual([row.kind, row.tone, row.canRetry, row.canRemove], ['queued', 'neutral', false, false])
  assert.match(row.detail, /2 min/)
})

test('a resume queued for 15 minutes is flagged with Retry and Remove', () => {
  const row = describeProcessingRow(cand({ pipeline_status_at: ago(15) }), NOW, true)
  assert.deepEqual([row.kind, row.tone, row.canRetry, row.canRemove], ['stalled', 'warn', true, true])
})

test('a running attempt reads as reviewing, then as stalled after 5 minutes', () => {
  const fresh = describeProcessingRow(cand({ pipeline_status: 'processing', processing_started_at: ago(1) }), NOW, true)
  assert.equal(fresh.kind, 'reviewing')
  const slow = describeProcessingRow(cand({ pipeline_status: 'processing', processing_started_at: ago(6) }), NOW, true)
  assert.deepEqual([slow.kind, slow.canRetry], ['stalled', true])
})

test('the attempt start, not the first dispatch, times a retried attempt', () => {
  const row = describeProcessingRow(
    cand({ pipeline_status: 'processing', pipeline_status_at: ago(20), processing_started_at: ago(1) }),
    NOW,
    true,
  )
  assert.equal(row.kind, 'reviewing')
})

test('a resume waiting for its automatic retry says which attempt and when, and offers nothing', () => {
  const row = describeProcessingRow(
    cand({
      pipeline_status: 'processing',
      processing_started_at: ago(30),
      processing_attempts: 1,
      processing_retry_at: new Date(NOW + 3 * 60_000).toISOString(),
    }),
    NOW,
    true,
  )
  assert.deepEqual([row.kind, row.canRetry, row.canRemove], ['retrying', false, false])
  assert.match(row.detail, /attempt 2 of 4 in 3 min/)
})

test('with no worker listening every in-flight resume is paused, removable but not retryable', () => {
  for (const status of ['queued', 'processing'] as const) {
    const row = describeProcessingRow(cand({ pipeline_status: status, pipeline_status_at: ago(40) }), NOW, false)
    assert.deepEqual([row.kind, row.tone, row.canRetry, row.canRemove], ['paused', 'warn', false, true])
  }
})

test('an unknown worker status never reads as paused', () => {
  const row = describeProcessingRow(cand({ pipeline_status_at: ago(2) }), NOW, undefined)
  assert.equal(row.kind, 'queued')
})

test('a row from before status times were kept falls back to its upload time', () => {
  const row = describeProcessingRow(cand({ pipeline_status_at: null, created_at: ago(20) }), NOW, true)
  assert.equal(row.kind, 'stalled')
})

test('a finished resume is done', () => {
  const row = describeProcessingRow(cand({ pipeline_status: 'completed' }), NOW, false)
  assert.deepEqual([row.kind, row.tone], ['done', 'pos'])
})
