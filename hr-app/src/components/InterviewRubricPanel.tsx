import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ListChecks, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, InterviewQuestion } from '@/types/api'
import { InterviewQuestionsEditor } from '@/components/InterviewQuestionsEditor'

interface Props {
  job: Job
}

export function InterviewRubricPanel({ job }: Props) {
  const queryClient = useQueryClient()
  const normalize = (qs: InterviewQuestion[]) =>
    JSON.stringify(qs.filter((q) => q.question.trim()))

  const [questions, setQuestions] = useState<InterviewQuestion[]>(job.interview_questions ?? [])
  const [savedSnapshot, setSavedSnapshot] = useState(normalize(job.interview_questions ?? []))

  useEffect(() => {
    const next = job.interview_questions ?? []
    setQuestions(next)
    setSavedSnapshot(normalize(next))
  }, [job.id, job.updated_at])

  const isDirty = normalize(questions) !== savedSnapshot

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
    const trimmed = questions.filter((q) => q.question.trim())
    saveMutation.mutate(trimmed)
  }

  const handleDiscard = () => {
    setQuestions(JSON.parse(savedSnapshot) as InterviewQuestion[])
  }

  const totalScore = questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0)

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/60">
            <ListChecks size={17} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Interview rubric
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">{job.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              Questions and point weights for AI interviews.
              {questions.length > 0 && (
                <span className="text-slate-400">
                  {' '}
                  · {questions.length} question{questions.length !== 1 ? 's' : ''}
                  {totalScore > 0 && ` · ${totalScore} pts`}
                </span>
              )}
            </p>
          </div>
        </div>

        {isDirty && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-50"
            >
              <RotateCcw size={12} />
              Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Save rubric'
              )}
            </button>
          </div>
        )}
      </div>

      <div className="p-5">
        <InterviewQuestionsEditor
          questions={questions}
          onChange={setQuestions}
          disabled={saveMutation.isPending}
          embedded
        />
      </div>
    </section>
  )
}
