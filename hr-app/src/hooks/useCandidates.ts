import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchCandidates, type CandidatesListParams } from '@/lib/candidates'

export function useCandidates(params: CandidatesListParams) {
  return useQuery({
    queryKey: ['candidates', params],
    queryFn: () => fetchCandidates(params),
    // Typing in the search box refetches per pause; keep the rows on screen instead of flashing
    // a skeleton between every one.
    placeholderData: keepPreviousData,
  })
}
