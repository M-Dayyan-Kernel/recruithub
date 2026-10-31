import type { InterviewTopic } from '@/types/api'

// Limits on a job's topic pool. Mirror `parsing.topic_pool` and `interview.plan` in the API's
// config.yaml, which enforces them on save.
export const TOPIC_POOL_MIN = 8
export const TOPIC_POOL_MAX = 20
export const TOPIC_MAX_MANDATORY = 2
/** Topics one interview asks. */
export const TOPICS_PER_INTERVIEW = 5

export const TOPIC_NAME_MAX = 120
export const TOPIC_SCOPE_MAX = 500
export const TOPIC_SKILL_MAX = 60
export const TOPIC_QUESTION_MAX = 600

/** A blank row. It gets its id now so the row keeps its identity while it is edited. */
export function createTopic(): InterviewTopic {
  return { id: crypto.randomUUID(), name: '', scope: '', skill_tag: '', seed_question: '', is_mandatory: false }
}

/** Topics from the API that are not saved yet have no id; give them one. */
export function withIds(topics: InterviewTopic[]): InterviewTopic[] {
  return topics.map((t) => (t.id ? t : { ...t, id: crypto.randomUUID() }))
}

/** A row that cannot be saved because a required field is empty. */
export function isIncomplete(topic: InterviewTopic): boolean {
  return ![topic.name, topic.scope, topic.skill_tag, topic.seed_question].every((v) => v.trim())
}

/**
 * The first problem that stops this pool being saved, or null. An empty pool is fine (the job
 * then has no topics to interview on); a pool has to be big enough that candidates differ.
 */
export function validateTopicPool(topics: InterviewTopic[]): string | null {
  if (topics.length === 0) return null
  if (topics.some(isIncomplete)) return 'Fill in or remove the incomplete topic'
  const names = new Set<string>()
  for (const topic of topics) {
    const key = topic.name.trim().toLowerCase()
    if (names.has(key)) return `Two topics are called "${topic.name.trim()}"`
    names.add(key)
  }
  if (topics.length < TOPIC_POOL_MIN) {
    return `Add at least ${TOPIC_POOL_MIN} topics, or remove them all (${topics.length} so far)`
  }
  if (topics.length > TOPIC_POOL_MAX) return `A pool can have at most ${TOPIC_POOL_MAX} topics`
  if (topics.filter((t) => t.is_mandatory).length > TOPIC_MAX_MANDATORY) {
    return `At most ${TOPIC_MAX_MANDATORY} topics can be asked in every interview`
  }
  return null
}

/** The topics as the API takes them: trimmed, with the skill in lower case. */
export function cleanTopics(topics: InterviewTopic[]): InterviewTopic[] {
  return topics.map((t) => ({
    ...t,
    name: t.name.trim(),
    scope: t.scope.trim(),
    skill_tag: t.skill_tag.trim().toLowerCase(),
    seed_question: t.seed_question.trim(),
  }))
}
