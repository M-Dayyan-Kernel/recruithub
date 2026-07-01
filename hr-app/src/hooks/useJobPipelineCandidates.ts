import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate } from '@/types/api'

const PIPELINE_POLL_MS = 5_000
const PIPELINE_POLL_SLOW_MS = 30_000
const PIPELINE_POLL_CUTOFF_MS = 120_000

const IN_FLIGHT_PARSE = new Set<Candidate['parse_status']>(['pending_parse', 'parsing', 'parsed'])

export function useJobPipelineCandidates(jobId: string) {
  const [pollStartTime] = useState(() => Date.now())

  const pipelineQuery = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId, 'pipeline'],
    queryFn: () => api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as Candidate[]
      if (!list.some((c) => IN_FLIGHT_PARSE.has(c.parse_status))) return false
      return Date.now() - pollStartTime > PIPELINE_POLL_CUTOFF_MS
        ? PIPELINE_POLL_SLOW_MS
        : PIPELINE_POLL_MS
    },
  })

  const shortlistQuery = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const list = (pipelineQuery.data ?? []) as Candidate[]
      if (!list.some((c) => IN_FLIGHT_PARSE.has(c.parse_status))) return false
      return Date.now() - pollStartTime > PIPELINE_POLL_CUTOFF_MS
        ? PIPELINE_POLL_SLOW_MS
        : PIPELINE_POLL_MS
    },
  })

  const shortlistedIds = useMemo(
    () => new Set((shortlistQuery.data ?? []).map((r) => r.candidate_id)),
    [shortlistQuery.data],
  )

  const candidates = pipelineQuery.data ?? []

  const queueCandidates = useMemo(
    () =>
      candidates.filter(
        (c) => c.parse_status === 'pending_parse' || c.parse_status === 'parse_failed',
      ),
    [candidates],
  )

  const parsingCandidates = useMemo(
    () => candidates.filter((c) => c.parse_status === 'parsing' || c.parse_status === 'parsed'),
    [candidates],
  )

  const parsedCandidates = useMemo(
    () =>
      candidates.filter(
        (c) => c.parse_status === 'ready' && !shortlistedIds.has(c.id),
      ),
    [candidates, shortlistedIds],
  )

  return {
    candidates,
    queueCandidates,
    parsingCandidates,
    parsedCandidates,
    isLoading: pipelineQuery.isLoading,
    isError: pipelineQuery.isError,
    refetch: () => {
      void pipelineQuery.refetch()
      void shortlistQuery.refetch()
    },
  }
}
