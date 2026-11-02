import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, InterviewTopic } from '@/types/api'
import { InterviewTopicsEditor } from '@/components/InterviewTopicsEditor'
import { cleanTopics, validateTopicPool } from '@/lib/interviewTopics'
import { BTN_GHOST, BTN_PRIMARY } from '@/components/ui/Surface'

interface Props {
  job: Job
  /** Lets the drawer ask before it throws away unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void
}

const snapshotOf = (topics: InterviewTopic[]) => JSON.stringify(cleanTopics(topics))

/**
 * The job's interview topic pool, edited in the Interviews stage's Settings drawer. Edits are
 * kept until Save; Discard goes back to what is saved.
 */
export function InterviewTopicsPanel({ job, onDirtyChange }: Props) {
  const queryClient = useQueryClient()
  const [topics, setTopics] = useState<InterviewTopic[]>(job.interview_topics ?? [])
  const [savedSnapshot, setSavedSnapshot] = useState(snapshotOf(job.interview_topics ?? []))

  useEffect(() => {
    const next = job.interview_topics ?? []
    setTopics(next)
    setSavedSnapshot(snapshotOf(next))
  }, [job.id, job.updated_at])

  const isDirty = snapshotOf(topics) !== savedSnapshot
  const problem = validateTopicPool(topics)
  const mandatory = topics.filter((t) => t.is_mandatory).length

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const saveMutation = useMutation({
    mutationFn: (payload: InterviewTopic[]) =>
      api.patch(`/api/jobs/${job.id}`, { interview_topics: cleanTopics(payload) }) as unknown as Promise<Job>,
    onSuccess: (updated) => {
      const saved = updated.interview_topics ?? []
      setTopics(saved)
      setSavedSnapshot(snapshotOf(saved))
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Interview topics saved')
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to save topics'),
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {topics.length === 0
          ? 'No topics yet.'
          : `${topics.length} topic${topics.length !== 1 ? 's' : ''}${
              mandatory ? ` · ${mandatory} asked every time` : ''
            }. `}
        Each candidate gets their own questions, drawn from these topics.
      </p>

      <InterviewTopicsEditor
        topics={topics}
        onChange={setTopics}
        job={{
          title: job.title,
          description: job.description,
          required_skills: job.required_skills ?? [],
          seniority_level: job.seniority_level,
        }}
        disabled={saveMutation.isPending}
        error={isDirty ? problem : null}
      />

      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        {isDirty && <span className="mr-auto text-xs font-medium text-warn">Unsaved changes</span>}
        <button
          type="button"
          onClick={() => setTopics(JSON.parse(savedSnapshot) as InterviewTopic[])}
          disabled={!isDirty || saveMutation.isPending}
          className={BTN_GHOST}
        >
          <RotateCcw size={13} aria-hidden />
          Discard
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate(topics)}
          disabled={!isDirty || saveMutation.isPending || problem !== null}
          title={problem ?? undefined}
          className={BTN_PRIMARY}
        >
          {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save topics'}
        </button>
      </div>
    </div>
  )
}
