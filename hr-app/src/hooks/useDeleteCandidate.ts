import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'

/**
 * `quiet` leaves the refusal to the caller: a confirm dialog shows the server's sentence in
 * place, and a toast saying the same thing behind it would be noise.
 */
export function useDeleteCandidate(jobId: string, { quiet = false }: { quiet?: boolean } = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (candidateId: string) => api.delete(`/api/candidates/${candidateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId, 'pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
    },
    // The server says why when it refuses (the candidate is on a call or in an interview), so
    // show that. The id is the message: removing several at once must not stack the same
    // sentence, but different reasons each still show.
    onError: (err: Error) => {
      if (quiet) return
      const message = err.message || 'Failed to remove resume'
      toast.error(message, { id: `delete-candidate:${message}` })
    },
  })
}
