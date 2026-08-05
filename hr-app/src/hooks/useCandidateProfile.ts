import { useQuery } from '@tanstack/react-query'
import { fetchCandidateProfile } from '@/lib/candidates'

export function useCandidateProfile(candidateId: string) {
  return useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: () => fetchCandidateProfile(candidateId),
    enabled: !!candidateId,
  })
}
