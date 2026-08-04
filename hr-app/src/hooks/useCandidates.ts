import { useQuery } from '@tanstack/react-query'
import { fetchCandidates, type CandidatesListParams } from '@/lib/candidates'

export function useCandidates(params: CandidatesListParams) {
  return useQuery({
    queryKey: ['candidates', params],
    queryFn: () => fetchCandidates(params),
  })
}
