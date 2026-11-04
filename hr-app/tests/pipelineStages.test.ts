// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describePipelineCandidate, PIPELINE_STAGE_LABEL } from '../src/lib/pipelineStages.ts'
import type { PipelineCandidate } from '../src/types/api.ts'

const cand = (over: Partial<PipelineCandidate>): PipelineCandidate => ({
  candidate_id: 'c1',
  name: 'Asha Rao',
  stage: 'resume',
  applied_at: '2026-11-01T00:00:00Z',
  ...over,
})

test('each stage names itself by the shared labels', () => {
  assert.equal(PIPELINE_STAGE_LABEL.phone, 'Phone Screening')
  assert.equal(PIPELINE_STAGE_LABEL.resume, 'Resume Screening')
  assert.equal(PIPELINE_STAGE_LABEL.rejected, 'Rejected')
  assert.equal(describePipelineCandidate(cand({ stage: 'finalist' })).label, 'Finalists')
})

test('a finalist is positive, a rejection and a failed review are negative', () => {
  assert.equal(describePipelineCandidate(cand({ stage: 'finalist' })).tone, 'pos')
  assert.equal(describePipelineCandidate(cand({ stage: 'rejected' })).tone, 'neg')
  const failed = describePipelineCandidate(cand({ stage: 'failed', failure_reason: 'This file could not be read.' }))
  assert.deepEqual([failed.tone, failed.detail], ['neg', 'This file could not be read.'])
})

test('a phone-stage candidate reads from the call state, and says why a flag was raised', () => {
  assert.equal(describePipelineCandidate(cand({ stage: 'phone', state: 'live' })).detail, 'Call in progress')
  assert.equal(describePipelineCandidate(cand({ stage: 'phone', state: null })).detail, 'Waiting for the call')
  const flagged = describePipelineCandidate(cand({ stage: 'phone', state: 'flagged', reason: 'Candidate declined the call' }))
  assert.deepEqual([flagged.detail, flagged.tone], ['Candidate declined the call', 'warn'])
  // a reason on any other state is ignored rather than shown out of context
  assert.equal(describePipelineCandidate(cand({ stage: 'phone', state: 'live', reason: 'stale' })).detail, 'Call in progress')
})

test('an interview shows its state, and the scheduled time only for a sent link', () => {
  const sent = describePipelineCandidate(cand({ stage: 'interview', state: 'link_sent', scheduled_at: '2026-11-05T09:30:00+00:00' }))
  assert.equal(sent.detail, 'Link sent')
  assert.match(sent.at ?? '', /2026/)
  assert.equal(describePipelineCandidate(cand({ stage: 'interview', state: 'link_sent', scheduled_at: null })).at, undefined)
  assert.equal(describePipelineCandidate(cand({ stage: 'interview', state: 'cancelled' })).detail, 'Interview cancelled')
})

test('a state this page does not know still reads as something', () => {
  assert.equal(describePipelineCandidate(cand({ stage: 'interview', state: 'brand_new' })).detail, 'In this stage')
})
