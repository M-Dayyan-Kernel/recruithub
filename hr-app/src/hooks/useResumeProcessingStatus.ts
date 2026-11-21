import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

const STATUS_POLL_MS = 30_000
/** Faster while paused, so the banner and the rows clear soon after the worker is back. */
const PAUSED_STATUS_POLL_MS = 10_000

/**
 * Whether a worker is listening for resume reviews. Asked only while something is in flight:
 * it is what tells HR a resume is paused rather than slow, and nothing else needs it.
 *
 * Undefined until the first answer, and on an error, so a failed check never claims an outage.
 */
export function useResumeProcessingStatus(enabled: boolean): boolean | undefined {
  const { data } = useQuery<{ available: boolean }>({
    queryKey: ['resume-processing-status'],
    queryFn: () =>
      api.get('/api/resume-processing/status') as unknown as Promise<{ available: boolean }>,
    enabled,
    staleTime: 0,
    refetchInterval: (query) => {
      if (!enabled) return false
      return query.state.data?.available === false ? PAUSED_STATUS_POLL_MS : STATUS_POLL_MS
    },
    retry: false,
  })
  return enabled ? data?.available : undefined
}
