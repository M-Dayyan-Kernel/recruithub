import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2, ListChecks, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, InterviewQuestion } from '@/types/api'
import {
  InterviewQuestionsEditor,
  createInterviewQuestion,
} from '@/components/InterviewQuestionsEditor'
import { cn } from '@/lib/utils'

interface Props {
  job: Job
}

export function InterviewRubricPanel({ job }: Props) {
  const queryClient = useQueryClient()
  const normalize = (qs: InterviewQuestion[]) =>
    JSON.stringify(qs.filter((q) => q.question.trim()))

  const [questions, setQuestions] = useState<InterviewQuestion[]>(job.interview_questions ?? [])
  const [savedSnapshot, setSavedSnapshot] = useState(normalize(job.interview_questions ?? []))
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const next = job.interview_questions ?? []
    setQuestions(next)
    setSavedSnapshot(normalize(next))
  }, [job.id, job.updated_at])

  const isDirty = normalize(questions) !== savedSnapshot
  const filledCount = questions.filter((q) => q.question.trim()).length
  const totalScore = questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0)

  useEffect(() => {
    if (isDirty) setExpanded(true)
  }, [isDirty])

  const saveMutation = useMutation({
    mutationFn: (payload: InterviewQuestion[]) =>
      api.patch(`/api/jobs/${job.id}`, {
        interview_questions: payload,
      }) as unknown as Promise<Job>,
    onSuccess: (updated) => {
      const saved = updated.interview_questions ?? []
      setQuestions(saved)
      setSavedSnapshot(normalize(saved))
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Interview rubric saved')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to save rubric')
    },
  })

  const handleSave = () => {
    saveMutation.mutate(questions.filter((q) => q.question.trim()))
  }

  const handleDiscard = () => {
    setQuestions(JSON.parse(savedSnapshot) as InterviewQuestion[])
  }

  const toggleExpanded = () => setExpanded((open) => !open)

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded ? 'true' : 'false'}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-white/60 -mx-1 px-1 py-0.5"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/60">
            <ListChecks size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="truncate text-sm font-semibold text-slate-900">Interview rubric</h2>
              {filledCount > 0 && (
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-600">
                  {totalScore} pts
                </span>
              )}
              {isDirty && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Unsaved
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {filledCount === 0
                ? 'No questions — click to add rubric'
                : `${filledCount} question${filledCount !== 1 ? 's' : ''} · ${expanded ? 'click to collapse' : 'click to edit'}`}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              'shrink-0 text-slate-400 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setExpanded(true)
              setQuestions((prev) => [...prev, createInterviewQuestion()])
            }}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
          >
            <Plus size={12} />
            Add
          </button>
          {isDirty && (
            <>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-50"
              >
                <RotateCcw size={11} />
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  'Save'
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-3">
          <InterviewQuestionsEditor
            questions={questions}
            onChange={setQuestions}
            disabled={saveMutation.isPending}
            embedded
            hideTotal
            scrollable
          />
        </div>
      )}
    </section>
  )
}
