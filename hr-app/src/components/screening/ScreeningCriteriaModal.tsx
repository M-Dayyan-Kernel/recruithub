import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { ScreeningQuestionsEditor } from '@/components/ScreeningQuestionsEditor'
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
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Screening questions</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          Questions the AI voice agent will ask during screening calls. Add, edit, or remove as needed.
        </p>
        <ScreeningQuestionsEditor
          questions={questions}
          onChange={setQuestions}
          disabled={mutation.isPending}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Save questions
          </button>
        </div>
      </div>
    </div>
  )
}
