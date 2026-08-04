import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HrDecision, ShortlistDecisionResponse, ShortlistResultWithCandidate } from '@/types/api'

interface Options {
  onApproved?: (data: ShortlistDecisionResponse) => void
}

export function useShortlistDecision(jobId: string, shortlistId: string, options?: Options) {
  const queryClient = useQueryClient()

  return useMutation<ShortlistDecisionResponse, Error, Exclude<HrDecision, 'pending'>>({
    mutationFn: (hr_decision) =>
      api.patch(`/api/shortlist/${shortlistId}/decision`, { hr_decision }) as unknown as Promise<ShortlistDecisionResponse>,
    onMutate: async (hr_decision) => {
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
    },
  })
}
