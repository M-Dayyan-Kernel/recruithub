import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, Loader2, ListChecks, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { InterviewTopic, SeniorityLevel } from '@/types/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import {
  TOPICS_PER_INTERVIEW,
  TOPIC_MAX_MANDATORY,
  TOPIC_NAME_MAX,
  TOPIC_POOL_MAX,
  TOPIC_QUESTION_MAX,
  TOPIC_SCOPE_MAX,
  TOPIC_SKILL_MAX,
  cleanTopics,
  createTopic,
  isIncomplete,
  withIds,
} from '@/lib/interviewTopics'

/** What the topic writer needs to know about the job, saved or not. */
export interface TopicJobContext {
  title: string
  description: string
  required_skills: string[]
  seniority_level: SeniorityLevel | null
}

interface Props {
  topics: InterviewTopic[]
  onChange: (topics: InterviewTopic[]) => void
  /** Null (or an incomplete job) turns the writer off: it works from the description. */
  job: TopicJobContext | null
  disabled?: boolean
  /** Why the pool cannot be saved, shown under the header. */
  error?: string | null
  /** Cap the visible rows; the rest scroll inside the list. */
  scrollable?: boolean
}

const fieldClass =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-surface-2 disabled:text-ink-muted'
const missingClass = 'border-neg/50'
const labelClass = 'mb-1 block text-[11px] font-medium text-ink-muted'
const smallButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'

function canWrite(job: TopicJobContext | null): job is TopicJobContext & { seniority_level: SeniorityLevel } {
  return Boolean(job && job.title.trim() && job.description.trim() && job.seniority_level)
}

