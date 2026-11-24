// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobFormSnapshot, type JobFormContent } from '../src/lib/jobCreationDraft.ts'

const empty: JobFormContent = {
  title: '',
  description: '',
  skills: [],
  skillInput: '',
  seniority: null,
  workMode: null,
  workLocation: '',
  extraQuestions: [],
  interviewTopics: [],
  voiceScreeningEnabled: true,
  extensionCheckEnabled: true,
  extensionCheckMode: 'shadow',
}

const topic = (id: string) => ({
  id,
  name: 'APIs',
  scope: 'REST design',
  skill_tag: 'python',
  seed_question: 'How do you version an API?',
  is_mandatory: false,
})

test('an untouched form matches its starting point', () => {
  assert.equal(jobFormSnapshot(empty), jobFormSnapshot({ ...empty }))
})

test('typing anything, including a pasted description, counts as a change', () => {
  assert.notEqual(jobFormSnapshot(empty), jobFormSnapshot({ ...empty, title: 'Backend Engineer' }))
  assert.notEqual(jobFormSnapshot(empty), jobFormSnapshot({ ...empty, pastedJd: 'We are hiring…' }))
  assert.notEqual(jobFormSnapshot(empty), jobFormSnapshot({ ...empty, voiceScreeningEnabled: false }))
})

test('a missing pasted description reads the same as an empty one (older drafts)', () => {
  assert.equal(jobFormSnapshot(empty), jobFormSnapshot({ ...empty, pastedJd: '' }))
})

test('new ids on restored topics do not make the form look edited', () => {
  const saved = { ...empty, interviewTopics: [topic('a')] }
  const restored = { ...empty, interviewTopics: [topic('b')] }
  assert.equal(jobFormSnapshot(saved), jobFormSnapshot(restored))
})
