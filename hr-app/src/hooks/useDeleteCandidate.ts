import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'

export function useDeleteCandidate(jobId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (candidateId: string) => api.delete(`/api/candidates/${candidateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    },
    onError: () => toast.error('Failed to remove resume'),
  })
}
