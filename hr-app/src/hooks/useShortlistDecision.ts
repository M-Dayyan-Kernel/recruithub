import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HrDecision, ShortlistResultWithCandidate } from '@/types/api'

export function useShortlistDecision(jobId: string, shortlistId: string) {
  const queryClient = useQueryClient()

  return useMutation<unknown, Error, Exclude<HrDecision, 'pending'>>({
    mutationFn: (hr_decision) =>
      api.patch(`/api/shortlist/${shortlistId}/decision`, { hr_decision }),
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
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: ShortlistResultWithCandidate[] } | undefined
      if (ctx?.previous) {
        queryClient.setQueryData(['shortlist', jobId], ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
    },
  })
}
