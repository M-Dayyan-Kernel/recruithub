// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasAction,
  interviewRowStatusLabel,
  resolveInterviewStatus,
  roundLabel,
} from '../src/lib/interviewStatus.ts'
import type { InterviewPipelineCandidate, InterviewSession } from '../src/types/api.ts'

const session = (status: InterviewSession['status'], extra: Partial<InterviewSession> = {}): InterviewSession => ({
  id: 's1',
  candidate_id: 'c1',
  job_id: 'j1',
  unique_token: 't',
  status,
  round_number: 1,
  created_at: '2026-10-31T10:00:00Z',
  ...extra,
})

const row = (extra: Partial<InterviewPipelineCandidate> = {}): InterviewPipelineCandidate => ({
  candidate_id: 'c1',
  tab: 'completed',
  has_report: false,
  round_number: 1,
  round_count: 1,
  is_live: false,
  finalist: false,
  available_actions: [],
  ...extra,
})

test('every session state has a status, and a taken round reads as completed', () => {
  assert.equal(resolveInterviewStatus(false, null), 'not_sent')
  assert.equal(resolveInterviewStatus(true, null), 'completed')
  assert.equal(resolveInterviewStatus(false, session('cancelled')), 'cancelled')
  assert.equal(resolveInterviewStatus(false, session('expired')), 'expired')
  assert.equal(resolveInterviewStatus(false, session('in_progress')), 'in_progress')
  assert.equal(resolveInterviewStatus(false, session('pending')), 'link_sent')
  for (const status of ['completed', 'assessed'] as const) {
    assert.equal(resolveInterviewStatus(false, session(status)), 'completed', status)
  }
  assert.equal(resolveInterviewStatus(false, session('assessment_failed')), 'assessment_failed')
})

test('a pending round with a future slot is scheduled, a past one is just a sent link', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()
  assert.equal(resolveInterviewStatus(false, session('pending', { scheduled_interview_at: future })), 'scheduled')
  assert.equal(resolveInterviewStatus(false, session('pending', { scheduled_interview_at: past })), 'link_sent')
})

test('the row label puts the finalist mark and a live interview before the round state', () => {
  assert.equal(interviewRowStatusLabel(row({ finalist: true, session: session('completed') })), 'Finalist')
  assert.equal(interviewRowStatusLabel(row({ is_live: true, session: session('in_progress') })), 'Interview in progress')
  assert.equal(interviewRowStatusLabel(row({ session: session('assessment_failed') })), 'Assessment Failed')
  assert.equal(interviewRowStatusLabel(row({ session: session('expired') })), 'Expired')
  assert.equal(interviewRowStatusLabel(row({ has_report: true, session: session('assessed') })), 'Completed')
})

test('actions are exactly what the server listed', () => {
  const r = row({ available_actions: ['next_round', 'void_round'] })
  assert.equal(hasAction(r, 'next_round'), true)
  assert.equal(hasAction(r, 'reschedule'), false)
  assert.equal(hasAction(row(), 'reject'), false)
})

test('the round label appears once a round exists', () => {
  assert.equal(roundLabel(row({ round_number: 0, round_count: 0 })), null)
  assert.equal(roundLabel(row({ round_number: 2, round_count: 2 })), 'Round 2')
})
