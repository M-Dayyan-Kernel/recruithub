import { useQuery } from '@tanstack/react-query'
import { fetchCandidatePage } from '@/lib/workflow'

/**
 * Resumes the AI review could not finish, asked of the server directly. Deriving them from the
 * job's candidate list would miss any beyond that list's cap, and `total` is the true count
 * for the Failed tab however many there are.
 */
export function useFailedCandidates(jobId: string) {
  const query = useQuery({
    queryKey: ['candidates', jobId, 'failed'],
    queryFn: () => fetchCandidatePage(jobId, { pipeline_status: 'failed' }),
    enabled: !!jobId,
    staleTime: 0,
    // A failure can land while the page is open (a batch finishing); this is a small filtered query.
    refetchInterval: 10_000,
  })
  return {
    failedCandidates: query.data?.items ?? [],
    failedTotal: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}
