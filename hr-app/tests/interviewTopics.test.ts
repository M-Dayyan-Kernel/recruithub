// Run with: npm test  (node:test + Node's built-in TypeScript type stripping; no extra dependencies)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOPIC_MAX_MANDATORY,
  TOPIC_POOL_MAX,
  TOPIC_POOL_MIN,
  cleanTopics,
  createTopic,
  isIncomplete,
  validateTopicPool,
  withIds,
} from '../src/lib/interviewTopics.ts'
import type { InterviewTopic } from '../src/types/api.ts'

const topic = (n: number, extra: Partial<InterviewTopic> = {}): InterviewTopic => ({
  id: `id-${n}`,
  name: `Topic ${n}`,
  scope: 'What to probe.',
  skill_tag: `skill ${n}`,
  seed_question: `Explain topic ${n}.`,
  is_mandatory: false,
  ...extra,
})
const pool = (size: number) => Array.from({ length: size }, (_, n) => topic(n))

test('an empty pool is fine: the job then has no topics to interview on', () => {
  assert.equal(validateTopicPool([]), null)
})

test('a pool has a minimum and a maximum size', () => {
  assert.equal(validateTopicPool(pool(TOPIC_POOL_MIN)), null)
  assert.equal(validateTopicPool(pool(TOPIC_POOL_MAX)), null)
  assert.match(validateTopicPool(pool(TOPIC_POOL_MIN - 1)) ?? '', /at least 8/)
  assert.match(validateTopicPool(pool(TOPIC_POOL_MAX + 1)) ?? '', /at most 20/)
})

test('an incomplete topic blocks saving, whatever the size', () => {
  for (const field of ['name', 'scope', 'skill_tag', 'seed_question'] as const) {
    const topics = pool(10)
    topics[3] = { ...topics[3], [field]: '   ' }
    assert.match(validateTopicPool(topics) ?? '', /incomplete/, field)
  }
  assert.equal(isIncomplete(createTopic()), true)
  assert.equal(isIncomplete(topic(1)), false)
})

test('topic names are unique, ignoring case and spacing', () => {
  const topics = pool(10)
  topics[4] = { ...topics[4], name: '  topic 1 ' }
  assert.match(validateTopicPool(topics) ?? '', /Two topics are called "topic 1"/)
})

test('at most two topics can be asked in every interview', () => {
  const topics = pool(10)
  for (let n = 0; n < TOPIC_MAX_MANDATORY; n++) topics[n] = { ...topics[n], is_mandatory: true }
  assert.equal(validateTopicPool(topics), null)
  topics[TOPIC_MAX_MANDATORY] = { ...topics[TOPIC_MAX_MANDATORY], is_mandatory: true }
  assert.match(validateTopicPool(topics) ?? '', /At most 2/)
})

test('topics are tidied for the API: trimmed, with the skill in lower case', () => {
  const [cleaned] = cleanTopics([topic(1, { name: ' Caching ', skill_tag: ' Redis ', scope: ' s ', seed_question: ' q ' })])
  assert.deepEqual(
    [cleaned.name, cleaned.skill_tag, cleaned.scope, cleaned.seed_question],
    ['Caching', 'redis', 's', 'q'],
  )
})

test('new rows and written topics get ids, and existing ids are kept', () => {
  assert.ok(createTopic().id)
  const [saved, fresh] = withIds([topic(1), { ...topic(2), id: undefined }])
  assert.equal(saved.id, 'id-1')
  assert.ok(fresh.id && fresh.id !== 'id-2')
})
