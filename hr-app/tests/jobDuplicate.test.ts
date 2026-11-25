import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateJobPath, jobToFormContent } from '../src/lib/jobDuplicate.ts'
import type { Job } from '../src/types/api.ts'

const closed: Job = {
  id: 'job-1',
  title: 'Backend Engineer',
  description: 'Build services',
  required_skills: ['Python', 'SQL'],
  seniority_level: 'senior',
  work_mode: 'hybrid',
  work_location: 'Bengaluru',
  screening_questions: [
    { id: 'screening-default-notice', question: 'Notice period?', kind: 'standard' },
    { id: 'q-role', question: 'Years with FastAPI?', kind: 'role' },
  ],
  interview_topics: [
    { id: 'saved-1', name: 'APIs', scope: 'Design', skill_tag: 'api', seed_question: 'Design an API', is_mandatory: true },
  ],
  voice_screening_enabled: false,
  extension_check_enabled: true,
  extension_check_mode: 'enforce',
  status: 'closed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

test('a duplicate copies what HR wrote, without the standard questions', () => {
  const form = jobToFormContent(closed)
  assert.equal(form.title, 'Backend Engineer')
  assert.deepEqual(form.skills, ['Python', 'SQL'])
  assert.equal(form.seniority, 'senior')
  assert.equal(form.workMode, 'hybrid')
  assert.deepEqual(form.extraQuestions.map((q) => q.question), ['Years with FastAPI?'])
  assert.equal(form.voiceScreeningEnabled, false)
  assert.equal(form.extensionCheckMode, 'enforce')
})

test('copied topics are new: the saved ids are dropped', () => {
  const [topic] = jobToFormContent(closed).interviewTopics
  assert.equal(topic.id, undefined)
  assert.equal(topic.name, 'APIs')
})

test('missing fields on an older job become empty values', () => {
  const form = jobToFormContent({ ...closed, required_skills: null, work_mode: null, work_location: null, interview_topics: undefined })
  assert.deepEqual(form.skills, [])
  assert.equal(form.workMode, null)
  assert.equal(form.workLocation, '')
  assert.deepEqual(form.interviewTopics, [])
})

test('the duplicate link carries the job id', () => {
  assert.equal(duplicateJobPath('job-1'), '/jobs/new?duplicate=job-1')
})
