// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidateSteps } from '../src/lib/candidateSteps.ts'
import type { CandidateProfile } from '../src/types/api.ts'

const shortlist = { match_score: 91.6, recommendation: 'shortlisted' } as NonNullable<CandidateProfile['shortlist']>
const call = (over: object = {}) => ({ call_status: 'completed', result: 'pass', skipped: false, ...over }) as NonNullable<CandidateProfile['screening']>
const session = (round_number: number, status: string) => ({ round_number, status }) as NonNullable<CandidateProfile['interview_sessions']>[number]
const states = (r: ReturnType<typeof buildCandidateSteps>) => r.steps.map((s) => s.state)

test('a candidate awaiting a resume decision is at the first step', () => {
  const r = buildCandidateSteps('resume', { shortlist })
  assert.deepEqual(states(r), ['current', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(r.steps[0].detail, '92% · Pass')
})

test('earlier steps are done and say what they produced', () => {
  const r = buildCandidateSteps('interview', { shortlist, screening: call(), interview_sessions: [session(1, 'completed'), session(2, 'in_progress')] })
  assert.deepEqual(states(r), ['done', 'done', 'current', 'upcoming'])
  assert.equal(r.steps[1].detail, 'Passed')
  assert.equal(r.steps[2].detail, 'Round 2 · In progress')
})

test('moved to an interview without a call: the phone step is skipped, not done', () => {
  const r = buildCandidateSteps('interview', { shortlist, screening: call({ skipped: true }), interview_sessions: [session(1, 'pending')] })
  assert.equal(r.steps[1].state, 'skipped')
  assert.equal(r.steps[1].detail, 'Skipped')
  assert.equal(buildCandidateSteps('interview', { shortlist, interview_sessions: [session(1, 'pending')] }).steps[1].state, 'skipped')
})

test('a finalist has every step behind them', () => {
  const r = buildCandidateSteps('finalist', { shortlist, screening: call(), interview_sessions: [session(1, 'assessed')] })
  assert.deepEqual(states(r), ['done', 'done', 'done', 'done'])
  assert.equal(r.steps[3].detail, 'Approved as a finalist')
})

test('before scoring nothing has happened yet, and a failed review is flagged', () => {
  assert.deepEqual(states(buildCandidateSteps('processing')), ['upcoming', 'upcoming', 'upcoming', 'upcoming'])
  const failed = buildCandidateSteps('failed')
  assert.equal(failed.outcome, 'failed')
  assert.deepEqual(states(failed), ['upcoming', 'upcoming', 'upcoming', 'upcoming'])
})

test('a rejection sits at the furthest step that left a record', () => {
  const atResume = buildCandidateSteps('rejected', { shortlist })
  assert.deepEqual(states(atResume), ['current', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(atResume.outcome, 'rejected')
  const afterInterview = buildCandidateSteps('rejected', { shortlist, screening: call(), interview_sessions: [session(1, 'completed')] })
  assert.deepEqual(states(afterInterview), ['done', 'done', 'current', 'upcoming'])
})

test('a call that never connected reads as its status, not a result', () => {
  const r = buildCandidateSteps('phone', { shortlist, screening: call({ result: null, call_status: 'in_progress' }) })
  assert.equal(r.steps[1].detail, 'Call in progress')
})
