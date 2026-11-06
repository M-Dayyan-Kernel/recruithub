// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detailSections,
  headerChips,
  matchVerdict,
  pipelineEvents,
  profileStageView,
  skillSummary,
} from '../src/lib/candidateProfileView.ts'
import type { CandidateProfile } from '../src/types/api.ts'

const base = (over: Partial<CandidateProfile> = {}): CandidateProfile =>
  ({
    id: 'c1', job_id: 'j1', job_title: 'Backend Engineer', name: 'Shivaharini', email: 's@x.com',
    hiring_stage: 'Finalist', status: 'active', date_applied: '2026-11-01T00:00:00Z', pipeline_status: 'completed',
    ...over,
  }) as CandidateProfile

const shortlist = { match_score: 94, recommendation: 'shortlisted', strengths: ['Java', 'Spring Boot', 'PostgreSQL'], gaps: ['Kubernetes'], created_at: '2026-11-02T09:00:00Z' } as NonNullable<CandidateProfile['shortlist']>

test('the stage reads from the server’s pipeline stage, with the directory label as a fallback', () => {
  const placed = profileStageView(base({ pipeline_stage: 'phone', stage_state: 'flagged', stage_reason: 'Candidate declined the call' }))
  assert.deepEqual([placed.label, placed.detail, placed.tone], ['Phone Screening', 'Candidate declined the call', 'warn'])
  const fallback = profileStageView(base({ pipeline_stage: null }))
  assert.equal(fallback.label, 'Finalist')
})

test('the verdict follows the AI recommendation', () => {
  assert.equal(matchVerdict(base({ shortlist }))?.label, 'Strong fit')
  assert.equal(matchVerdict(base({ shortlist: { ...shortlist, recommendation: 'review' } }))?.tone, 'warn')
  assert.equal(matchVerdict(base({ shortlist: { ...shortlist, recommendation: 'rejected' } }))?.label, 'Weak fit')
  assert.equal(matchVerdict(base()), null)
})

test('skills are counted against the job’s, and the rest of the resume is listed apart', () => {
  const summary = skillSummary(
    base({ shortlist, parsed_data: { skills: ['Java', 'Kafka', 'AWS', 'spring boot'] } }),
    ['Java', 'Spring Boot', 'PostgreSQL', 'Kubernetes', 'Docker'],
  )!
  assert.equal(summary.total, 5)
  assert.equal(summary.matched, 3)
  assert.deepEqual(summary.entries.map((e) => e.status), ['matched', 'matched', 'matched', 'gap', 'unclear'])
  assert.deepEqual(summary.other, ['Kafka', 'AWS'])
  assert.equal(skillSummary(base(), ['Java']), null)
  assert.equal(skillSummary(base({ shortlist }), []), null)
})

test('details leave out what is not known, and a group with nothing is dropped', () => {
  const none = detailSections(base({ name: '' }))
  assert.deepEqual(none, [])
  const sections = detailSections(
    base({ years_experience: 4.5, expected_ctc: '₹20 LPA', notice_period: '30 days', parsed_data: { current_role: 'Backend Engineer II', current_company: 'Webknot' } }),
  )
  assert.deepEqual(sections.map((s) => s.title), ['Personal', 'Experience', 'Compensation & availability'])
  assert.deepEqual(sections[1].rows, [
    { label: 'Total experience', value: '4.5 years' },
    { label: 'Current role', value: 'Backend Engineer II · Webknot' },
  ])
  assert.deepEqual(sections[2].rows.map((r) => r.label), ['Expected CTC', 'Notice period'])
})

test('values from the phone call fill in what the candidate record lacks', () => {
  const screening = { call_status: 'completed', skipped: false, current_ctc: '14.5 LPA', location_preference: 'Bengaluru', availability: 'Weekdays 2-6 PM' } as NonNullable<CandidateProfile['screening']>
  const sections = detailSections(base({ screening }))
  const flat = Object.fromEntries(sections.flatMap((s) => s.rows.map((r) => [r.label, r.value])))
  assert.equal(flat['Current CTC'], '14.5 LPA')
  assert.equal(flat['Location preference'], 'Bengaluru')
  assert.equal(flat['Availability'], 'Weekdays 2-6 PM')
  // a skipped screening is a record, not a call that happened
  const skipped = detailSections(base({ screening: { ...screening, skipped: true } }))
  assert.equal(skipped.flatMap((s) => s.rows).some((r) => r.label === 'Availability'), false)
})

test('the header chips are the few facts worth seeing first', () => {
  assert.deepEqual(headerChips(base({ notice_period: '30 days', expected_ctc: '20 LPA', years_experience: 4 })), ['Notice: 30 days', 'Expects 20 LPA', '4 years'])
  assert.deepEqual(headerChips(base()), [])
})

test('the pipeline timeline carries each step’s result and day, and a rejection ends it', () => {
  const screening = { call_status: 'completed', result: 'pass', skipped: false, created_at: '2026-11-04T10:00:00Z' } as NonNullable<CandidateProfile['screening']>
  const events = pipelineEvents(base({ pipeline_stage: 'rejected', shortlist, screening }))
  assert.deepEqual(events.map((e) => e.key), ['resume', 'phone', 'interview', 'finalist', 'rejected'])
  assert.equal(events[0].detail, '94% · Pass')
  assert.match(events[0].at ?? '', /Nov/)
  assert.equal(events[4].state, 'rejected')
  assert.deepEqual(pipelineEvents(base()), [])
})
