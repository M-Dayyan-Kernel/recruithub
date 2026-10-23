import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HrDecision, ShortlistDecisionResponse, ShortlistResultWithCandidate } from '@/types/api'

interface Options {
  onApproved?: (data: ShortlistDecisionResponse) => void
  /**
   * Flip the row in the cache before the server answers (default). Turn it off when a
   * dialog is waiting on the answer: the optimistic flip re-renders the row into its
   * next state and unmounts the dialog, so a failure would have nowhere to be shown.
   */
  optimistic?: boolean
}

export function useShortlistDecision(jobId: string, shortlistId: string, options?: Options) {
  const queryClient = useQueryClient()

  return useMutation<ShortlistDecisionResponse, Error, Exclude<HrDecision, 'pending'>>({
    mutationFn: (hr_decision) =>
      api.patch(`/api/shortlist/${shortlistId}/decision`, { hr_decision }) as unknown as Promise<ShortlistDecisionResponse>,
    onMutate: async (hr_decision) => {
      if (options?.optimistic === false) return { previous: undefined }
      await queryClient.cancelQueries({ queryKey: ['shortlist', jobId] })
      const previous = queryClient.getQueryData<ShortlistResultWithCandidate[]>([
        'shortlist',
        jobId,
      ])
      queryClient.setQueryData<ShortlistResultWithCandidate[]>(
        ['shortlist', jobId],
        (old) =>
          old ? old.map((r) => (r.id === shortlistId ? { ...r, hr_decision } : r)) : old,
      )
      return { previous }
    },
    onSuccess: (data, hr_decision) => {
      if (hr_decision === 'approved') {
        options?.onApproved?.(data)
      }
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: ShortlistResultWithCandidate[] } | undefined
      if (ctx?.previous) {
        queryClient.setQueryData(['shortlist', jobId], ctx.previous)
      }
    },
    onSettled: async () => {
      // Awaited: a caller using `mutateAsync` (the confirmation dialog) should not be told
      // "done" until the list holds the new decision and, for an approval, the stage the
      // candidate has moved into. Otherwise the row would sit there with no actions.
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      // Approving moves the candidate into the screening or interview stage.
      queryClient.invalidateQueries({ queryKey: ['screening', jobId] })
      queryClient.invalidateQueries({ queryKey: ['interviews-pipeline', jobId] })
      queryClient.invalidateQueries({ queryKey: ['voice-screening', jobId] })
      await queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    },
  })
}
