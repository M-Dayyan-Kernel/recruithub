import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { Candidate, ShortlistResultWithCandidate } from '@/types/api'

const PIPELINE_POLL_MS = 5_000
const PIPELINE_POLL_SLOW_MS = 30_000
const PIPELINE_POLL_CUTOFF_MS = 120_000
const SHORTLIST_POLL_MS = 1_000

const IN_FLIGHT_PARSE = new Set<Candidate['parse_status']>([
  'pending_parse',
  'parse_queued',
  'parsing',
  'parsed',
])

interface Options {
  shortlistInProgress?: boolean
  pendingShortlistIds?: string[]
}

export function useJobPipelineCandidates(jobId: string, options: Options = {}) {
  const { shortlistInProgress = false, pendingShortlistIds = [] } = options
  const pendingShortlistSet = useMemo(
    () => new Set(pendingShortlistIds),
    [pendingShortlistIds],
  )
  const [pollStartTime] = useState(() => Date.now())

  const getPollInterval = (parseInFlight: boolean) => {
    if (!parseInFlight && !shortlistInProgress) return false
    if (shortlistInProgress && !parseInFlight) return SHORTLIST_POLL_MS
    return Date.now() - pollStartTime > PIPELINE_POLL_CUTOFF_MS
      ? PIPELINE_POLL_SLOW_MS
      : PIPELINE_POLL_MS
  }

  const pipelineQuery = useQuery<Candidate[]>({
    queryKey: ['candidates', jobId, 'pipeline'],
    queryFn: () => api.get(`/api/jobs/${jobId}/candidates`) as unknown as Promise<Candidate[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as Candidate[]
      const parseInFlight = list.some((c) => IN_FLIGHT_PARSE.has(c.parse_status))
      return getPollInterval(parseInFlight)
    },
  })

  const shortlistQuery = useQuery<ShortlistResultWithCandidate[]>({
    queryKey: ['shortlist', jobId],
    queryFn: () =>
      api.get(`/api/jobs/${jobId}/shortlist`) as unknown as Promise<ShortlistResultWithCandidate[]>,
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: () => {
      const list = (pipelineQuery.data ?? []) as Candidate[]
      const parseInFlight = list.some((c) => IN_FLIGHT_PARSE.has(c.parse_status))
      if (shortlistInProgress) return SHORTLIST_POLL_MS
      return getPollInterval(parseInFlight)
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
        (c) =>
          c.parse_status === 'pending_parse' ||
          c.parse_status === 'parse_queued' ||
          c.parse_status === 'parse_failed',
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
        (c) =>
          c.parse_status === 'ready' &&
          !shortlistedIds.has(c.id) &&
          !pendingShortlistSet.has(c.id),
      ),
    [candidates, shortlistedIds, pendingShortlistSet],
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
