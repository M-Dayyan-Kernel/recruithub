import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import {
  ScreeningQuestionsEditor,
  createScreeningQuestion,
} from '@/components/ScreeningQuestionsEditor'
import { getDefaultScreeningQuestions } from '@/lib/screeningDefaults'

interface Props {
  job: Job
  open: boolean
  onClose: () => void
}

export function ScreeningCriteriaModal({ job, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [questions, setQuestions] = useState(
    job.screening_questions?.length
      ? job.screening_questions
      : getDefaultScreeningQuestions(job.title),
  )

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/jobs/${job.id}`, {
        screening_questions: questions.filter((q) => q.question.trim()),
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Screening questions saved')
      onClose()
    },
    onError: () => toast.error('Failed to save screening questions'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">Screening questions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {questions.length} question{questions.length !== 1 ? 's' : ''} for voice screening
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
            questions={questions}
            onChange={setQuestions}
            disabled={mutation.isPending}
            embedded
            scrollable
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setQuestions((prev) => [...prev, createScreeningQuestion()])}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus size={13} />
            Add question
          </button>
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
              disabled={mutation.isPending}
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
