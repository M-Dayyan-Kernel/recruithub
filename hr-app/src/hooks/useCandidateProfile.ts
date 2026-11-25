import { useQuery } from '@tanstack/react-query'
import { fetchCandidateProfile } from '@/lib/candidates'
import { isNotFoundError } from '@/lib/errorMessage'

export function useCandidateProfile(candidateId: string) {
  return useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: () => fetchCandidateProfile(candidateId),
    enabled: !!candidateId,
    // A deleted candidate stays deleted; retrying only delays saying so.
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 2,
  })
}