export function InterviewTopicsEditor({ topics, onChange, job, disabled, error, scrollable }: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const mandatoryCount = topics.filter((t) => t.is_mandatory).length
  const writerReady = canWrite(job)

  const update = (id: string | undefined, patch: Partial<InterviewTopic>) =>
    onChange(topics.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const generate = useMutation({
    mutationFn: () =>
      api.post('/api/jobs/topics/generate', {
        title: job!.title.trim(),
        description: job!.description.trim(),
        required_skills: job!.required_skills,
        seniority_level: job!.seniority_level,
      }) as unknown as Promise<{ topics: InterviewTopic[] }>,
    onSuccess: (data) => {
      onChange(withIds(data.topics))
      toast.success(`${data.topics.length} topics written — review them before saving`)
    },
    onError: (err: Error) => toast.error(err.message || 'Could not write topics'),
  })

  const regenerate = useMutation({
    mutationFn: (id: string) => {
      // Only finished topics go to the writer; the index follows them.
      const finished = topics.filter((t) => !isIncomplete(t) || t.id === id)
      return api.post('/api/jobs/topics/regenerate', {
        title: job!.title.trim(),
        description: job!.description.trim(),
        required_skills: job!.required_skills,
        seniority_level: job!.seniority_level,
        topics: cleanTopics(finished),
        topic_index: finished.findIndex((t) => t.id === id),
      }) as unknown as Promise<{ topic: InterviewTopic }>
    },
    onMutate: (id) => setRegeneratingId(id),
    onSuccess: (data, id) => update(id, { ...data.topic, id }),
    onError: (err: Error) => toast.error(err.message || 'Could not write a replacement'),
    onSettled: () => setRegeneratingId(null),
  })

  const busy = disabled || generate.isPending || regenerate.isPending
  const startGenerate = () => (topics.length > 0 ? setConfirmReplace(true) : generate.mutate())

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">
            {topics.length === 0
              ? 'No topics yet'
              : `${topics.length} topic${topics.length === 1 ? '' : 's'}`}
            {mandatoryCount > 0 && (
              <span className="ml-2 text-[12px] font-normal text-ink-muted">
                {mandatoryCount} asked in every interview
              </span>
            )}
          </p>
          <p className="text-[12px] text-ink-muted">
            Each interview asks an introduction and {TOPICS_PER_INTERVIEW} of these, chosen
            differently for every candidate.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={startGenerate}
            disabled={busy || !writerReady}
            title={writerReady ? undefined : 'Add a title, description and seniority level first'}
            className={smallButton}
          >
            {generate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Write topics
          </button>
          <button
            type="button"
            onClick={() => onChange([...topics, createTopic()])}
            disabled={busy || topics.length >= TOPIC_POOL_MAX}
            className={smallButton}
          >
            <Plus size={13} />
            Add topic
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-neg">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {topics.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-line bg-surface-2 px-3 py-4">
          <ListChecks size={16} className="shrink-0 text-ink-subtle" aria-hidden />
          <p className="text-[12px] text-ink-muted">
            Upload a job description, or use Write topics, to draft a pool. Without topics the
            interview is a general technical conversation.
          </p>
        </div>
      ) : (
        <ul
          className={`space-y-2 ${scrollable ? 'scrollbar-thin-light max-h-[28rem] overflow-y-auto pr-1.5' : ''}`}
        >
          {topics.map((topic, index) => {
            const id = topic.id
            const incomplete = isIncomplete(topic)
            const lockedOut = !topic.is_mandatory && mandatoryCount >= TOPIC_MAX_MANDATORY
            return (
              <li key={id ?? index} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <span className="w-5 pb-2 text-center text-[12px] font-medium tabular-nums text-ink-subtle">
                    {index + 1}
                  </span>
                  <div className="min-w-[10rem] flex-1">
                    <label className={labelClass} htmlFor={`topic-name-${index}`}>Topic</label>
                    <input
                      id={`topic-name-${index}`}
                      type="text"
                      value={topic.name}
                      maxLength={TOPIC_NAME_MAX}
                      onChange={(e) => update(id, { name: e.target.value })}
                      disabled={busy}
                      placeholder="e.g. Database indexing"
                      aria-invalid={!topic.name.trim()}
                      className={`${fieldClass} ${topic.name.trim() ? '' : missingClass}`}
                    />
                  </div>
                  <div className="w-40">
                    <label className={labelClass} htmlFor={`topic-skill-${index}`}>Skill</label>
                    <input
                      id={`topic-skill-${index}`}
                      type="text"
                      value={topic.skill_tag}
                      maxLength={TOPIC_SKILL_MAX}
                      onChange={(e) => update(id, { skill_tag: e.target.value })}
                      disabled={busy}
                      placeholder="e.g. postgresql"
                      aria-invalid={!topic.skill_tag.trim()}
                      className={`${fieldClass} ${topic.skill_tag.trim() ? '' : missingClass}`}
                    />
                  </div>
                  <label
                    className={`flex h-8 items-center gap-1.5 text-[12px] ${
                      lockedOut ? 'cursor-not-allowed text-ink-subtle' : 'cursor-pointer text-ink-muted'
                    }`}
                    title={
                      lockedOut
                        ? `At most ${TOPIC_MAX_MANDATORY} topics can be asked in every interview`
                        : 'Ask this topic in every interview'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={topic.is_mandatory}
                      disabled={busy || lockedOut}
                      onChange={(e) => update(id, { is_mandatory: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
                    />
                    Ask everyone
                  </label>
                  <button
                    type="button"
                    onClick={() => id && regenerate.mutate(id)}
                    disabled={busy || !writerReady || incomplete}
                    title={incomplete ? 'Fill in the topic first' : 'Write a different topic on this skill'}
                    aria-label={`Rewrite topic ${index + 1}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {regeneratingId === id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(topics.filter((t) => t.id !== id))}
                    disabled={busy}
                    aria-label={`Remove topic ${index + 1}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-neg-soft hover:text-neg disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor={`topic-scope-${index}`}>What to probe</label>
                    <textarea
                      id={`topic-scope-${index}`}
                      rows={2}
                      value={topic.scope}
                      maxLength={TOPIC_SCOPE_MAX}
                      onChange={(e) => update(id, { scope: e.target.value })}
                      disabled={busy}
                      aria-invalid={!topic.scope.trim()}
                      className={`${fieldClass} resize-none ${topic.scope.trim() ? '' : missingClass}`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`topic-question-${index}`}>Example question</label>
                    <textarea
                      id={`topic-question-${index}`}
                      rows={2}
                      value={topic.seed_question}
                      maxLength={TOPIC_QUESTION_MAX}
                      onChange={(e) => update(id, { seed_question: e.target.value })}
                      disabled={busy}
                      aria-invalid={!topic.seed_question.trim()}
                      className={`${fieldClass} resize-none ${topic.seed_question.trim() ? '' : missingClass}`}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmReplace && (
        <ConfirmDialog
          title="Replace the current topics?"
          body={<p>The topics below are replaced by a freshly written pool. Nothing is saved until you save.</p>}
          confirmLabel="Write new topics"
          tone="accent"
          onConfirm={() => {
            setConfirmReplace(false)
            generate.mutate()
          }}
          onClose={() => setConfirmReplace(false)}
        />
      )}
    </div>
  )
}
