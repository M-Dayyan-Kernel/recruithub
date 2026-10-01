import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { updateCandidate } from '@/lib/candidates'
import type { CandidateUpdatePayload } from '@/types/api'

export function useUpdateCandidate(candidateId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CandidateUpdatePayload) => updateCandidate(candidateId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['candidates'] })
      void queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] })
      toast.success('Candidate updated')
    },
    onError: () => toast.error('Failed to update candidate'),
  })
}
