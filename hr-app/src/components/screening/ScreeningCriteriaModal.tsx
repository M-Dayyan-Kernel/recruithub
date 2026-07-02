import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'

interface Props {
  job: Job
  open: boolean
  onClose: () => void
}

export function ScreeningCriteriaModal({ job, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [criteria, setCriteria] = useState(job.screening_criteria ?? '')

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/jobs/${job.id}`, {
        screening_criteria: criteria.trim() || null,
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      toast.success('Screening criteria saved')
      onClose()
    },
    onError: () => toast.error('Failed to save screening criteria'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Setup Screening Criteria</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          Questions and topics the AI voice agent should cover during screening calls.
        </p>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="e.g. Must be available within 30 days. Ask about notice period and expected CTC."
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
            Save Criteria
          </button>
        </div>
      </div>
    </div>
  )
}
