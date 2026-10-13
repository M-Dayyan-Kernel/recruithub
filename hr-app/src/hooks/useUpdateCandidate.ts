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
    // The API explains what it rejected (e.g. "Name cannot be blank"); show that.
    onError: (err: Error) => toast.error(err.message || 'Failed to update candidate'),
  })
}
