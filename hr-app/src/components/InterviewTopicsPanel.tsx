import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2, ListChecks, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, InterviewTopic } from '@/types/api'
import { InterviewTopicsEditor } from '@/components/InterviewTopicsEditor'
import { cleanTopics, validateTopicPool } from '@/lib/interviewTopics'
import { cn } from '@/lib/utils'

interface Props {
  job: Job
  headerEnd?: ReactNode
}

const snapshotOf = (topics: InterviewTopic[]) => JSON.stringify(cleanTopics(topics))

/** The job's interview topic pool, edited in place on the job page. */
export function InterviewTopicsPanel({ job, headerEnd }: Props) {
  const queryClient = useQueryClient()
  const [topics, setTopics] = useState<InterviewTopic[]>(job.interview_topics ?? [])
  const [savedSnapshot, setSavedSnapshot] = useState(snapshotOf(job.interview_topics ?? []))
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const next = job.interview_topics ?? []
    setTopics(next)
    setSavedSnapshot(snapshotOf(next))
  }, [job.id, job.updated_at])

  const isDirty = snapshotOf(topics) !== savedSnapshot
  const problem = validateTopicPool(topics)
  const mandatory = topics.filter((t) => t.is_mandatory).length

  useEffect(() => {
    if (isDirty) setExpanded(true)
  }, [isDirty])

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
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex h-14 flex-nowrap items-center gap-3 bg-slate-50/50 px-4">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded ? 'true' : 'false'}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/60"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/60">
            <ListChecks size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="truncate text-sm font-semibold text-slate-900">Interview topics</h2>
              {isDirty && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Unsaved
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {topics.length === 0
                ? 'No topics — click to add'
                : `${topics.length} topic${topics.length !== 1 ? 's' : ''}${
                    mandatory ? ` · ${mandatory} asked every time` : ''
                  } · ${expanded ? 'click to collapse' : 'click to edit'}`}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn('shrink-0 text-slate-400 transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isDirty && (
            <>
              <button
                type="button"
                onClick={() => setTopics(JSON.parse(savedSnapshot) as InterviewTopic[])}
                disabled={saveMutation.isPending}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-50"
              >
                <RotateCcw size={11} />
                Discard
              </button>
              <button
                type="button"
                onClick={() => saveMutation.mutate(topics)}
                disabled={saveMutation.isPending || problem !== null}
                title={problem ?? undefined}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-indigo-600 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
              </button>
            </>
          )}
          {headerEnd}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-3">
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
            scrollable
          />
        </div>
      )}
    </section>
  )
}
