// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KIND_BADGES,
  editableQuestions,
  needsWorkMode,
  questionKind,
  remainingQuestionSlots,
  workArrangementLabel,
  workModeLabel,
} from '../src/lib/screeningQuestions.ts'
import type { ScreeningQuestion } from '../src/types/api.ts'

const std = (id: string): ScreeningQuestion => ({ id: `screening-default-${id}`, question: id, kind: 'standard' })

test('kinds are told apart, with legacy rows reading as custom', () => {
  assert.equal(questionKind(std('notice')), 'standard')
  assert.equal(questionKind({ id: 'screening-default-x', question: 'q' }), 'standard')
  assert.equal(questionKind({ id: 'a', question: 'q', kind: 'role' }), 'role')
  assert.equal(questionKind({ id: 'a', question: 'q', kind: 'custom' }), 'custom')
  assert.equal(questionKind({ id: 'a', question: 'q' }), 'custom')
})

test('only the role and custom questions are editable', () => {
  const list: ScreeningQuestion[] = [std('a'), { id: '1', question: 'r', kind: 'role' }, { id: '2', question: 'c' }]
  assert.deepEqual(editableQuestions(list).map((q) => q.id), ['1', '2'])
  assert.deepEqual(editableQuestions(undefined), [])
})

test('the total cap leaves room for what is already there', () => {
  assert.equal(remainingQuestionSlots(6, 2), 2)
  assert.equal(remainingQuestionSlots(6, 4), 0)
  assert.equal(remainingQuestionSlots(6, 9), 0)
  assert.equal(remainingQuestionSlots(6, 0, 12), 6)
})

test('every kind has a text label, and only the role badge uses the accent', () => {
  assert.equal(KIND_BADGES.standard.label, 'Standard')
  assert.equal(KIND_BADGES.role.label, 'Role-specific')
  assert.equal(KIND_BADGES.custom.label, 'Custom')
  assert.deepEqual(
    Object.entries(KIND_BADGES).filter(([, b]) => b.tone === 'accent').map(([k]) => k),
    ['role'],
  )
})

test('the work arrangement reads as mode and place', () => {
  assert.equal(workArrangementLabel('onsite', 'Bengaluru'), 'On-site · Bengaluru')
  assert.equal(workArrangementLabel('hybrid', ' Pune '), 'Hybrid · Pune')
  assert.equal(workArrangementLabel('remote', 'Pune'), 'Remote')
  assert.equal(workArrangementLabel('onsite', ''), 'On-site')
  assert.equal(workArrangementLabel(null, 'Pune'), null)
  assert.equal(workModeLabel('flexible'), null)
})

test('a job with no work mode must choose one before it can be saved', () => {
  assert.equal(needsWorkMode({ work_mode: null }), true)
  assert.equal(needsWorkMode({}), true)
  assert.equal(needsWorkMode({ work_mode: 'remote' }), false)
})
