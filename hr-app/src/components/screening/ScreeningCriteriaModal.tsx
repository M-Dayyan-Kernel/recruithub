import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job, ScreeningQuestion } from '@/types/api'
import { ScreeningQuestionsEditor } from '@/components/ScreeningQuestionsEditor'
import { editableQuestions, questionKind } from '@/lib/screeningQuestions'
import {
  SCREENING_QUESTIONS_MAX_TOTAL,
  SCREENING_QUESTION_MAX_LENGTH,
  validateScreeningQuestionText,
} from '@/lib/validation'

interface Props {
  job: Job
  open: boolean
  onClose: () => void
}

export function ScreeningCriteriaModal({ job, open, onClose }: Props) {
  const queryClient = useQueryClient()
  // The standard questions come with the job and are locked; the rest are what this edits.
  const standard = (job.screening_questions ?? []).filter((q) => questionKind(q) === 'standard')
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(() =>
    editableQuestions(job.screening_questions),
  )
  const total = standard.length + questions.length

  const firstError =
    questions
      .map((q) => validateScreeningQuestionText(q.question, SCREENING_QUESTION_MAX_LENGTH))
      .find(Boolean) ?? null
  const canSave = !firstError && total <= SCREENING_QUESTIONS_MAX_TOTAL

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/jobs/${job.id}`, {
        screening_questions: questions.map((q) => ({ ...q, question: q.question.trim() })),
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Screening questions saved')
      onClose()
    },
    onError: (err: Error) =>
      toast.error(err.message || 'Failed to save screening questions'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">Screening questions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {total} question{total !== 1 ? 's' : ''} for voice screening
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4">
          <ScreeningQuestionsEditor
            standard={standard}
            questions={questions}
            onChange={setQuestions}
            disabled={mutation.isPending}
            compact
            scrollable
          />
          {firstError && (
            <p className="mt-2 text-xs text-rose-600" role="alert">
              {firstError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !canSave}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
