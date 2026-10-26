import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANDIDATE_STAGE_FILTERS,
  PHONE_SCREENING_LABEL,
  REJECTED_FROM_LABEL,
  REJECTED_LABEL,
  RESUME_SCREENING_LABEL,
  formatHiringStage,
} from '../src/lib/stageLabels.ts'

test('the phone round is shown as Phone Screening', () => {
  assert.equal(PHONE_SCREENING_LABEL, 'Phone Screening')
  assert.equal(formatHiringStage('Screening'), 'Phone Screening')
})

test('the resume round keeps its existing label and the stage ids are untouched', () => {
  assert.equal(formatHiringStage('AI Shortlisted'), RESUME_SCREENING_LABEL)
  // Other stages pass through exactly as the API sent them.
  for (const stage of ['Processing', 'Interview', 'Finalist', 'Hired', 'Rejected', 'Failed']) {
    assert.equal(formatHiringStage(stage), stage)
  }
})

test('a missing stage reads N/A, not a stage name', () => {
  assert.equal(formatHiringStage(null), 'N/A')
  assert.equal(formatHiringStage(undefined), 'N/A')
  assert.equal(formatHiringStage(''), 'N/A')
})

test('the stage filter shows Phone Screening but keeps its URL key', () => {
  const phone = CANDIDATE_STAGE_FILTERS.find((f) => f.value === 'screening')
  assert.ok(phone, 'screening filter must still exist under its stable key')
  assert.equal(phone.label, 'Phone Screening')
  // Bookmarked /candidates?stage=screening links and the API filter depend on these.
  assert.deepEqual(
    CANDIDATE_STAGE_FILTERS.map((f) => f.value),
    ['', 'ai_shortlisted', 'screening', 'interview', 'finalists'],
  )
})

test('no filter label is the bare word Screening any more', () => {
  assert.ok(CANDIDATE_STAGE_FILTERS.every((f) => f.label !== 'Screening'))
})

test('rejected candidates have one name, and the places they came from are named like the stages', () => {
  assert.equal(REJECTED_LABEL, 'Rejected')
  assert.deepEqual(REJECTED_FROM_LABEL, {
    resume: RESUME_SCREENING_LABEL,
    phone: PHONE_SCREENING_LABEL,
    interview: 'Interview',
  })
})
